<?php

namespace App\Http\Controllers;

use App\Models\Chat;
use App\Models\Contact;
use App\Models\Message;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use PhpMqtt\Client\MqttClient;

class ChatController extends Controller
{
    public function __construct(private readonly AuditService $auditService)
    {
    }

    public function index()
    {
        $chats = Contact::with([
            'chats.messages' => function ($q) {
                $q->latest();
            },
            'chats.operator',
        ])
            ->get()
            ->map(function ($contact) {
                $chat = $contact->chats->last();
                $lastMessage = $chat?->messages->first();

                return [
                    'id' => (int) ($chat?->id ?? 0),
                    'name' => $contact->name ?? $contact->whatsapp_id,
                    'number' => '+' . $contact->whatsapp_id,
                    'lastMessage' => $lastMessage?->body ?? '',
                    'timestamp' => $lastMessage?->created_at,
                    'unread' => $chat
                        ? $chat->messages()
                            ->where('status', 'received')
                            ->where('status', '!=', 'read')
                            ->count()
                        : 0,
                    'online' => false,
                    'avatar' => $contact->profile_pic,
                    'bot_enabled' => (bool) ($chat?->bot_enabled ?? true),
                    'operator_id' => $chat?->operator_id ? (int) $chat->operator_id : null,
                    'operator_name' => $chat?->operator?->name,
                    'bot_state' => $chat?->bot_state ?? [],
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
            if (!$operatorId) {
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
        } else {
            $chat->operator_id = null;
            $operatorId = null;
            $operatorName = null;
        }

        $chat->save();
        $chat->load('operator');

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

    public function getMessages($chatId)
    {
        $messages = Message::where('chat_id', $chatId)->get();
        return $messages;
    }

    public function snapshot()
    {
        $rows = Chat::with('operator:id,name')
            ->get(['id', 'operator_id', 'bot_enabled'])
            ->map(function (Chat $chat) {
                return [
                    'chat_id' => (int) $chat->id,
                    'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null,
                    'operator_name' => $chat->operator?->name,
                    'bot_enabled' => (bool) $chat->bot_enabled,
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
        if (!$host) {
            Log::warning('MQTT host not configured for operator status publish.');
            return;
        }

        try {
            $mqtt = new MqttClient((string) $host, 1883, 'laravel_operator_' . uniqid());
            $mqtt->connect();
            $mqtt->publish("operator/chat/{$chatId}", json_encode($payload), 0);
            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::error('MQTT Error (operator status): ' . $e->getMessage());
        }
    }
}
