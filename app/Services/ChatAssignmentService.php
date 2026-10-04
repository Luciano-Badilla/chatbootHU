<?php

namespace App\Services;

use App\Models\Chat;
use App\Models\SystemSetting;
use App\Models\User;
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
                ->sortBy(fn (User $user) => [$user->active_chat_count, $user->id])
                ->values();

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
                'rule' => 'menor_carga_elegible',
            ]];
        });

        if ($result['assignment']) {
            $assignment = $result['assignment'];
            $this->auditService->recordChatAction(
                'operator_auto_assigned',
                'Asignó automáticamente a '.$assignment['operator_name'].' por menor carga elegible',
                $result['chat'],
                null,
                ['after' => ['operator_id' => $assignment['operator_id'], 'operator_name' => $assignment['operator_name']], 'meta' => $assignment],
            );
        }

        return $result['chat'];
    }
}
