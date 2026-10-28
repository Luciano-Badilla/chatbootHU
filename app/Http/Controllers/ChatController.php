<?php

namespace App\Http\Controllers;

use Carbon\Carbon;
use App\Jobs\SendChatEventWebPushNotification;
use App\Models\Chat;
use App\Models\Message;
use App\Models\SystemSetting;
use App\Models\User;
use App\Services\AuditService;
use App\Services\BotInactivityService;
use App\Services\ChatAssignmentService;
use App\Services\WebchatAvailabilityService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use PhpMqtt\Client\MqttClient;

class ChatController extends Controller
{
    public function __construct(
        private readonly AuditService $auditService,
        private readonly BotInactivityService $botInactivityService,
        private readonly ChatAssignmentService $chatAssignmentService,
        private readonly WebchatAvailabilityService $webchatAvailabilityService,
    ) {}

    public function index(Request $request)
    {
        $botName = SystemSetting::query()->where('key', 'webchat.title')->value('value') ?: 'Asistente virtual';
        $defaultChannelFilter = SystemSetting::query()->where('key', 'chat_panel.default_channel_filter')->value('value') ?: 'all';
        if (! in_array($defaultChannelFilter, ['all', 'whatsapp', 'webchat'], true)) {
            $defaultChannelFilter = 'all';
        }

        $canViewAll = $request->user()?->hasPermission('can_view_all_chats') ?? false;
        $initialStatusFilters = $canViewAll ? [] : ['assigned'];
        $initialChannelFilters = $defaultChannelFilter === 'all' ? [] : [$defaultChannelFilter];
        $preferredChatId = Chat::query()
            ->where('operator_id', $request->user()?->id)
            ->where('attention_status', 'assigned')
            ->orderByDesc(Message::query()
                ->select('created_at')
                ->whereColumn('messages.chat_id', 'chats.id')
                ->latest('id')
                ->limit(1))
            ->orderByDesc('id')
            ->value('id');

        $selectedChatId = $request->query('chat') ?: $preferredChatId;
        $page = $this->chatPanelPage(
            $initialStatusFilters,
            $initialChannelFilters,
            '',
            0,
            50,
            $selectedChatId,
            $request->user(),
            $botName,
        );

        return Inertia::render('MessagePanel', [
            'chats' => $page['data'],
            'chatPanel' => [
                'defaultChannelFilter' => $defaultChannelFilter,
                'initialStatusFilters' => $initialStatusFilters,
                'initialChannelFilters' => $initialChannelFilters,
                'counts' => $page['counts'],
                'hasMore' => $page['has_more'],
                'nextOffset' => $page['next_offset'],
                'preferredChatId' => $preferredChatId ? (string) $preferredChatId : null,
            ],
        ]);
    }

    public function listForPanel(Request $request)
    {
        $validated = $request->validate([
            'statuses' => ['sometimes', 'array'],
            'statuses.*' => ['string', 'in:bot,assigned,pending_assignment,archived'],
            'channels' => ['sometimes', 'array'],
            'channels.*' => ['string', 'in:whatsapp,webchat'],
            'search' => ['sometimes', 'nullable', 'string', 'max:200'],
            'offset' => ['sometimes', 'integer', 'min:0'],
            'selected_chat_id' => ['nullable', 'integer', 'min:1'],
            'archived_scope' => ['sometimes', 'string', 'in:all,mine'],
            'operator_id' => ['sometimes', 'nullable', 'integer', 'min:1', 'exists:users,id'],
        ]);

        $operatorId = isset($validated['operator_id']) ? (int) $validated['operator_id'] : null;
        if ($operatorId !== null && ! ($request->user()?->hasPermission('can_view_all_chats') ?? false)) {
            abort(403);
        }

        $page = $this->chatPanelPage(
            $validated['statuses'] ?? [],
            $validated['channels'] ?? [],
            trim($validated['search'] ?? ''),
            (int) ($validated['offset'] ?? 0),
            50,
            $validated['selected_chat_id'] ?? null,
            $request->user(),
            null,
            $validated['archived_scope'] ?? 'all',
            $operatorId,
        );

        return response()->json($page);
    }

    public function operatorsForPanel()
    {
        $operators = User::query()
            ->with('role')
            ->orderBy('name')
            ->get(['id', 'name', 'role_id', 'is_active'])
            ->filter(fn (User $operator) => $operator->canHandleChats())
            ->map(fn (User $operator) => [
                'id' => (int) $operator->id,
                'name' => $operator->name,
                'is_active' => (bool) $operator->is_active,
            ])
            ->values();

        return response()->json(['operators' => $operators]);
    }

    public function markAsReadMessages(Request $request, $chatId)
    {
        $chat = Chat::with('contact', 'operator')->findOrFail($chatId);
        $updated = Message::where('chat_id', $chatId)->where('status', 'received')->update(['status' => 'read']);

        if ($updated > 0) {
            $this->auditService->recordMessageAction(
                'marked_read',
                'Marco mensajes como leidos',
                $chat,
                $request->user(),
                null,
                [
                    'meta' => [
                        'read_messages_count' => $updated,
                    ],
                ],
            );
        }

        return response()->json([
            'ok' => true,
            'read_messages_count' => $updated,
        ]);
    }

    public function open(Request $request, Chat $chat)
    {
        $actor = $request->user();
        $currentOperatorId = (int) ($chat->operator_id ?? 0);
        $actorId = (int) ($actor?->id ?? 0);

        $mode = 'editable';
        if ($chat->bot_enabled) {
            $mode = 'bot_enabled';
        } elseif ($currentOperatorId > 0 && $currentOperatorId !== $actorId) {
            $mode = 'operator_locked';
        }

        $this->auditService->recordChatAction(
            'opened',
            'Abrio chat desde el panel',
            $chat,
            $actor,
            [
                'meta' => [
                    'mode' => $mode,
                    'operator_locked' => $mode === 'operator_locked',
                    'bot_enabled' => (bool) $chat->bot_enabled,
                ],
            ],
        );

        return response()->json([
            'ok' => true,
            'mode' => $mode,
        ]);
    }

    public function updateOperator(Request $request, Chat $chat)
    {
        $data = $request->validate([
            'active' => 'required|boolean',
            'operator_id' => 'nullable|integer',
            'operator_name' => 'nullable|string|max:255',
        ]);

        $authUser = $request->user();
        $operatorId = $authUser?->id ?? ($data['operator_id'] ?? null);
        $operatorName = $authUser?->name ?? ($data['operator_name'] ?? null);
        $chat->loadMissing('operator');
        $beforeOperatorId = $chat->operator_id ? (int) $chat->operator_id : null;
        $beforeOperatorName = $chat->operator?->name ?? null;
        $isAdminTakeover = (bool) $data['active']
            && $beforeOperatorId !== null
            && $beforeOperatorId !== (int) $operatorId
            && ($authUser?->hasPermission('can_administer_chats') ?? false)
            && $chat->status === 'open'
            && $chat->attention_status === 'assigned';

        if ($data['active']) {
            if (! $this->webchatAvailabilityService->canAssignOperator($chat)) {
                return response()->json([
                    'ok' => false,
                    'message' => 'La atención por operadores para Webchat está fuera de horario. El bot puede continuar atendiendo.',
                ], 422);
            }

            if (! $operatorId) {
                return response()->json([
                    'ok' => false,
                    'message' => 'No operator id available.',
                ], 422);
            }

            if ($chat->operator_id && (int) $chat->operator_id !== (int) $operatorId && ! $isAdminTakeover) {
                $chat->load('operator');
                $this->auditService->recordChatAction(
                    'operator_assignment_conflict',
                    'Intento tomar un chat ocupado por otro operador',
                    $chat,
                    $authUser,
                    [
                        'before' => [
                            'operator_id' => $beforeOperatorId,
                            'operator_name' => $beforeOperatorName,
                        ],
                        'after' => [
                            'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null,
                            'operator_name' => $chat->operator?->name,
                        ],
                        'meta' => [
                            'requested_active' => true,
                            'requested_operator_id' => $operatorId,
                            'requested_operator_name' => $operatorName,
                        ],
                    ],
                );

                return response()->json([
                    'ok' => false,
                    'conflict' => true,
                    'chat_id' => (int) $chat->id,
                    'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null,
                    'operator_name' => $chat->operator?->name,
                    'message' => 'Este chat ya está siendo atendido por otro operador.',
                ], 409);
            }

            $chat->operator_id = (int) $operatorId;
            $chat->last_operator_id = (int) $operatorId;
            $chat->assigned_at = now();
            $chat->attention_status = 'assigned';
            $chat->bot_enabled = false;
        } else {
            $chat->operator_id = null;
            $chat->assigned_at = null;
            if ($chat->status === 'open') {
                $chat->attention_status = 'pending_assignment';
            }
            $operatorId = null;
            $operatorName = null;
        }

        $chat->save();
        $chat->load('operator');

        if ($data['active'] && $beforeOperatorId !== (int) $operatorId) {
            SendChatEventWebPushNotification::dispatch((int) $chat->id, 'operator_assigned', (int) $operatorId)->afterCommit();
            if ($chat->channel === 'webchat') {
                SendChatEventWebPushNotification::dispatch((int) $chat->id, 'webchat_operator_joined', (int) $operatorId)->afterCommit();
            }
        }

        $this->chatAssignmentService->assignAllPending();

        $this->auditService->recordChatAction(
            $data['active'] ? 'operator_assigned' : 'operator_released',
            $data['active']
                ? ($isAdminTakeover ? 'El administrador tomo un chat asignado a otro operador' : 'Tomo el chat')
                : 'Libero el chat',
            $chat,
            $authUser,
            [
                'before' => [
                    'operator_id' => $beforeOperatorId,
                    'operator_name' => $beforeOperatorName,
                ],
                'after' => [
                    'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null,
                    'operator_name' => $chat->operator?->name ?? $operatorName,
                ],
            ],
        );

        $payload = [
            'chat_id' => (int) $chat->id,
            'active' => (bool) $data['active'],
            'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null,
            'operator_name' => $chat->operator?->name ?? $operatorName,
        ];

        $this->publishOperatorStatus((int) $chat->id, $payload);
        if ($data['active']) {
            $this->publishBotStatus((int) $chat->id, false);
        }

        return response()->json([
            'ok' => true,
            'chat_id' => (int) $chat->id,
            'operator_id' => $payload['operator_id'],
            'operator_name' => $payload['operator_name'],
            'active' => $payload['active'],
        ]);
    }

    public function finishOperatorAttention(Request $request, Chat $chat)
    {
        $actor = $request->user();
        $actorId = (int) ($actor?->id ?? 0);

        if (! $actorId || (int) ($chat->operator_id ?? 0) !== $actorId) {
            return response()->json([
                'ok' => false,
                'message' => 'Solo el operador asignado puede finalizar la atencion.',
            ], 403);
        }

        $chat->loadMissing('operator');
        $before = [
            'bot_enabled' => (bool) $chat->bot_enabled,
            'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null,
            'operator_name' => $chat->operator?->name,
            'bot_node_id' => $chat->bot_node_id,
        ];

        $flow = $this->botInactivityService->getDefaultFlow($chat->channel ?? 'whatsapp');
        if (! $flow || ! $flow->start_node_id) {
            return response()->json([
                'ok' => false,
                'message' => 'No hay un flujo activo para reiniciar el bot.',
            ], 422);
        }

        $attentionSeconds = $chat->assigned_at
            ? max(0, (int) $chat->assigned_at->diffInSeconds(now()))
            : null;
        $this->botInactivityService->resetChatToStartFromFlow($chat, $flow, 'operator_finished_attention');
        $chat->last_operator_id = $actorId;
        $chat->operator_id = null;
        $chat->assigned_at = null;
        $chat->status = 'closed';
        $chat->attention_status = 'archived';
        $chat->closed_at = now();
        $chat->closed_by = 'operator';
        $chat->closed_by_user_id = $actorId;
        $chat->save();
        $chat->load('operator');

        $this->chatAssignmentService->assignAllPending();

        $after = [
            'bot_enabled' => (bool) $chat->bot_enabled,
            'operator_id' => null,
            'operator_name' => null,
            'status' => 'closed',
            'attention_status' => 'archived',
            'bot_node_id' => $chat->bot_node_id,
        ];

        $this->auditService->recordChatAction(
            'operator_finished_attention',
            'Finalizo la atencion y reactivo el bot',
            $chat,
            $actor,
            [
                'before' => $before,
                'after' => $after,
                'meta' => ['attention_seconds' => $attentionSeconds],
            ],
        );

        $this->publishOperatorStatus((int) $chat->id, [
            'chat_id' => (int) $chat->id,
            'active' => false,
            'operator_id' => null,
            'operator_name' => null,
            'status' => 'closed',
            'attention_status' => 'archived',
            'bot_enabled' => true,
        ]);

        $this->publishBotStatus((int) $chat->id, true);

        return response()->json([
            'ok' => true,
            'chat_id' => (int) $chat->id,
            'bot_enabled' => true,
            'operator_id' => null,
            'operator_name' => null,
        ]);
    }

    public function archiveByAdmin(Request $request, Chat $chat)
    {
        $reasonIsRequired = (int) ($chat->operator_id ?? 0) !== (int) ($request->user()?->id ?? 0);
        $data = $request->validate([
            'reason' => $reasonIsRequired
                ? ['required', 'string', 'max:500']
                : ['nullable', 'string', 'max:500'],
        ]);

        if ($chat->status === 'closed') {
            return response()->json(['ok' => false, 'message' => 'El chat ya esta archivado.'], 422);
        }

        $flow = $this->botInactivityService->getDefaultFlow($chat->channel ?? 'whatsapp');
        if (! $flow || ! $flow->start_node_id) {
            return response()->json(['ok' => false, 'message' => 'No hay un flujo activo para reactivar el bot.'], 422);
        }

        $chat->loadMissing('operator');
        $before = $this->adminChatState($chat);
        $previousOperatorId = $chat->operator_id;
        $attentionSeconds = $chat->assigned_at
            ? max(0, (int) $chat->assigned_at->diffInSeconds(now()))
            : null;
        $this->botInactivityService->resetChatToStartFromFlow($chat, $flow, 'admin_archived');
        $chat->last_operator_id = $previousOperatorId ?? $chat->last_operator_id;
        $chat->operator_id = null;
        $chat->assigned_at = null;
        $chat->status = 'closed';
        $chat->attention_status = 'archived';
        $chat->closed_at = now();
        $chat->closed_by = 'admin';
        $chat->closed_by_user_id = $request->user()?->id;
        $chat->save();
        $chat->load('operator');

        $this->auditService->recordChatAction('admin_archived_chat', 'Archivo el chat y reactivo el bot', $chat, $request->user(), [
            'before' => $before, 'after' => $this->adminChatState($chat), 'meta' => [
                'reason' => $data['reason'] ?? null,
                'attention_seconds' => $attentionSeconds,
            ],
        ]);
        $this->publishChatLifecycle($chat);

        return response()->json(['ok' => true, 'chat' => $this->adminChatPayload($chat)]);
    }

    public function reopenByAdmin(Request $request, Chat $chat)
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);

        if ($chat->status !== 'closed') {
            return response()->json(['ok' => false, 'message' => 'Solo se pueden reabrir chats archivados.'], 422);
        }

        $flow = $this->botInactivityService->getDefaultFlow($chat->channel ?? 'whatsapp');
        if (! $flow || ! $flow->start_node_id) {
            return response()->json(['ok' => false, 'message' => 'No hay un flujo activo para reabrir el chat.'], 422);
        }

        $before = $this->adminChatState($chat);
        $this->botInactivityService->resetChatToStartFromFlow($chat, $flow, 'admin_reopened');
        $chat->operator_id = null;
        $chat->assigned_at = null;
        $chat->status = 'open';
        $chat->attention_status = 'bot';
        $chat->closed_at = null;
        $chat->closed_by = null;
        $chat->closed_by_user_id = null;
        $chat->save();

        $this->auditService->recordChatAction('admin_reopened_chat', 'Reabrio el chat con el bot activo', $chat, $request->user(), [
            'before' => $before, 'after' => $this->adminChatState($chat), 'meta' => ['reason' => $data['reason']],
        ]);
        $this->publishChatLifecycle($chat);

        return response()->json(['ok' => true, 'chat' => $this->adminChatPayload($chat)]);
    }

    public function getMessages(Request $request, $chatId)
    {
        $limit = max(10, min((int) $request->query('limit', 50), 100));
        $beforeId = $request->integer('before_id');
        $aroundId = $request->integer('around_id');

        if ($aroundId > 0) {
            $messagesBefore = Message::query()
                ->where('chat_id', $chatId)
                ->where('id', '<=', $aroundId)
                ->orderByDesc('id')
                ->limit(intdiv($limit, 2) + 1)
                ->get()
                ->reverse()
                ->values();

            if (! $messagesBefore->contains(fn (Message $message) => (int) $message->id === $aroundId)) {
                return response()->json(['message' => 'No se encontró el mensaje en este chat.'], 404);
            }

            $afterLimit = max(0, $limit - $messagesBefore->count());
            $messagesAfter = $afterLimit > 0
                ? Message::query()
                    ->where('chat_id', $chatId)
                    ->where('id', '>', $aroundId)
                    ->orderBy('id')
                    ->limit($afterLimit)
                    ->get()
                : collect();
            $messages = $messagesBefore->concat($messagesAfter)->values();
            $oldestId = $messages->first()?->id;
            $hasMore = $oldestId !== null && Message::query()
                ->where('chat_id', $chatId)
                ->where('id', '<', $oldestId)
                ->exists();

            return response()->json([
                'messages' => $messages,
                'has_more' => $hasMore,
                'total' => Message::query()->where('chat_id', $chatId)->count(),
            ]);
        }

        $query = Message::query()
            ->where('chat_id', $chatId)
            ->when($beforeId > 0, fn ($builder) => $builder->where('id', '<', $beforeId));

        $messages = $query
            ->orderByDesc('id')
            ->limit($limit + 1)
            ->get();

        $hasMore = $messages->count() > $limit;
        $messages = $messages->take($limit)->reverse()->values();

        return response()->json([
            'messages' => $messages,
            'has_more' => $hasMore,
            'total' => Message::where('chat_id', $chatId)->count(),
        ]);
    }

    public function snapshot(Request $request)
    {
        $botName = SystemSetting::query()->where('key', 'webchat.title')->value('value') ?: 'Asistente virtual';
        $validated = $request->validate([
            'ids' => ['sometimes', 'array', 'max:100'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);
        $ids = $validated['ids'] ?? [];

        $query = $this->chatPanelSummaryQuery();
        if ($ids !== []) {
            $query->whereIn('chats.id', $ids);
        } else {
            // Compatibilidad con clientes antiguos: nunca devolver el historial completo.
            $query->orderByDesc('last_message_at')->orderByDesc('chats.id')->limit(50);
        }

        $rows = $query->get()->map(fn (Chat $chat) => $this->chatPanelSummary($chat, $botName));

        return response()->json([
            'ok' => true,
            'data' => $rows,
            'counts' => $this->chatPanelCounts($request->user()),
        ]);
    }

    /**
     * Return one bounded page of chat summaries while keeping the sidebar counts global.
     *
     * @param  array<int, string>  $statuses
     * @param  array<int, string>  $channels
     * @return array<string, mixed>
     */
    private function chatPanelPage(
        array $statuses,
        array $channels,
        string $search,
        int $offset,
        int $limit,
        int|string|null $selectedChatId,
        $user,
        ?string $botName = null,
        string $archivedScope = 'all',
        ?int $operatorId = null,
    ): array {
        $query = $this->chatPanelListQuery($statuses, $channels, $search, $user, $archivedScope, $operatorId);
        $pageRows = (clone $query)
            ->orderByDesc('last_message_at')
            ->orderByDesc('chats.id')
            ->offset($offset)
            ->limit($limit + 1)
            ->get();
        $matchedSearchChatIds = $search !== ''
            ? $pageRows->take($limit)->pluck('id')->map(fn ($id) => (string) $id)->flip()
            : collect();

        $hasMore = $pageRows->count() > $limit;
        $pageRows = $pageRows->take($limit)->values();
        $nextOffset = $offset + $pageRows->count();

        if ($selectedChatId && ! $pageRows->contains(fn (Chat $chat) => (string) $chat->id === (string) $selectedChatId)) {
            $selected = $this->chatPanelSummaryQuery()
                ->where('chats.id', $selectedChatId)
                ->first();
            if ($selected) {
                if ($search !== '' && (clone $query)->where('chats.id', $selected->id)->exists()) {
                    $matchedSearchChatIds->put((string) $selected->id, true);
                }
                $pageRows->push($selected);
            }
        }

        $botName ??= SystemSetting::query()->where('key', 'webchat.title')->value('value') ?: 'Asistente virtual';
        $searchMessageIds = $search !== '' && $pageRows->isNotEmpty()
            ? Message::query()
                ->whereIn('chat_id', $pageRows->pluck('id')->unique())
                ->where('body', 'like', '%'.$search.'%')
                ->selectRaw('chat_id, MAX(id) as message_id')
                ->groupBy('chat_id')
                ->pluck('message_id', 'chat_id')
            : collect();

        return [
            'ok' => true,
            'data' => $pageRows->map(fn (Chat $chat) => $this->chatPanelSummary(
                $chat,
                $botName,
                $searchMessageIds->get($chat->id),
                $matchedSearchChatIds->has((string) $chat->id) ? mb_strtolower($search) : null,
            ))->values(),
            'has_more' => $hasMore,
            'next_offset' => $nextOffset,
            'counts' => $this->chatPanelCounts($user, $operatorId),
        ];
    }

    private function chatPanelListQuery(
        array $statuses,
        array $channels,
        string $search,
        $user,
        string $archivedScope = 'all',
        ?int $operatorId = null,
    )
    {
        $query = $this->chatPanelSummaryQuery();

        if ($statuses === []) {
            // El filtro vacío de la interfaz muestra las bandejas activas, sin Archivados.
            $query->where('chats.attention_status', '!=', 'archived');
        } else {
            $canViewAll = $user?->hasPermission('can_view_all_chats') ?? false;
            $query->where(function ($statusQuery) use ($statuses, $canViewAll, $user, $archivedScope) {
                foreach (array_unique($statuses) as $status) {
                    if ($status === 'assigned' && ! $canViewAll) {
                        $statusQuery->orWhere(function ($assignedQuery) use ($user) {
                            $assignedQuery->where('chats.attention_status', 'assigned')
                                ->where('chats.operator_id', $user?->id);
                        });
                    } elseif ($status === 'archived' && $archivedScope === 'mine' && ! $canViewAll) {
                        $statusQuery->orWhere(function ($archivedQuery) use ($user) {
                            $archivedQuery->where('chats.attention_status', 'archived')
                                ->where('chats.last_operator_id', $user?->id);
                        });
                    } else {
                        $statusQuery->orWhere('chats.attention_status', $status);
                    }
                }
            });
        }

        if ($operatorId !== null) {
            $query->where(function ($operatorQuery) use ($operatorId) {
                $operatorQuery->where(function ($assignedQuery) use ($operatorId) {
                    $assignedQuery->where('chats.attention_status', 'assigned')
                        ->where('chats.operator_id', $operatorId);
                })->orWhere(function ($archivedQuery) use ($operatorId) {
                    $archivedQuery->where('chats.attention_status', 'archived')
                        ->where('chats.last_operator_id', $operatorId);
                });
            });
        }

        if ($channels !== []) {
            $query->where(function ($channelQuery) use ($channels) {
                foreach (array_unique($channels) as $channel) {
                    if ($channel === 'whatsapp') {
                        $channelQuery->orWhere('chats.channel', 'whatsapp')
                            ->orWhereNull('chats.channel');
                    } else {
                        $channelQuery->orWhere('chats.channel', $channel);
                    }
                }
            });
        }

        if ($search !== '') {
            $like = '%'.$search.'%';
            $phoneSearch = preg_replace('/\D+/', '', $search);
            $variableSearch = '%'.addcslashes($search, '\\%_').'%';
            $numericVariableSearch = preg_match('/^[\d\s.\-]+$/u', $search) && strlen($phoneSearch) >= 3
                ? '%'.implode('%', str_split($phoneSearch)).'%'
                : null;
            $query->where(function ($searchQuery) use ($like, $phoneSearch, $variableSearch, $numericVariableSearch) {
                $searchQuery
                    ->whereHas('contact', function ($contactQuery) use ($like) {
                        $contactQuery->where('name', 'like', $like)
                            ->orWhere('whatsapp_id', 'like', $like);
                    })
                    ->orWhereHas('messages', fn ($messageQuery) => $messageQuery->where('body', 'like', $like))
                    ->orWhereRaw("JSON_SEARCH(chats.bot_state, 'one', ?, NULL, '$.vars.*') IS NOT NULL", [$variableSearch])
                    ->orWhereRaw("JSON_SEARCH(chats.bot_state, 'one', ?, NULL, '$.vars_by_date.*.*.value') IS NOT NULL", [$variableSearch]);
                if ($numericVariableSearch !== null) {
                    $searchQuery->orWhereRaw("CAST(JSON_EXTRACT(chats.bot_state, '$.vars') AS CHAR) LIKE ?", [$numericVariableSearch]);
                }
                if ($phoneSearch !== '') {
                    $searchQuery->orWhereHas('contact', function ($contactQuery) use ($phoneSearch) {
                        $contactQuery->where('whatsapp_id', 'like', '%'.$phoneSearch.'%');
                    });
                }
            });
        }

        return $query;
    }

    private function chatPanelSummaryQuery()
    {
        return Chat::query()
            ->with([
                'contact:id,name,whatsapp_id,profile_pic',
                'operator:id,name',
                'lastOperator:id,name',
                'botFlow:id,name',
                'botNode:id,key',
            ])
            ->withCount(['messages as unread_count' => fn ($query) => $query->where('status', 'received')])
            ->addSelect([
                'last_message_body' => Message::query()
                    ->select('body')
                    ->whereColumn('messages.chat_id', 'chats.id')
                    ->latest('id')
                    ->limit(1),
                'last_message_at' => Message::query()
                    ->select('created_at')
                    ->whereColumn('messages.chat_id', 'chats.id')
                    ->latest('id')
                    ->limit(1),
            ]);
    }

    private function chatPanelSummary(
        Chat $chat,
        string $botName,
        int|string|null $searchMessageId = null,
        ?string $searchMatch = null,
    ): array
    {
        return [
            'id' => (int) $chat->id,
            'chat_id' => (int) $chat->id,
            'name' => $chat->contact?->name ?? $chat->contact?->whatsapp_id ?? 'Sin nombre',
            'number' => ($chat->channel ?? 'whatsapp') === 'webchat'
                ? 'Webchat'
                : '+'.$chat->contact?->whatsapp_id,
            'channel' => $chat->channel ?? 'whatsapp',
            'lastMessage' => $chat->last_message_body ?? '',
            // La hora de la lista corresponde al último mensaje, no a cambios operativos.
            'timestamp' => $chat->last_message_at
                ? Carbon::parse($chat->last_message_at)->toIso8601String()
                : null,
            'unread' => (int) ($chat->unread_count ?? 0),
            'online' => false,
            'avatar' => $chat->contact?->profile_pic,
            'bot_enabled' => (bool) $chat->bot_enabled,
            'bot_name' => $botName,
            'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null,
            'operator_name' => $chat->operator?->name,
            'last_operator_id' => $chat->last_operator_id ? (int) $chat->last_operator_id : null,
            'last_operator_name' => $chat->lastOperator?->name,
            'bot_state' => $chat->bot_state ?? [],
            'search_message_id' => $searchMessageId ? (int) $searchMessageId : null,
            'search_match' => $searchMatch,
            'status' => $chat->status,
            'attention_status' => $chat->attention_status,
            'assigned_at' => $chat->assigned_at?->toIso8601String(),
            'closed_at' => $chat->closed_at?->toIso8601String(),
            'closed_by' => $chat->closed_by,
            'bot_flow_id' => $chat->bot_flow_id ? (int) $chat->bot_flow_id : null,
            'bot_flow_name' => $chat->botFlow?->name,
            'bot_node_id' => $chat->bot_node_id ? (int) $chat->bot_node_id : null,
            'bot_node_name' => $chat->botNode?->key,
            'bot_step' => $chat->bot_step,
        ];
    }

    private function chatPanelCounts($user, ?int $operatorId = null): array
    {
        $statusQuery = Chat::query();
        $channelQuery = Chat::query();

        if ($operatorId !== null) {
            $applyOperatorFilter = function ($query) use ($operatorId) {
                $query->where(function ($operatorQuery) use ($operatorId) {
                    $operatorQuery->where(function ($assignedQuery) use ($operatorId) {
                        $assignedQuery->where('attention_status', 'assigned')
                            ->where('operator_id', $operatorId);
                    })->orWhere(function ($archivedQuery) use ($operatorId) {
                        $archivedQuery->where('attention_status', 'archived')
                            ->where('last_operator_id', $operatorId);
                    });
                });
            };
            $applyOperatorFilter($statusQuery);
            $applyOperatorFilter($channelQuery);
        }

        $statusCounts = (clone $statusQuery)
            ->selectRaw('attention_status, COUNT(*) as total')
            ->groupBy('attention_status')
            ->pluck('total', 'attention_status');
        $channelCounts = $channelQuery
            ->selectRaw("SUM(CASE WHEN channel = 'webchat' THEN 1 ELSE 0 END) as webchat_total")
            ->selectRaw("SUM(CASE WHEN channel IS NULL OR channel != 'webchat' THEN 1 ELSE 0 END) as whatsapp_total")
            ->first();
        $canViewAll = $user?->hasPermission('can_view_all_chats') ?? false;

        return [
            'bot' => $operatorId !== null ? 0 : (int) ($statusCounts['bot'] ?? 0),
            'assigned' => $operatorId !== null
                ? (int) ($statusCounts['assigned'] ?? 0)
                : ($canViewAll
                    ? (int) ($statusCounts['assigned'] ?? 0)
                    : Chat::query()->where('attention_status', 'assigned')->where('operator_id', $user?->id)->count()),
            'pending_assignment' => $operatorId !== null ? 0 : (int) ($statusCounts['pending_assignment'] ?? 0),
            'archived' => $operatorId !== null || $canViewAll
                ? (int) ($statusCounts['archived'] ?? 0)
                : Chat::query()->where('attention_status', 'archived')->where('last_operator_id', $user?->id)->count(),
            'whatsapp' => (int) ($channelCounts?->whatsapp_total ?? 0),
            'webchat' => (int) ($channelCounts?->webchat_total ?? 0),
        ];
    }

    private function publishOperatorStatus(int $chatId, array $payload): void
    {
        $host = env('MQTT_HOST') ?: env('VITE_MOSQUITTO_HOST');
        if (! $host) {
            Log::warning('MQTT host not configured for operator status publish.');

            return;
        }

        try {
            $mqtt = new MqttClient((string) $host, 1883, 'laravel_operator_'.uniqid());
            $mqtt->connect();
            $mqtt->publish("operator/chat/{$chatId}", json_encode($payload), 0);
            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::error('MQTT Error (operator status): '.$e->getMessage());
        }
    }

    private function adminChatState(Chat $chat): array
    {
        return ['operator_id' => $chat->operator_id, 'bot_enabled' => (bool) $chat->bot_enabled, 'status' => $chat->status, 'attention_status' => $chat->attention_status, 'bot_flow_id' => $chat->bot_flow_id, 'bot_node_id' => $chat->bot_node_id];
    }

    private function adminChatPayload(Chat $chat): array
    {
        $chat->loadMissing(['operator', 'lastOperator', 'botFlow', 'botNode']);

        return ['chat_id' => (int) $chat->id, 'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null, 'operator_name' => $chat->operator?->name, 'last_operator_id' => $chat->last_operator_id ? (int) $chat->last_operator_id : null, 'last_operator_name' => $chat->lastOperator?->name, 'bot_enabled' => (bool) $chat->bot_enabled, 'status' => $chat->status, 'attention_status' => $chat->attention_status, 'assigned_at' => $chat->assigned_at?->toIso8601String(), 'closed_at' => $chat->closed_at?->toIso8601String(), 'closed_by' => $chat->closed_by, 'bot_flow_id' => $chat->bot_flow_id ? (int) $chat->bot_flow_id : null, 'bot_flow_name' => $chat->botFlow?->name, 'bot_node_id' => $chat->bot_node_id ? (int) $chat->bot_node_id : null, 'bot_node_name' => $chat->botNode?->key, 'bot_step' => $chat->bot_step, 'bot_state' => $chat->bot_state];
    }

    private function publishChatLifecycle(Chat $chat): void
    {
        $payload = $this->adminChatPayload($chat);
        $payload['active'] = false;
        $this->publishOperatorStatus((int) $chat->id, $payload);
        $this->publishBotStatus((int) $chat->id, (bool) $chat->bot_enabled);
    }

    private function publishBotStatus(int $chatId, bool $enabled): void
    {
        $host = env('MQTT_HOST') ?: env('VITE_MOSQUITTO_HOST');
        if (! $host) {
            Log::warning('MQTT host not configured for bot status publish.');

            return;
        }

        try {
            $mqtt = new MqttClient((string) $host, 1883, 'laravel_status_bot_'.uniqid());
            $mqtt->connect();
            $mqtt->publish("status_bot/chat/{$chatId}", json_encode([
                'chat_id' => $chatId,
                'status' => $enabled ? 'enabled' : 'disabled',
            ]), 0);
            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::error('MQTT Error (bot status): '.$e->getMessage());
        }
    }
}
