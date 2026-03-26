<?php

namespace App\Http\Controllers;

use App\Models\Chat;
use App\Models\Contact;
use App\Models\Message;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use PhpMqtt\Client\MqttClient;

class ChatController extends Controller
{
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

    public function markAsReadMessages($chatId)
    {
        Message::where('chat_id', $chatId)->where('status', 'received')->update(['status' => 'read']);
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

        if ($data['active']) {
            if (!$operatorId) {
                return response()->json([
                    'ok' => false,
                    'message' => 'No operator id available.',
                ], 422);
            }

            if ($chat->operator_id && (int) $chat->operator_id !== (int) $operatorId) {
                $chat->load('operator');
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
