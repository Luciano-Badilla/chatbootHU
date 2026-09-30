<?php

namespace App\Http\Controllers;

use App\Models\Chat;
use App\Models\Message;
use App\Services\AuditService;
use App\Services\BotInactivityService;
use App\Services\ChatAssignmentService;
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
    ) {}

    public function index()
    {
        $actor = request()->user();
        $canViewAll = (bool) $actor?->hasPermission('can_view_all_chats');

        $chats = Chat::query()
            ->with(['contact', 'messages' => fn ($query) => $query->latest(), 'operator', 'botFlow', 'botNode'])
            ->when(! $canViewAll, function ($query) use ($actor) {
                $query->where(function ($scope) use ($actor) {
                    $scope->where('operator_id', $actor->id)
                        ->orWhere(function ($archived) use ($actor) {
                            $archived->where('status', 'closed')->where('last_operator_id', $actor->id);
                        });
                });
            })
            // Administración y supervisión pueden auditar también conversaciones atendidas por bot.
            ->when(! $canViewAll, fn ($query) => $query->whereIn('attention_status', ['assigned', 'archived']))
            ->get()
            ->map(function (Chat $chat) {
                $lastMessage = $chat->messages->first();

                return [
                    'id' => (int) $chat->id,
                    'name' => $chat->contact?->name ?? $chat->contact?->whatsapp_id,
                    'number' => '+'.$chat->contact?->whatsapp_id,
                    'lastMessage' => $lastMessage?->body ?? '',
                    'timestamp' => $lastMessage?->created_at,
                    'unread' => $chat->messages()->where('status', 'received')->count(),
                    'online' => false,
                    'avatar' => $chat->contact?->profile_pic,
                    'bot_enabled' => (bool) $chat->bot_enabled,
                    'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null,
                    'operator_name' => $chat->operator?->name,
                    'bot_state' => $chat->bot_state ?? [],
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
            });

        return Inertia::render('MessagePanel', [
            'chats' => $chats,
        ]);
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

        if ($data['active']) {
            if (! $operatorId) {
                return response()->json([
                    'ok' => false,
                    'message' => 'No operator id available.',
                ], 422);
            }

            if ($chat->operator_id && (int) $chat->operator_id !== (int) $operatorId) {
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

        $this->chatAssignmentService->assignAllPending();

        $this->auditService->recordChatAction(
            $data['active'] ? 'operator_assigned' : 'operator_released',
            $data['active'] ? 'Tomo el chat' : 'Libero el chat',
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

        $flow = $this->botInactivityService->getDefaultFlow();
        if (! $flow || ! $flow->start_node_id) {
            return response()->json([
                'ok' => false,
                'message' => 'No hay un flujo activo para reiniciar el bot.',
            ], 422);
        }

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
        if ($chat->status === 'closed') {
            return response()->json(['ok' => false, 'message' => 'El chat ya esta archivado.'], 422);
        }

        $flow = $this->botInactivityService->getDefaultFlow();
        if (! $flow || ! $flow->start_node_id) {
            return response()->json(['ok' => false, 'message' => 'No hay un flujo activo para reactivar el bot.'], 422);
        }

        $chat->loadMissing('operator');
        $before = $this->adminChatState($chat);
        $previousOperatorId = $chat->operator_id;
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
            'before' => $before, 'after' => $this->adminChatState($chat), 'meta' => ['reason' => 'Intervención administrativa: archivó el chat y reactivó el bot.'],
        ]);
        $this->publishChatLifecycle($chat);

        return response()->json(['ok' => true, 'chat' => $this->adminChatPayload($chat)]);
    }

    public function reopenByAdmin(Request $request, Chat $chat)
    {
        if ($chat->status !== 'closed') {
            return response()->json(['ok' => false, 'message' => 'Solo se pueden reabrir chats archivados.'], 422);
        }

        $flow = $this->botInactivityService->getDefaultFlow();
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
            'before' => $before, 'after' => $this->adminChatState($chat), 'meta' => ['reason' => 'Intervención administrativa: reabrió el chat con el bot activo.'],
        ]);
        $this->publishChatLifecycle($chat);

        return response()->json(['ok' => true, 'chat' => $this->adminChatPayload($chat)]);
    }

    public function getMessages(Request $request, $chatId)
    {
        $limit = max(10, min((int) $request->query('limit', 50), 100));
        $beforeId = $request->integer('before_id');

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

    public function snapshot()
    {
        $rows = Chat::with('operator:id,name')
            ->get(['id', 'operator_id', 'bot_enabled', 'status', 'attention_status'])
            ->map(function (Chat $chat) {
                return [
                    'chat_id' => (int) $chat->id,
                    'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null,
                    'operator_name' => $chat->operator?->name,
                    'bot_enabled' => (bool) $chat->bot_enabled,
                    'status' => $chat->status,
                    'attention_status' => $chat->attention_status,
                ];
            })
            ->values();

        return response()->json([
            'ok' => true,
            'data' => $rows,
        ]);
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
        $chat->loadMissing(['botFlow', 'botNode']);

        return ['chat_id' => (int) $chat->id, 'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null, 'operator_name' => null, 'bot_enabled' => (bool) $chat->bot_enabled, 'status' => $chat->status, 'attention_status' => $chat->attention_status, 'assigned_at' => $chat->assigned_at?->toIso8601String(), 'closed_at' => $chat->closed_at?->toIso8601String(), 'closed_by' => $chat->closed_by, 'bot_flow_id' => $chat->bot_flow_id ? (int) $chat->bot_flow_id : null, 'bot_flow_name' => $chat->botFlow?->name, 'bot_node_id' => $chat->bot_node_id ? (int) $chat->bot_node_id : null, 'bot_node_name' => $chat->botNode?->key, 'bot_step' => $chat->bot_step, 'bot_state' => $chat->bot_state];
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
