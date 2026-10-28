<?php

namespace App\Http\Controllers;

use App\Jobs\SendChatEventWebPushNotification;
use App\Models\Chat;
use App\Models\Message;
use App\Models\SystemSetting;
use App\Models\User;
use App\Services\AuditService;
use App\Services\ChatAssignmentService;
use App\Services\OperatorAvailabilityService;
use App\Services\WebchatAvailabilityService;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
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

    public function index(Request $request)
    {
        return Inertia::render('OperatorControl', $this->controlPayload($request->user()));
    }

    public function snapshot(Request $request)
    {
        return response()->json($this->controlPayload($request->user()));
    }

    public function timeline(User $user)
    {
        $user->loadMissing('role');
        if (! $user->canHandleChats()) {
            return response()->json(['events' => []], 422);
        }

        $activities = Activity::query()
            ->where(function ($query) use ($user) {
                $query->where('causer_id', $user->id)
                    ->orWhere(function ($subjectQuery) use ($user) {
                        $subjectQuery->where('subject_type', User::class)->where('subject_id', $user->id);
                    });
            })
            ->whereIn('log_name', ['chat', 'messages', 'operator_control'])
            ->latest('id')
            ->limit(30)
            ->get();

        $messageSubjectIds = $activities
            ->where('subject_type', Message::class)
            ->pluck('subject_id')
            ->filter()
            ->unique()
            ->values();
        $messageChatIds = $messageSubjectIds->isEmpty()
            ? collect()
            : Message::query()->whereIn('id', $messageSubjectIds)->pluck('chat_id', 'id');

        $chatIds = $activities->map(function (Activity $activity) use ($messageChatIds) {
            $properties = $activity->properties?->toArray() ?? [];

            return data_get($properties, 'chat_id')
                ?? ($activity->subject_type === Chat::class ? $activity->subject_id : null)
                ?? $messageChatIds->get($activity->subject_id);
        })->filter()->unique()->values();

        $chatRecords = $chatIds->isEmpty()
            ? collect()
            : Chat::query()->with('contact:id,name,whatsapp_id')->whereIn('id', $chatIds)->get()->keyBy('id');

        return response()->json([
            'events' => $activities->map(function (Activity $activity) use ($messageChatIds, $chatRecords) {
                $properties = $activity->properties?->toArray() ?? [];
                $chatContext = data_get($properties, 'chat', []);
                $chatId = data_get($properties, 'chat_id')
                    ?? ($activity->subject_type === Chat::class ? $activity->subject_id : null)
                    ?? $messageChatIds->get($activity->subject_id);
                $chat = $chatId ? $chatRecords->get($chatId) : null;
                $chatName = data_get($chatContext, 'contact_name')
                    ?: $chat?->contact?->name
                    ?: data_get($chatContext, 'contact_number')
                    ?: $chat?->contact?->whatsapp_id;

                return [
                    'id' => $activity->id,
                    'event' => $activity->event,
                    'description' => $activity->description,
                    'created_at' => optional($activity->created_at)?->toIso8601String(),
                    'chat_id' => $chatId ? (int) $chatId : null,
                    'chat_name' => $chatName ?: ($chatId ? "Chat #{$chatId}" : null),
                    'chat_number' => data_get($chatContext, 'contact_number') ?? $chat?->contact?->whatsapp_id,
                ];
            })->values(),
        ]);
    }

    private function controlPayload(?User $viewer): array
    {
        $canViewSpecialties = $viewer?->hasPermission('can_view_all_chats') ?? false;
        $maxAssignedChats = max(1, (int) (SystemSetting::query()
            ->where('key', 'operators.max_assigned_chats')
            ->value('value') ?? 5));

        $operators = User::query()->where('is_active', true)->with('role')->get()
            ->filter(fn (User $user) => $user->canHandleChats())
            ->map(function (User $operator) use ($maxAssignedChats, $canViewSpecialties) {
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
                    'assignment_specialties' => $canViewSpecialties ? ($operator->assignment_specialties ?? []) : [],
                    'availability' => $isDisconnected || $operator->operator_availability === 'unavailable'
                        ? 'disconnected'
                        : ($operator->operator_availability ?: 'paused'),
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
            'canManageUsers' => $viewer?->hasPermission('can_manage_users') ?? false,
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
        $earliestPeriod = collect($periods)->reduce(
            fn ($earliest, $from) => $earliest === null || $from->lt($earliest) ? $from : $earliest,
            null,
        );
        $chats = $this->closedChatsForMetrics($operator, $earliestPeriod);
        $chatActivities = $this->chatMetricActivities($chats);

        return collect($periods)->map(fn ($from) => $this->summarizeOperatorChats(
            $operator,
            $chats->filter(fn (Chat $chat) => $chat->closed_at?->gte($from))->values(),
            $chatActivities,
        ))->all();
    }

    private function closedChatsForMetrics(User $operator, $from): Collection
    {
        return Chat::query()
            ->with([
                'contact:id,name,whatsapp_id',
                'messages' => fn ($query) => $query
                    ->select('id', 'chat_id', 'sender', 'sender_subtype', 'operator_name', 'created_at')
                    ->orderBy('created_at')
                    ->orderBy('id'),
            ])
            ->where('last_operator_id', $operator->id)
            ->where('closed_at', '>=', $from)
            ->where('closed_at', '<=', now())
            ->where('attention_status', 'archived')
            ->orderByDesc('closed_at')
            ->get();
    }

    private function chatMetricActivities(Collection $chats): Collection
    {
        if ($chats->isEmpty()) {
            return collect();
        }

        return Activity::query()
            ->where('log_name', 'chat')
            ->where('subject_type', Chat::class)
            ->whereIn('subject_id', $chats->pluck('id'))
            ->whereIn('event', [
                'operator_assigned',
                'operator_auto_assigned',
                'operator_reassigned',
                'operator_auto_reassigned',
                'operator_finished_attention',
                'admin_archived_chat',
            ])
            ->get(['subject_id', 'event', 'created_at', 'properties'])
            ->groupBy('subject_id');
    }

    private function summarizeOperatorChats(User $operator, Collection $chats, Collection $chatActivities): array
    {
        $chatMetrics = $chats->map(function (Chat $chat) use ($operator, $chatActivities) {
            $events = $chatActivities->get($chat->id, collect());
            $assignedAt = $chat->assigned_at;
            $closingEvents = $events->filter(function (Activity $activity) use ($operator, $chat) {
                if (! in_array($activity->event, ['operator_finished_attention', 'admin_archived_chat'], true)) {
                    return false;
                }

                $properties = $activity->properties?->toArray() ?? [];
                $beforeOperatorId = data_get($properties, 'before.operator_id');

                return (int) ($beforeOperatorId ?? 0) === (int) $operator->id
                    && $activity->created_at?->lte($chat->closed_at?->copy()->addMinutes(2));
            })->sortByDesc('created_at');
            $closingEvent = $closingEvents->first();
            $closingProperties = $closingEvent?->properties?->toArray() ?? [];
            $attentionSeconds = data_get($closingProperties, 'meta.attention_seconds');

            if (! is_numeric($attentionSeconds) && ! $assignedAt) {
                $assignmentEvent = $events->filter(function (Activity $activity) use ($operator, $chat) {
                    if (! in_array($activity->event, [
                        'operator_assigned',
                        'operator_auto_assigned',
                        'operator_reassigned',
                        'operator_auto_reassigned',
                    ], true) || ! $activity->created_at?->lte($chat->closed_at)) {
                        return false;
                    }

                    $properties = $activity->properties?->toArray() ?? [];
                    $assignedOperatorId = data_get($properties, 'after.operator_id')
                        ?? data_get($properties, 'meta.operator_id')
                        ?? data_get($properties, 'meta.reassigned_operator_id');

                    return (int) ($assignedOperatorId ?? 0) === (int) $operator->id;
                })->sortByDesc('created_at')->first();

                $assignedAt = $assignmentEvent?->created_at;
            }

            if (! is_numeric($attentionSeconds) && $assignedAt && $chat->closed_at) {
                $attentionSeconds = max(0, $assignedAt->diffInSeconds($chat->closed_at));
            }

            $messages = $chat->messages->sortBy(fn (Message $message) => [
                $message->created_at?->getTimestamp() ?? 0,
                (int) $message->id,
            ])->values();
            $firstContact = $messages->first(fn (Message $message) =>
                $message->sender === 'contact' || $message->sender_subtype === 'contact'
            );
            $firstOperatorReply = $firstContact
                ? $messages->first(function (Message $message) use ($firstContact, $operator) {
                    $isOperatorReply = $message->sender_subtype === 'operator'
                        || ($message->sender === 'user' && filled($message->operator_name));
                    $isThisOperator = ! filled($message->operator_name)
                        || mb_strtolower(trim($message->operator_name)) === mb_strtolower(trim($operator->name));

                    return $isOperatorReply
                        && $isThisOperator
                        && $message->created_at?->gte($firstContact->created_at);
                })
                : null;
            $firstResponseSeconds = $firstContact && $firstOperatorReply
                ? max(0, $firstContact->created_at->diffInSeconds($firstOperatorReply->created_at))
                : null;
            $attentionMinutes = is_numeric($attentionSeconds) ? (int) round(((int) $attentionSeconds) / 60) : null;
            $firstResponseMinutes = $firstResponseSeconds !== null ? (int) round($firstResponseSeconds / 60) : null;

            return [
                'id' => (int) $chat->id,
                'name' => $chat->contact?->name ?? $chat->contact?->whatsapp_id ?? "Chat #{$chat->id}",
                'number' => $chat->contact?->whatsapp_id,
                'channel' => $chat->channel ?? 'whatsapp',
                'closed_at' => $chat->closed_at?->toIso8601String(),
                'attention_minutes' => $attentionMinutes,
                'first_response_minutes' => $firstResponseMinutes,
            ];
        });
        $attentionMetrics = $chatMetrics->pluck('attention_minutes')->filter(fn ($value) => $value !== null);
        $firstResponseMetrics = $chatMetrics->pluck('first_response_minutes')->filter(fn ($value) => $value !== null);

        return [
            'closed' => $chatMetrics->count(),
            'avg_attention_minutes' => $attentionMetrics->isNotEmpty() ? (int) round($attentionMetrics->avg()) : null,
            'attention_samples' => $attentionMetrics->count(),
            'avg_first_response_minutes' => $firstResponseMetrics->isNotEmpty() ? (int) round($firstResponseMetrics->avg()) : null,
            'first_response_samples' => $firstResponseMetrics->count(),
            'chat_samples' => $chatMetrics->take(5)->values(),
        ];
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
        if ((int) ($before['operator_id'] ?? 0) !== (int) $operator->id) {
            SendChatEventWebPushNotification::dispatch((int) $chat->id, 'operator_assigned', (int) $operator->id)->afterCommit();
            if ($chat->channel === 'webchat') {
                SendChatEventWebPushNotification::dispatch((int) $chat->id, 'webchat_operator_joined', (int) $operator->id)->afterCommit();
            }
        }
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
