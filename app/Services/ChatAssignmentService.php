<?php

namespace App\Services;

use App\Jobs\SendChatEventWebPushNotification;
use App\Models\Chat;
use App\Models\SystemSetting;
use App\Models\User;
use App\Support\SpecialtyMatcher;
use Illuminate\Support\Facades\DB;

class ChatAssignmentService
{
    public function __construct(
        private readonly AuditService $auditService,
        private readonly WebchatAvailabilityService $webchatAvailabilityService,
    )
    {
    }

    /** Attempts to drain the waiting queue whenever capacity becomes available. */
    public function assignAllPending(): int
    {
        $assigned = 0;

        Chat::query()
            ->where('status', 'open')
            ->where('attention_status', 'pending_assignment')
            ->orderBy('updated_at')
            ->cursor()
            ->each(function (Chat $chat) use (&$assigned) {
                if ($this->assignPending($chat)->attention_status === 'assigned') {
                    $assigned++;
                }
            });

        return $assigned;
    }

    /** Assigns a pending handoff to the operator with the smallest active workload. */
    public function assignPending(Chat $chat): Chat
    {
        $result = DB::transaction(function () use ($chat) {
            $chat = Chat::query()->lockForUpdate()->findOrFail($chat->id);

            if ($chat->status !== 'open' || $chat->attention_status !== 'pending_assignment') {
                return ['chat' => $chat, 'assignment' => null];
            }

            if (! $this->webchatAvailabilityService->canAssignOperator($chat)) {
                return ['chat' => $chat, 'assignment' => null];
            }

            $maxAssignedChats = max(1, min(100, (int) (SystemSetting::query()
                ->where('key', 'operators.max_assigned_chats')
                ->value('value') ?? 5)));

            $operators = User::query()
                ->where('is_active', true)
                ->where('operator_availability', 'available')
                ->where('last_operator_activity_at', '>=', now()->subSeconds(90))
                ->with('role')
                ->get()
                ->filter(fn (User $user) => $user->canHandleChats())
                ->map(function (User $user) {
                    $user->active_chat_count = Chat::query()
                        ->where('status', 'open')
                        ->where('attention_status', 'assigned')
                        ->where('operator_id', $user->id)
                        ->count();

                    return $user;
                })
                ->filter(fn (User $user) => $user->active_chat_count < $maxAssignedChats)
                ->values();

            $routing = is_array($chat->bot_state['assignment_routing'] ?? null)
                ? $chat->bot_state['assignment_routing']
                : null;
            $rule = 'menor_carga_elegible';
            $routingSpecialty = null;

            if (in_array(($routing['mode'] ?? null), ['specialty', 'specialty_not_found'], true)) {
                $routingSpecialty = trim((string) ($routing['specialty_name'] ?? '')) ?: trim((string) ($routing['query'] ?? ''));
                $hasSpecialtyInput = trim((string) ($routing['specialty_id'] ?? '')) !== ''
                    || trim((string) ($routing['specialty_name'] ?? '')) !== ''
                    || trim((string) ($routing['query'] ?? '')) !== '';
                $specialists = $operators
                    ->map(function (User $user) use ($routing) {
                        $match = $this->specialtyRoutingMatch($user, $routing);
                        if ($match === null) {
                            return null;
                        }

                        $user->assignment_priority = $match['priority'];

                        return $user;
                    })
                    ->filter()
                    ->sortBy(fn (User $user) => [$user->assignment_priority, $user->active_chat_count, $user->id])
                    ->values();

                if ($specialists->isNotEmpty()) {
                    $operators = $specialists;
                    $rule = 'prioridad_especialidad';
                } elseif ($hasSpecialtyInput && ($routing['fallback'] ?? 'general_queue') === 'wait_for_specialist') {
                    return ['chat' => $chat, 'assignment' => null];
                } else {
                    $operators = $operators->sortBy(fn (User $user) => [$user->active_chat_count, $user->id])->values();
                    $rule = 'cola_general_sin_especialista_disponible';
                }
            } else {
                $operators = $operators->sortBy(fn (User $user) => [$user->active_chat_count, $user->id])->values();
            }

            $operator = $operators->first();
            if (! $operator) {
                return ['chat' => $chat, 'assignment' => null];
            }

            $chat->operator_id = $operator->id;
            $chat->last_operator_id = $operator->id;
            $chat->assigned_at = now();
            $chat->attention_status = 'assigned';
            $chat->save();

            return ['chat' => $chat->load('operator'), 'assignment' => [
                'operator_id' => $operator->id,
                'operator_name' => $operator->name,
                'active_chats_before' => $operator->active_chat_count,
                'capacity' => $maxAssignedChats,
                'eligible_operators' => $operators->count(),
                'rule' => $rule,
                'specialty' => $routingSpecialty,
                'priority' => $operator->assignment_priority ?? null,
            ]];
        });

        if ($result['assignment']) {
            $assignment = $result['assignment'];
            SendChatEventWebPushNotification::dispatch(
                (int) $result['chat']->id,
                'operator_assigned',
                (int) $assignment['operator_id'],
            )->afterCommit();
            if ($result['chat']->channel === 'webchat') {
                SendChatEventWebPushNotification::dispatch(
                    (int) $result['chat']->id,
                    'webchat_operator_joined',
                    (int) $assignment['operator_id'],
                )->afterCommit();
            }

            $this->auditService->recordChatAction(
                'operator_auto_assigned',
                'Asignó automáticamente a '.$assignment['operator_name'].($assignment['specialty'] ? ' para '.$assignment['specialty'] : ' por menor carga elegible'),
                $result['chat'],
                null,
                ['after' => ['operator_id' => $assignment['operator_id'], 'operator_name' => $assignment['operator_name']], 'meta' => $assignment],
            );
        }

        return $result['chat'];
    }

    private function specialtyRoutingMatch(User $user, array $routing): ?array
    {
        $requestedId = trim((string) ($routing['specialty_id'] ?? ''));
        $requestedNames = array_filter([
            trim((string) ($routing['specialty_name'] ?? '')),
            trim((string) ($routing['query'] ?? '')),
        ]);
        foreach (is_array($user->assignment_specialties) ? $user->assignment_specialties : [] as $specialty) {
            if (! is_array($specialty)) {
                continue;
            }

            $configuredId = trim((string) ($specialty['specialty_id'] ?? ''));
            $configuredNames = array_filter([
                trim((string) ($specialty['name'] ?? '')),
                ...(is_array($specialty['aliases'] ?? null) ? $specialty['aliases'] : []),
            ]);
            $idMatches = $requestedId !== '' && $configuredId !== '' && $requestedId === $configuredId;
            $nameMatches = false;

            foreach ($requestedNames as $requestedName) {
                foreach ($configuredNames as $configuredName) {
                    if (SpecialtyMatcher::matches($requestedName, (string) $configuredName)) {
                        $nameMatches = true;
                        break 2;
                    }
                }
            }

            if ($idMatches || $nameMatches) {
                return ['priority' => max(1, (int) ($specialty['priority'] ?? 1))];
            }
        }

        return null;
    }
}
