<?php

namespace App\Http\Controllers;

use App\Models\Chat;
use App\Models\Message;
use App\Models\SystemSetting;
use App\Models\User;
use App\Services\AuditService;
use App\Services\ChatAssignmentService;
use App\Services\OperatorAvailabilityService;
use App\Services\WebchatAvailabilityService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use PhpMqtt\Client\MqttClient;
use Spatie\Activitylog\Models\Activity;

class OperatorControlController extends Controller
{
    public function __construct(
        private readonly AuditService $auditService,
        private readonly ChatAssignmentService $chatAssignmentService,
        private readonly OperatorAvailabilityService $operatorAvailabilityService,
        private readonly WebchatAvailabilityService $webchatAvailabilityService,
    )
    {
    }

    public function index()
    {
        return Inertia::render('OperatorControl', $this->controlPayload());
    }

    public function snapshot()
    {
        return response()->json($this->controlPayload());
    }

    public function timeline(User $user)
    {
        $user->loadMissing('role');
        if (! $user->canHandleChats()) {
            return response()->json(['events' => []], 422);
        }

        return response()->json([
            'events' => Activity::query()
                ->with('causer')
                ->where(function ($query) use ($user) {
                    $query->where('causer_id', $user->id)
                        ->orWhere(function ($subjectQuery) use ($user) {
                            $subjectQuery->where('subject_type', User::class)->where('subject_id', $user->id);
                        });
                })
                ->whereIn('log_name', ['chat', 'messages', 'operator_control'])
                ->latest('id')
                ->limit(30)
                ->get()
                ->map(fn (Activity $activity) => [
                    'id' => $activity->id,
                    'event' => $activity->event,
                    'description' => $activity->description,
                    'created_at' => optional($activity->created_at)?->toIso8601String(),
                ])
                ->values(),
        ]);
    }

    private function controlPayload(): array
    {
        $maxAssignedChats = max(1, (int) (SystemSetting::query()
            ->where('key', 'operators.max_assigned_chats')
            ->value('value') ?? 5));

        $operators = User::query()->where('is_active', true)->with('role')->get()
            ->filter(fn (User $user) => $user->canHandleChats())
            ->map(function (User $operator) use ($maxAssignedChats) {
                $isDisconnected = ! $operator->last_operator_activity_at || $operator->last_operator_activity_at->lt(now()->subSeconds(90));
                $assignedChats = Chat::query()
                    ->with([
                        'contact:id,name,whatsapp_id',
                        'messages' => fn ($query) => $query->select('id', 'chat_id', 'sender', 'status', 'created_at')->latest('id'),
                    ])
                    ->where('operator_id', $operator->id)
                    ->where('status', 'open')
                    ->where('attention_status', 'assigned')
                    ->orderBy('assigned_at')
                    ->get();
                $assignedChatIds = $assignedChats->pluck('id');
                $unreadCount = Message::query()
                    ->whereIn('chat_id', $assignedChatIds)
                    ->where('sender', 'contact')
                    ->whereIn('status', ['received', 'delivered'])
                    ->count();

                $chatSummaries = $assignedChats->map(function (Chat $chat) {
                    $lastContactMessage = $chat->messages->firstWhere('sender', 'contact');
                    $lastReply = $chat->messages->first(fn (Message $message) => $message->sender !== 'contact');
                    $waiting = $lastContactMessage && (! $lastReply || $lastReply->created_at->lt($lastContactMessage->created_at));

                    return [
                        'id' => $chat->id,
                        'name' => $chat->contact?->name ?? $chat->contact?->whatsapp_id ?? "Chat #{$chat->id}",
                        'assigned_at' => $chat->assigned_at?->toIso8601String(),
                        'last_contact_at' => $lastContactMessage?->created_at?->toIso8601String(),
                        'waiting_response' => (bool) $waiting,
                        'waiting_minutes' => $waiting ? $lastContactMessage->created_at->diffInMinutes(now()) : 0,
                    ];
                })->values();
                $waitingChats = $chatSummaries->where('waiting_response', true);
                $periodMetrics = $this->periodMetrics($operator);

                return [
                    'id' => $operator->id,
                    'name' => $operator->name,
                    'email' => $operator->email,
                    'availability' => $isDisconnected || $operator->operator_availability === 'unavailable'
                        ? 'disconnected'
                        : ($operator->operator_availability ?: 'available'),
                    'assigned_count' => $assignedChats->count(),
                    'unread_count' => $unreadCount,
                    'waiting_count' => $waitingChats->count(),
                    'oldest_waiting_minutes' => $waitingChats->max('waiting_minutes') ?? 0,
                    'capacity' => $maxAssignedChats,
                    'assigned_chats' => $chatSummaries,
                    'current_chat' => $operator->current_chat_id
                        ? ($this->chatPayload(Chat::query()->with('contact:id,name,whatsapp_id')->find($operator->current_chat_id)))
                        : null,
                    'last_activity_at' => $operator->last_operator_activity_at?->toIso8601String(),
                    'archived_today' => Chat::query()
                        ->where('last_operator_id', $operator->id)
                        ->where('attention_status', 'archived')
                        ->whereDate('closed_at', today())
                        ->count(),
                    'period_metrics' => $periodMetrics,
                ];
            })->values();

        $availableSlots = $operators
            ->where('availability', 'available')
            ->sum(fn (array $operator) => max(0, $operator['capacity'] - $operator['assigned_count']));

        $pendingQuery = Chat::query()->where('status', 'open')->where('attention_status', 'pending_assignment');
        $oldestPendingAt = (clone $pendingQuery)->min('updated_at');

        return [
            'operators' => $operators,
            'pendingCount' => $pendingQuery->count(),
            'queue' => [
                'oldest_waiting_minutes' => $oldestPendingAt ? \Carbon\Carbon::parse($oldestPendingAt)->diffInMinutes(now()) : 0,
                'coverage_gap' => max(0, $pendingQuery->count() - $availableSlots),
            ],
            'maxAssignedChats' => $maxAssignedChats,
            'availableSlots' => $availableSlots,
        ];
    }

    public function updateMyAvailability(Request $request)
    {
        $data = $request->validate(['availability' => ['required', 'in:available,paused,unavailable']]);
        $user = $request->user();

        if (! $user || ! $user->canHandleChats()) {
            abort(403);
        }

        $before = $user->operator_availability;
        $user->update(['operator_availability' => $data['availability'], 'current_chat_id' => $data['availability'] === 'unavailable' ? null : $user->current_chat_id]);
        $this->auditService->record('operator_control', 'availability_changed', 'Actualizo su disponibilidad', $user, $user, [
            'before' => ['operator_availability' => $before],
            'after' => ['operator_availability' => $data['availability']],
        ]);
        if ($data['availability'] === 'unavailable') {
            $this->releaseOperatorChats($user, $user, 'El operador se marcó como no disponible');
        } elseif ($data['availability'] === 'available') {
            $this->chatAssignmentService->assignAllPending();
        }
        $this->publishControlUpdate(['type' => 'availability', 'operator_id' => $user->id]);

        return response()->json(['ok' => true, 'availability' => $user->operator_availability]);
    }

    private function periodMetrics(User $operator): array
    {
        $periods = [
            'today' => now()->startOfDay(),
            'week' => now()->startOfWeek(),
            'month' => now()->startOfMonth(),
        ];

        return collect($periods)->map(function ($from) use ($operator) {
            $chats = Chat::query()
                ->with(['messages' => fn ($query) => $query->select('id', 'chat_id', 'sender', 'created_at')->oldest('id')])
                ->where('last_operator_id', $operator->id)
                ->where('closed_at', '>=', $from)
                ->where('attention_status', 'archived')
                ->get();

            $attentionMinutes = $chats
                ->filter(fn (Chat $chat) => $chat->assigned_at && $chat->closed_at)
                ->map(fn (Chat $chat) => $chat->assigned_at->diffInMinutes($chat->closed_at));
            $firstResponseMinutes = $chats->map(function (Chat $chat) {
                $firstContact = $chat->messages->firstWhere('sender', 'contact');
                $firstReply = $firstContact
                    ? $chat->messages->first(fn (Message $message) => $message->sender !== 'contact' && $message->created_at->gte($firstContact->created_at))
                    : null;

                return $firstContact && $firstReply ? $firstContact->created_at->diffInMinutes($firstReply->created_at) : null;
            })->filter();

            return [
                'closed' => $chats->count(),
                'avg_attention_minutes' => (int) round($attentionMinutes->avg() ?? 0),
                'avg_first_response_minutes' => (int) round($firstResponseMinutes->avg() ?? 0),
            ];
        })->all();
    }

    public function updateAvailability(Request $request, User $user)
    {
        $data = $request->validate(['availability' => ['required', 'in:available,paused,unavailable'], 'reason' => ['nullable', 'string', 'max:500']]);
        $user->loadMissing('role');

        if (! $user->canHandleChats()) {
            return response()->json(['ok' => false, 'message' => 'Solo se puede actualizar la disponibilidad de operadores.'], 422);
        }

        $before = $user->operator_availability;
        $user->update(['operator_availability' => $data['availability'], 'current_chat_id' => $data['availability'] === 'unavailable' ? null : $user->current_chat_id]);
        $this->auditService->record('operator_control', 'availability_changed', 'Actualizo la disponibilidad de '.$user->name, $request->user(), $user, [
            'before' => ['operator_availability' => $before],
            'after' => ['operator_availability' => $data['availability']],
            'meta' => ['reason' => $data['reason'] ?? null],
        ]);
        if ($data['availability'] === 'unavailable') {
            $this->releaseOperatorChats($user, $request->user(), $data['reason'] ?? null);
        } elseif ($data['availability'] === 'available') {
            $this->chatAssignmentService->assignAllPending();
        }
        $this->publishControlUpdate(['type' => 'availability', 'operator_id' => $user->id]);

        return response()->json(['ok' => true, 'operator_id' => $user->id, 'availability' => $user->operator_availability]);
    }

    private function releaseOperatorChats(User $operator, ?User $actor, ?string $reason = null): void
    {
        $releasedChats = $this->operatorAvailabilityService->releaseOpenChats($operator);
        foreach ($releasedChats as $chat) {
            $this->auditService->recordChatAction('operator_unavailable_released', 'Libero el chat por indisponibilidad de '.$operator->name, $chat, $actor, [
                'meta' => [
                    'previous_operator_id' => $operator->id,
                    'reassigned_operator_id' => $chat->operator_id,
                    'reason' => $reason,
                ],
            ]);
        }
    }

    public function reassignChat(Request $request, Chat $chat)
    {
        $data = $request->validate([
            'operator_id' => ['nullable', 'integer', 'exists:users,id'],
            'automatic' => ['nullable', 'boolean'],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $isAdminAction = (bool) $request->route('admin_action');
        $auditReason = $data['reason'] ?? ($isAdminAction
            ? ($request->boolean('automatic')
                ? 'Intervención administrativa: liberó el chat para reasignación automática.'
                : 'Intervención administrativa: reasignó el chat a un operador.')
            : null);

        if ($chat->status !== 'open') {
            return response()->json(['ok' => false, 'message' => 'Solo se pueden reasignar chats abiertos.'], 422);
        }

        $actor = $request->user();
        if (! $actor?->hasPermission('can_administer_chats')
            && (int) ($chat->operator_id ?? 0) !== (int) ($actor?->id ?? 0)) {
            return response()->json(['ok' => false, 'message' => 'Solo el operador asignado o un administrador puede reasignar este chat.'], 403);
        }

        $before = ['operator_id' => $chat->operator_id, 'attention_status' => $chat->attention_status];
        if ($request->boolean('automatic')) {
            $chat->update([
                'operator_id' => null,
                'assigned_at' => null,
                'attention_status' => 'pending_assignment',
                'bot_enabled' => false,
            ]);
            $chat = $this->chatAssignmentService->assignPending($chat);
            $assigned = $chat->attention_status === 'assigned';
            $this->auditService->recordChatAction('operator_auto_reassigned', $assigned ? 'Reasigno el chat automáticamente' : 'Dejo el chat pendiente de asignación automática', $chat, $request->user(), [
                'before' => $before,
                'after' => ['operator_id' => $chat->operator_id, 'attention_status' => $chat->attention_status],
                'meta' => ['reason' => $auditReason],
            ]);
            $this->publishControlUpdate(['type' => 'automatic_reassignment', 'chat_id' => $chat->id, 'operator_id' => $chat->operator_id]);
            $this->publishChatUpdate($chat);

            return response()->json([
                'ok' => true,
                'chat_id' => $chat->id,
                'operator_id' => $chat->operator_id,
                'operator_name' => $chat->operator?->name,
                'pending' => ! $assigned,
            ]);
        }

        if (! $data['operator_id']) {
            return response()->json(['ok' => false, 'message' => 'Seleccioná un operador o usá la asignación automática.'], 422);
        }

        if (! $this->webchatAvailabilityService->canAssignOperator($chat)) {
            return response()->json(['ok' => false, 'message' => 'La atención por operadores para Webchat está fuera de horario. El bot puede continuar atendiendo.'], 422);
        }

        $operator = User::query()->with('role')->findOrFail($data['operator_id']);

        if (! $operator->is_active || ! $operator->canHandleChats() || $operator->operator_availability !== 'available') {
            return response()->json(['ok' => false, 'message' => 'El usuario seleccionado no es un operador activo.'], 422);
        }

        $activeChats = Chat::query()->where('operator_id', $operator->id)->where('status', 'open')->where('attention_status', 'assigned')->count();
        $maxAssignedChats = max(1, (int) (SystemSetting::query()->where('key', 'operators.max_assigned_chats')->value('value') ?? 5));
        if ($activeChats >= $maxAssignedChats) {
            return response()->json(['ok' => false, 'message' => 'El operador ya alcanzó su capacidad máxima.'], 422);
        }

        $chat->update([
            'operator_id' => $operator->id,
            'last_operator_id' => $operator->id,
            'assigned_at' => now(),
            'attention_status' => 'assigned',
            'bot_enabled' => false,
        ]);
        $this->auditService->recordChatAction('operator_reassigned', 'Reasigno el chat a '.$operator->name, $chat, $request->user(), [
            'before' => $before,
            'after' => ['operator_id' => $operator->id, 'operator_name' => $operator->name, 'attention_status' => 'assigned'],
            'meta' => ['reason' => $auditReason],
        ]);
        $this->publishControlUpdate(['type' => 'reassignment', 'chat_id' => $chat->id, 'operator_id' => $operator->id]);
        $this->publishChatUpdate($chat->fresh('operator'));

        return response()->json([
            'ok' => true,
            'chat_id' => $chat->id,
            'operator_id' => $operator->id,
            'operator_name' => $operator->name,
        ]);
    }

    public function updateMyCurrentChat(Request $request)
    {
        $data = $request->validate(['chat_id' => ['nullable', 'integer', 'exists:chats,id']]);
        $user = $request->user();

        if (! $user || ! $user->canHandleChats()) {
            abort(403);
        }

        $chatId = $data['chat_id'] ?? null;
        if ($chatId && ! Chat::query()->whereKey($chatId)->where('operator_id', $user->id)->where('status', 'open')->where('attention_status', 'assigned')->exists()) {
            return response()->json(['ok' => false, 'message' => 'El chat no está asignado al operador.'], 422);
        }

        $user->update(['current_chat_id' => $chatId, 'last_operator_activity_at' => now()]);
        $this->publishControlUpdate(['type' => 'presence', 'operator_id' => $user->id, 'chat_id' => $chatId]);

        return response()->json(['ok' => true, 'chat_id' => $chatId]);
    }

    public function heartbeat(Request $request)
    {
        $user = $request->user();
        if (! $user || ! $user->canHandleChats()) {
            abort(403);
        }

        $user->update(['last_operator_activity_at' => now()]);

        return response()->json(['ok' => true]);
    }

    private function chatPayload(?Chat $chat): ?array
    {
        if (! $chat) return null;
        return ['id' => $chat->id, 'name' => $chat->contact?->name ?? $chat->contact?->whatsapp_id ?? "Chat #{$chat->id}"];
    }

    private function publishControlUpdate(array $payload): void
    {
        $host = env('MQTT_HOST') ?: env('VITE_MOSQUITTO_HOST');
        if (! $host) return;

        try {
            $mqtt = new MqttClient((string) $host, 1883, 'laravel_operator_control_'.uniqid());
            $mqtt->connect();
            $mqtt->publish('operator-control/update', json_encode($payload), 0);
            $mqtt->disconnect();
        } catch (\Throwable $exception) {
            Log::warning('MQTT Error (operator control): '.$exception->getMessage());
        }
    }

    private function publishChatUpdate(Chat $chat): void
    {
        $host = env('MQTT_HOST') ?: env('VITE_MOSQUITTO_HOST');
        if (! $host) return;

        try {
            $mqtt = new MqttClient((string) $host, 1883, 'laravel_operator_chat_'.uniqid());
            $mqtt->connect();
            $mqtt->publish("operator/chat/{$chat->id}", json_encode([
                'chat_id' => (int) $chat->id,
                'active' => $chat->attention_status === 'assigned' && (bool) $chat->operator_id,
                'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null,
                'operator_name' => $chat->operator?->name,
                'bot_enabled' => (bool) $chat->bot_enabled,
                'status' => $chat->status,
                'attention_status' => $chat->attention_status,
            ]), 0);
            $mqtt->disconnect();
        } catch (\Throwable $exception) {
            Log::warning('MQTT Error (operator chat update): '.$exception->getMessage());
        }
    }
}
