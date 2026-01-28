<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Env;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use App\Models\Contact;
use App\Models\Chat;
use App\Models\Message;
use PhpMqtt\Client\MqttClient;
use PhpMqtt\Client\Exceptions\MqttClientException;
use App\Models\BotFlow;
use App\Models\BotNode;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;



class WhatsAppController extends Controller
{
    public function verify(Request $request)
    {
        $verifyToken = env('WHATSAPP_VERIFY_TOKEN');

        $mode = $request->query('hub_mode');
        $token = $request->query('hub_verify_token');
        $challenge = $request->query('hub_challenge');

        if ($mode && $token) {
            if ($mode === 'subscribe' && $token === $verifyToken) {
                return response($challenge, 200);
            } else {
                return response('Forbidden', 403);
            }
        }

        return response('Bad Request', 400);
    }

    /**
     * Webhook de recepción de mensajes desde WhatsApp.
     */
    public function receiveMessage(Request $request)
    {
        $data = $request->all();

        Log::info('Recibido mensaje de WhatsApp: ' . json_encode($data));

        // 1) Verificamos si hay un mensaje
        if (!isset($data['entry'][0]['changes'][0]['value']['messages'][0])) {
            return response('EVENT_RECEIVED', 200);
        }

        $value = $data['entry'][0]['changes'][0]['value'];
        $messageData = $value['messages'][0];
        $from = $messageData['from'] ?? null;
        $type = $messageData['type'] ?? 'text';
        $whatsappMessageId = $messageData['id'] ?? null;

        // --------------------------------
        // 2) Variables base
        // --------------------------------
        $body = null;
        $messageType = 'text';
        $mediaUrl = null;
        $mediaName = null;
        $mime = null;

        $interactiveReplyId = null;

        // --------------------------------
        // 2.bis) Mensajes interactivos (botones / listas)
        // --------------------------------
        if ($type === 'interactive') {
            $interactive = $messageData['interactive'] ?? [];
            $replyType = $interactive['type'] ?? null;

            if ($replyType === 'button_reply') {
                $interactiveReplyId = $interactive['button_reply']['id'] ?? null;
                $body = $interactive['button_reply']['title'] ?? null; // opcional
            } elseif ($replyType === 'list_reply') {
                $interactiveReplyId = $interactive['list_reply']['id'] ?? null;
                $body = $interactive['list_reply']['title'] ?? null;   // opcional
            }

            $messageType = 'text';
            $type = 'text';
        }

        // --------------------------------
        // 3) Normalizar info según tipo
        // --------------------------------
        switch ($type) {
            case 'text':
                if ($body === null) {
                    $body = $messageData['text']['body'] ?? null;
                }
                $messageType = 'text';
                break;

            case 'image':
                $body = $messageData['image']['caption'] ?? null;
                $messageType = 'image';
                $mediaUrl = $messageData['image']['url'] ?? null;
                $mediaName = $messageData['image']['id'] ?? null;
                $mime = $messageData['image']['mime_type'] ?? null;
                break;

            case 'video':
                $body = $messageData['video']['caption'] ?? null;
                $messageType = 'video';
                $mediaUrl = $messageData['video']['url'] ?? null;
                $mediaName = $messageData['video']['id'] ?? null;
                $mime = $messageData['video']['mime_type'] ?? null;
                break;

            case 'audio':
                $messageType = 'audio';
                $body = '[Audio]';
                $mediaUrl = $messageData['audio']['url'] ?? null;
                $mediaName = $messageData['audio']['id'] ?? null;
                $mime = $messageData['audio']['mime_type'] ?? null;
                break;

            case 'document':
                $messageType = 'document';
                $body = $messageData['document']['caption']
                    ?? ($messageData['document']['filename'] ?? '[Documento]');
                $mediaUrl = $messageData['document']['url'] ?? null;
                $mediaName = $messageData['document']['filename']
                    ?? ($messageData['document']['id'] ?? null);
                $mime = $messageData['document']['mime_type'] ?? null;
                break;

            case 'sticker':
                $messageType = 'image';
                $body = '[Sticker]';
                $mediaUrl = $messageData['sticker']['url'] ?? null;
                $mediaName = $messageData['sticker']['id'] ?? null;
                $mime = $messageData['sticker']['mime_type'] ?? null;
                break;

            default:
                $messageType = 'text';
                $body = $body ?? ('[Mensaje tipo ' . $type . ']');
                break;
        }

        // --------------------------------
        // 4) Guardar / actualizar contacto
        // --------------------------------
        $contactData = $value['contacts'][0] ?? null;

        if ($contactData) {
            $contact = Contact::where('whatsapp_id', $contactData['wa_id'])->first();

            if (!$contact) {
                $contact = Contact::create([
                    'whatsapp_id' => $contactData['wa_id'],
                    'name' => $contactData['profile']['name'] ?? null,
                    'profile_pic' => $contactData['profile']['picture'] ?? null,
                    'last_interaction_at' => now(),
                ]);
            } else {
                $contact->name = $contactData['profile']['name'] ?? $contact->name;
                $contact->profile_pic = $contactData['profile']['picture'] ?? $contact->profile_pic;
                $contact->last_interaction_at = now();
                $contact->save();
            }
        } else {
            $contact = Contact::firstOrCreate(
                ['whatsapp_id' => $from],
                [
                    'name' => null,
                    'profile_pic' => null,
                    'last_interaction_at' => now(),
                ]
            );
        }

        $contact->last_interaction_at = now();
        $contact->save();

        // --------------------------------
        // 5) Crear / obtener chat
        // --------------------------------

        $flow = $this->getDefaultFlow() ?? null;

        // Ideal: lock para evitar doble webhook avanzando el puntero 2 veces
        $chat = Chat::where('contact_id', $contact->id)->lockForUpdate()->first();

        if (!$chat) {
            $chat = Chat::create([
                'contact_id' => $contact->id,
                'bot_flow_id' => $flow->id ?? null,
                'bot_node_id' => $flow->start_node_id ?? null,
                'status' => 'open',
                'bot_enabled' => true,
                'bot_state' => [],
                'last_user_message_at' => now(), // primer contacto
            ]);
        } else {
            // 1) Asegurar que use flow default y que tenga nodo
            $flow = $this->ensureChatUsesDefaultFlow($chat) ?? $flow;

            // 2) Reset por timeout 24hs (ANTES de procesar el bot)
            if ($this->shouldResetByTimeout($chat, 24)) {

                // si estaba en handoff, con este reset también se reactiva (bot_enabled=true)
                $reason = $chat->bot_enabled ? 'timeout_24h' : 'handoff_timeout_24h';

                $this->resetChatToStartFromFlow($chat, $flow, $reason);
            }


            // 3) Actualizar última interacción del usuario (entrante)
            $chat->last_user_message_at = now();

            // Si por algún motivo quedó sin nodo, iniciamos
            if (!$chat->bot_node_id) {
                $chat->bot_node_id = $flow->start_node_id ?? null;
            }

            $chat->save();
        }


        // --------------------------------
        // 6) Descargar media (si hay) y generar URL pública
        // --------------------------------
        $publicMediaUrl = null;  // lo que va a la DB y al front

        if ($mediaUrl) {
            try {
                $accessToken = env('WHATSAPP_ACCESS_TOKEN');
                $fileResponse = Http::withToken($accessToken)->get($mediaUrl);

                if ($fileResponse->successful()) {
                    // extensión a partir del mime_type
                    $ext = null;
                    if ($mime && str_contains($mime, '/')) {
                        $parts = explode('/', $mime);
                        $ext = $parts[1] ?? null;     // jpeg, mp4, ogg, webp, etc.
                    }

                    // Si es audio y no vino mime, ponemos ogg como default
                    if (!$ext && $messageType === 'audio') {
                        $ext = 'ogg';
                    }

                    // Base del nombre
                    $baseName = $mediaName ?? uniqid();

                    // Evitar duplicar extensión si el nombre ya la trae (documentos)
                    if ($ext && !str_contains($baseName, '.')) {
                        $fileName = ($messageType ?: 'file') . '_' . $baseName . '.' . $ext;
                    } else {
                        $fileName = ($messageType ?: 'file') . '_' . $baseName;
                    }

                    $path = 'whatsapp/' . $chat->id . '/' . $fileName;

                    Storage::disk('public')->put($path, $fileResponse->body());

                    // URL pública relativa (requiere php artisan storage:link)
                    $publicMediaUrl = '/storage/' . $path;
                } else {
                    Log::warning('No se pudo descargar el media: ' . $fileResponse->status());
                }
            } catch (\Throwable $e) {
                Log::error('Error descargando media: ' . $e->getMessage());
            }
        }

        // --------------------------------
        // 7) Texto de preview para la sidebar
        // --------------------------------
        $previewText = $body;

        if ($messageType !== 'text') {
            $prefix = match ($messageType) {
                'image' => '[Imagen]',
                'video' => '[Video]',
                'audio' => '[Audio]',
                'document' => '[Documento]',
                default => '[Mensaje]',
            };

            $previewText = $body ? "$prefix $body" : $prefix;
        }

        // --------------------------------
        // 8) Guardar mensaje en DB
        // --------------------------------
        $message = Message::firstOrCreate(
            ['whatsapp_message_id' => $whatsappMessageId],
            [
                'chat_id' => $chat->id,
                'sender' => 'contact',
                'message_type' => $messageType,
                'body' => $body,
                'status' => 'received',
                'media_url' => $publicMediaUrl,
                'media_name' => $mediaName,
            ]
        );

        // --------------------------------
        // 9) MQTT (mensaje entrante)
        // --------------------------------
        try {
            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_recv_' . uniqid());
            $mqtt->connect();

            // Sidebar
            $mqtt->publish('sidebar/chat', json_encode([
                'chat_id' => $chat->id,
                'name' => $contact->name ?? 'Desconocido',
                'lastMessage' => $previewText,
                'timestamp' => now()->utc()->toIso8601String(),
            ]), 0);

            // ChatMain
            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id' => $chat->id,
                'message_id' => $message->id,
                'sender' => $message->sender,
                'body' => $message->body,
                'message_type' => $message->message_type,
                'media_url' => $message->media_url,
                'media_name' => $message->media_name,
                'status' => $message->status,
                'timestamp' => $message->created_at?->toIso8601String(),
            ]), 0);

            $mqtt->disconnect();
        } catch (MqttClientException $e) {
            Log::error('MQTT Error (receiveMessage): ' . $e->getMessage());
        }

        // --------------------------------
        // 10) Bot por DB (flows / nodes)
        // --------------------------------
        try {
            $nextNode = $this->handleBotFromDb($chat, $message, $interactiveReplyId);

            if ($nextNode) {
                $this->sendBotNode($chat, $nextNode);

                // Reset si el nodo enviado fue terminal
                $flowForRuntime = $this->getDefaultFlow();
                if ($flowForRuntime) {
                    $didReset = $this->maybeResetAfterSendingNode($chat, $flowForRuntime, $nextNode);

                    $this->runAutoAdvance($chat, $flowForRuntime, $nextNode);

                    /* if ($didReset && $this->shouldAutoAdvance($nextNode) && $flowForRuntime->start_node_id) {
                        $start = BotNode::find($flowForRuntime->start_node_id);
                        if ($start) {
                            $this->sendBotNode($chat, $start);
                            // opcional: si el start también tiene auto_advance, lo corrés
                            $this->runAutoAdvance($chat, $flowForRuntime, $start);
                        }
                    }*/
                }
            }
        } catch (\Throwable $e) {
            Log::error('Error en bot DB: ' . $e->getMessage());
        }

        return response('EVENT_RECEIVED', 200);
    }


    /**
     * Enviar mensaje a WhatsApp desde el operador (front).
     */
    public function sendMessage(Request $request)
    {
        $validated = $request->validate([
            'chat_id' => 'required|integer|exists:chats,id',
            'message' => 'required|string',
        ]);

        $messageBody = $validated['message'];

        $chat = Chat::with('contact')->findOrFail($validated['chat_id']);

        try {
            $message = $this->sendWhatsAppText($chat, $messageBody, 'user');
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }

        return response()->json([
            'ok' => true,
            'message' => [
                'id' => $message->id,
                'chat_id' => $message->chat_id,
                'sender' => $message->sender,
                'body' => $message->body,
                'timestamp' => $message->created_at->toIso8601String(),
            ],
        ], 200);
    }

    /**
     * Formatear número de teléfono a formato internacional.
     */
    private function formatPhoneNumber($number)
    {
        if (strpos($number, '549') === 0) {
            $areaCode = substr($number, 3, 3);
            $localNumber = substr($number, 6);
            return "54{$areaCode}{$localNumber}";
        }

        return $number;
    }

    /**
     * Lógica del bot (mini "árbol" de estados) dentro del controlador.
     */


    /**
     * Enviar texto por WhatsApp, guardar mensaje y publicar por MQTT.
     * $sender = 'user' (desde tu sistema) o 'contact' si algún día hicieras eco, etc.
     */
    private function sendWhatsAppText(Chat $chat, string $messageBody, string $sender = 'user'): Message
    {
        $contact = $chat->contact;

        if (!$contact || !$contact->whatsapp_id) {
            throw new \RuntimeException('Contacto sin whatsapp_id');
        }

        $accessToken = env('WHATSAPP_ACCESS_TOKEN');
        $url = 'https://graph.facebook.com/v22.0/' . env('WHATSAPP_PHONE_ID') . '/messages';
        Log::info($url);

        $phoneNumber = $this->formatPhoneNumber($contact->whatsapp_id);

        $data = [
            'messaging_product' => 'whatsapp',
            'to' => $phoneNumber,
            'text' => ['body' => $messageBody],
        ];

        $response = Http::withToken($accessToken)->post($url, $data);

        if ($response->failed()) {
            Log::error('API Error (sendWhatsAppText): ' . $response->body());
            throw new \RuntimeException('Error enviando mensaje a WhatsApp');
        }

        $message = Message::create([
            'chat_id' => $chat->id,
            'sender' => $sender, // 'user' desde tu sistema (incluye bot)
            'message_type' => 'text',
            'body' => $messageBody,
            'status' => 'sent',
            'whatsapp_message_id' => $response->json()['messages'][0]['id'] ?? null,
        ]);

        // MQTT
        try {
            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_send_' . uniqid());
            $mqtt->connect();

            // Sidebar
            $mqtt->publish('sidebar/chat', json_encode([
                'chat_id' => $chat->id,
                'name' => $contact->name ?? 'Desconocido',
                'lastMessage' => $messageBody,
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            // ChatMain
            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id' => $chat->id,
                'message_id' => $message->id,
                'sender' => $message->sender,
                'body' => $message->body,
                'message_type' => $message->message_type,
                'media_url' => null,
                'media_name' => null,
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->disconnect();
        } catch (MqttClientException $e) {
            Log::error('MQTT Error (sendWhatsAppText): ' . $e->getMessage());
        }

        return $message;
    }

    private function persistAndPublishOutgoing(Chat $chat, string $body, ?string $waMessageId = null): void
    {
        $contact = $chat->contact;

        $message = Message::create([
            'chat_id' => $chat->id,
            'sender' => 'user',
            'message_type' => 'text',   // tu enum actual
            'body' => $body,
            'status' => 'sent',
            'whatsapp_message_id' => $waMessageId,
        ]);

        // MQTT
        try {
            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_send_' . uniqid());
            $mqtt->connect();

            $mqtt->publish('sidebar/chat', json_encode([
                'chat_id' => $chat->id,
                'name' => $contact->name ?? 'Desconocido',
                'lastMessage' => $body,
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id' => $chat->id,
                'message_id' => $message->id,
                'sender' => $message->sender,
                'body' => $message->body,
                'message_type' => $message->message_type,
                'media_url' => null,
                'media_name' => null,
                'status' => $message->status,
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->disconnect();
        } catch (MqttClientException $e) {
            Log::error('MQTT Error (persistAndPublishOutgoing): ' . $e->getMessage());
        }
    }


    private function ensureChatUsesDefaultFlow(Chat $chat): ?BotFlow
    {
        $flow = $this->getDefaultFlow();

        if (!$flow || !$flow->start_node_id) {
            return null;
        }

        // Si el chat está en otro flow, lo sincronizamos al default
        if ((int) $chat->bot_flow_id !== (int) $flow->id) {
            $chat->bot_flow_id = $flow->id;
            $chat->bot_node_id = $flow->start_node_id; // resetea el puntero al inicio
            $chat->bot_state = [];                    // opcional: reset state
            $chat->bot_enabled = true;
            $chat->save();

            return $flow;
        }

        // Si ya está en el default, pero no tiene nodo, lo inicializamos
        if (!$chat->bot_node_id) {
            $chat->bot_node_id = $flow->start_node_id;
            $chat->bot_enabled = true;
            $chat->bot_state = $chat->bot_state ?? [];
            $chat->save();
        }

        return $flow;
    }



    private function handleBotFromDb(Chat $chat, Message $incoming, ?string $interactiveReplyId = null): ?BotNode
    {
        $pending = $this->getPendingInput($chat);

        if ($pending) {
            $value = trim((string) ($incoming->body ?? ''));

            if ($value === '') {
                $state = $this->getState($chat);
                $state['pending_input']['last_error'] = $pending['error_message'] ?? 'Valor inválido, intentá de nuevo.';
                $this->setState($chat, $state);

                return BotNode::find($pending['node_id']);
            }


            $regex = trim((string) ($pending['validation_regex'] ?? ''));

            if ($regex !== '') {
                $pattern = $regex;
                $hasDelimiters = str_starts_with($pattern, '/') && strrpos($pattern, '/') !== 0;

                if (!$hasDelimiters) {
                    $pattern = '/' . str_replace('/', '\/', $pattern) . '/';
                }

                if (@preg_match($pattern, '') !== false && !preg_match($pattern, $value)) {
                    $state = $this->getState($chat);
                    $state['pending_input']['last_error'] = $pending['error_message'] ?? 'Valor inválido, intentá de nuevo.';
                    $this->setState($chat, $state);

                    return BotNode::find($pending['node_id']);
                }
            }

            // ✅ guardar variable
            $varName = trim((string) ($pending['variable'] ?? ''));
            if ($varName !== '') {
                $this->setVar($chat, $varName, $value); // este ya guarda en DB
            }

            $nextId = $pending['next_node_id'] ?? null;

            // ✅ SIEMPRE limpiamos pending_input
            $this->clearPendingInput($chat);

            // ✅ CASO: finalizar flujo
            if (!$nextId) {
                $flow = $this->getDefaultFlow();
                if ($flow) {
                    $this->resetChatToStartFromFlow($chat, $flow, 'input_terminal');
                }
                return null;
            }

            $chat->bot_node_id = $nextId;
            $chat->save();

            $nextNode = BotNode::find($nextId);
            if ($nextNode && $nextNode->type === 'handoff') {
                return $nextNode;
            }

            return $nextNode;
        }

        // ✅ 1) Si el bot está apagado, no respondemos
        if (!$chat->bot_enabled) {
            return null;
        }

        $flow = $this->ensureChatUsesDefaultFlow($chat);

        if (!$flow || !$chat->bot_node_id) {
            return null;
        }

        /** @var BotNode|null $currentNode */
        $currentNode = BotNode::find($chat->bot_node_id);
        if (!$currentNode) {
            return null;
        }

        $text = trim((string) ($incoming->body ?? ''));

        switch ($currentNode->type) {

            case 'buttons':
            case 'list':
                if (!$interactiveReplyId) return $currentNode;

                $settings = $currentNode->settings ?? [];
                $options = $settings['buttons'] ?? $settings['rows'] ?? [];

                $nextNodeId = null;
                foreach ($options as $opt) {
                    if (($opt['id'] ?? null) === $interactiveReplyId) {
                        $nextNodeId = $opt['next_node_id'] ?? null;
                        break;
                    }
                }

                if (!$nextNodeId) return $currentNode;

                $nextNode = BotNode::where('flow_id', $currentNode->flow_id)
                    ->where('id', $nextNodeId)
                    ->first();

                if (!$nextNode) return null;

                $chat->bot_node_id = $nextNode->id;
                $chat->save();

                return $nextNode;


            case 'input':
                // devolvemos el mismo nodo (para que el bot lo envíe)
                // y sendBotNode va a setear pending_input
                return $currentNode;

                // 3) Texto plano
            case 'text':
                if (in_array(mb_strtolower($text), ['menú', 'menu'], true)) {
                    $menuNode = BotNode::where('flow_id', $currentNode->flow_id)
                        ->where('key', 'menu_principal')
                        ->first();

                    if ($menuNode) {
                        $chat->bot_node_id = $menuNode->id;
                        $chat->save();
                        return $menuNode;
                    }
                }

                // mover puntero al próximo (sea handoff o lo que sea)
                if ($currentNode->next_node_id) {
                    $chat->bot_node_id = $currentNode->next_node_id;
                    $chat->save();
                }

                return $currentNode;

            case 'handoff':
                return $currentNode;


            default:
                return null;
        }
    }

    private function sendBotNode(Chat $chat, BotNode $node): void
    {
        // handoff
        if ($node->type === 'handoff') {

            // enviar mensaje del handoff (si tiene)
            if ($node->body) {
                $this->sendWhatsAppText($chat, $node->body, 'user');
            }

            // apagar bot
            $chat->bot_enabled = false;

            // por seguridad (por si venía de un input)
            $this->clearPendingInput($chat);

            // ✅ preparar puntero para cuando se reactive
            $flow = $this->ensureChatUsesDefaultFlow($chat) ?? $this->getDefaultFlow();
            if ($flow && $flow->start_node_id) {
                $chat->bot_node_id = $flow->start_node_id;
            }

            // ✅ marcar que está/estuvo en handoff (para UI)
            $state = $this->getState($chat);
            $state['handoff'] = [
                'node_id' => $node->id,
                'at' => now()->toIso8601String(),
            ];
            $this->setState($chat, $state);

            $chat->save();
            return;
        }


        if ($node->type === 'input') {

            // 1) Si ya había pending_input, lo leemos para ver si hay error
            $pending = $this->getPendingInput($chat);
            $errorToSend = is_array($pending) ? ($pending['last_error'] ?? null) : null;

            // 2) Mandamos primero el error si existe, sino el body normal
            if ($errorToSend) {
                $this->sendWhatsAppText($chat, $errorToSend, 'user');

                // limpiamos last_error para que no se repita infinitamente
                $state = $this->getState($chat);
                if (isset($state['pending_input'])) {
                    unset($state['pending_input']['last_error']);
                    $this->setState($chat, $state);
                }
            } else {
                if ($node->body) {
                    $this->sendWhatsAppText($chat, $node->body, 'user');
                }
            }

            // 3) Asegurar que pending_input exista (si no existía)
            $this->setPendingInput($chat, $node);

            $chat->bot_node_id = $node->id;
            $chat->save();

            return;
        }


        // text
        if ($node->type === 'text') {
            if ($node->body) {
                $this->sendWhatsAppText($chat, $node->body, 'user');
            }
            return;
        }

        // buttons
        if ($node->type === 'buttons') {
            $this->sendWhatsAppButtons($chat, $node);
            return;
        }

        // list
        if ($node->type === 'list') {
            $this->sendWhatsAppList($chat, $node);
            return;
        }
    }


    private function sendWhatsAppButtons(Chat $chat, BotNode $node): void
    {
        $contact = $chat->contact;
        if (!$contact || !$contact->whatsapp_id) {
            return;
        }

        $settings = $node->settings ?? [];
        $buttons = $settings['buttons'] ?? [];

        if (empty($buttons)) {
            // si no hay botones configurados, mandamos texto simple
            $this->sendWhatsAppText($chat, $node->body ?? '', 'user');
            return;
        }

        $accessToken = env('WHATSAPP_ACCESS_TOKEN');
        $url = 'https://graph.facebook.com/v22.0/' . env('WHATSAPP_PHONE_ID') . '/messages';

        $phoneNumber = $this->formatPhoneNumber($contact->whatsapp_id);

        $waButtons = [];
        foreach ($buttons as $btn) {
            $waButtons[] = [
                'type' => 'reply',
                'reply' => [
                    'id' => $btn['id'],
                    'title' => $btn['title'],
                ],
            ];
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'to' => $phoneNumber,
            'type' => 'interactive',
            'interactive' => [
                'type' => 'button',
                'body' => [
                    'text' => $node->body ?? '',
                ],
                'action' => [
                    'buttons' => $waButtons,
                ],
            ],
        ];

        $response = Http::withToken($accessToken)->post($url, $payload);

        if ($response->failed()) {
            Log::error('API Error (sendWhatsAppButtons): ' . $response->body());
            return;
        }

        $waMessageId = $response->json()['messages'][0]['id'] ?? null;
        $this->persistAndPublishOutgoing($chat, $node->body ?? '', $waMessageId);
    }

    private function sendWhatsAppList(Chat $chat, BotNode $node): void
    {
        $contact = $chat->contact;
        if (!$contact || !$contact->whatsapp_id) {
            return;
        }

        $settings = $node->settings ?? [];

        $buttonText = $settings['button_text'] ?? 'Ver opciones';
        $sectionTitle = $settings['section_title'] ?? 'Opciones';
        $rows = $settings['rows'] ?? [];

        if (empty($rows)) {
            $this->sendWhatsAppText($chat, $node->body ?? '', 'user');
            return;
        }

        $accessToken = env('WHATSAPP_ACCESS_TOKEN');
        $url = 'https://graph.facebook.com/v22.0/' . env('WHATSAPP_PHONE_ID') . '/messages';

        $phoneNumber = $this->formatPhoneNumber($contact->whatsapp_id);

        $waRows = [];
        foreach ($rows as $row) {
            $waRows[] = [
                'id' => $row['id'],
                'title' => $row['title'],
                'description' => $row['description'] ?? null,
            ];
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'to' => $phoneNumber,
            'type' => 'interactive',
            'interactive' => [
                'type' => 'list',
                'body' => [
                    'text' => $node->body ?? '',
                ],
                'action' => [
                    'button' => $buttonText,
                    'sections' => [
                        [
                            'title' => $sectionTitle,
                            'rows' => $waRows,
                        ],
                    ],
                ],
            ],
        ];

        $response = Http::withToken($accessToken)->post($url, $payload);

        if ($response->failed()) {
            Log::error('API Error (sendWhatsAppList): ' . $response->body());
            return;
        }

        $waMessageId = $response->json()['messages'][0]['id'] ?? null;
        $this->persistAndPublishOutgoing($chat, $node->body ?? '', $waMessageId);
    }

    public function updateBotStatus(Request $request, Chat $chat)
    {
        $data = $request->validate([
            'bot_enabled' => 'required|boolean',
        ]);

        $chat->bot_enabled = $data['bot_enabled'];
        $chat->save();

        return response()->json([
            'ok' => true,
            'chat' => $chat,
        ]);
    }

    private function getDefaultFlow(): ?BotFlow
    {
        return BotFlow::where('is_default', true)
            ->where('is_active', true)
            ->first()
            ?? BotFlow::where('is_active', true)->orderBy('id')->first();
    }

    private function resetChatToStart(Chat $chat): void
    {
        $flow = $this->getDefaultFlow();
        if (!$flow || !$flow->start_node_id) {
            return;
        }

        $chat->bot_node_id = $flow->start_node_id;

        // opcional: limpiar estado para arrancar "de cero"
        $chat->bot_state = [];

        $chat->bot_enabled = true;
        $chat->save();
    }

    private function shouldResetByTimeout(Chat $chat, int $hours = 24): bool
    {
        if (!$chat->last_user_message_at)
            return false;

        return Carbon::parse($chat->last_user_message_at)->diffInHours(now()) >= $hours;
    }

    private function resetChatToStartFromFlow(Chat $chat, BotFlow $flow, string $reason = null): void
    {
        if (!$flow->start_node_id) return;

        // ✅ preservar variables ya capturadas
        $state = $this->getState($chat);
        $vars  = is_array($state['vars'] ?? null) ? $state['vars'] : [];

        $chat->bot_flow_id = $flow->id;
        $chat->bot_node_id = $flow->start_node_id;

        // ✅ limpiamos solo lo que rompe el próximo ciclo
        $chat->bot_state = [
            'vars' => $vars,
            // pending_input se elimina al reset
        ];
        $chat->bot_step = null;
        $chat->bot_enabled = true;

        $chat->save();

        Log::info("Chat {$chat->id} reset to start_node_id={$flow->start_node_id}. reason={$reason}");
    }


    private function maybeResetAfterSendingNode(Chat $chat, BotFlow $flow, BotNode $sentNode): bool
    {
        if (!$chat->bot_enabled) return false;

        // ✅ SOLO text puede ser terminal automático
        if ($sentNode->type === 'text' && empty($sentNode->next_node_id)) {
            $this->resetChatToStartFromFlow($chat, $flow, 'terminal_text');
            return true;
        }

        return false;
    }

    private function nodeSettings(BotNode $node): array
    {
        // settings puede venir como array o como Collection, lo normalizamos
        $s = $node->settings ?? [];
        return is_array($s) ? $s : (array) $s;
    }

    private function shouldAutoAdvance(BotNode $node): bool
    {
        $s = $this->nodeSettings($node);
        return !empty($s['auto_advance']);
    }

    private function autoAdvanceDelayMs(BotNode $node): int
    {
        $s = $this->nodeSettings($node);
        $ms = (int) ($s['auto_advance_delay_ms'] ?? 0);
        return max(0, min($ms, 5000)); // clamp 0..5000 para no colgar workers
    }

    private function autoAdvanceMaxHops(BotNode $node): int
    {
        $s = $this->nodeSettings($node);
        $hops = (int) ($s['auto_advance_max_hops'] ?? 5);
        return max(1, min($hops, 15)); // clamp razonable
    }

    private function runAutoAdvance(Chat $chat, BotFlow $flow, BotNode $justSent): void
    {
        if (!$chat->bot_enabled)
            return;

        // Solo si el nodo recién enviado tiene next_node_id y auto_advance activo
        if (!$this->shouldAutoAdvance($justSent))
            return;
        if (!$justSent->next_node_id)
            return;

        $maxHops = $this->autoAdvanceMaxHops($justSent);
        $visited = [];
        $current = $justSent;

        for ($i = 0; $i < $maxHops; $i++) {

            $nextId = $current->next_node_id;
            if (!$nextId)
                break;

            // anti-loop por id
            if (isset($visited[$nextId])) {
                Log::warning("Auto-advance loop detectado en chat {$chat->id}, node {$nextId}");
                break;
            }
            $visited[$nextId] = true;

            /** @var BotNode|null $nextNode */
            $nextNode = BotNode::where('flow_id', $flow->id)->where('id', $nextId)->first();
            if (!$nextNode)
                break;

            // actualizamos puntero ANTES de enviar (por consistencia)
            $chat->bot_node_id = $nextNode->id;
            $chat->save();

            // delay opcional
            $delay = $this->autoAdvanceDelayMs($current);
            if ($delay > 0)
                usleep($delay * 1000);

            // enviamos el nodo
            $this->sendBotNode($chat, $nextNode);

            // ✅ si el nodo apagó el bot (handoff), cortar acá
            if (!$chat->bot_enabled) {
                break;
            }

            // si el nodo enviado fue terminal, se resetea y se corta
            $this->maybeResetAfterSendingNode($chat, $flow, $nextNode);
            if ((int) $chat->bot_node_id === (int) $flow->start_node_id && empty($nextNode->next_node_id)) {
                break;
            }

            // Si el siguiente nodo también tiene auto_advance, seguimos.
            // Si no, cortamos (la conversación queda esperando input).
            if (!$this->shouldAutoAdvance($nextNode)) {
                break;
            }

            $current = $nextNode;
        }
    }

    private function getState(Chat $chat): array
    {
        return is_array($chat->bot_state) ? $chat->bot_state : [];
    }

    private function setState(Chat $chat, array $state): void
    {
        $chat->bot_state = $state;
        $chat->save();
    }


    private function getVars(Chat $chat): array
    {
        $state = $this->getState($chat);
        return is_array($state['vars'] ?? null) ? $state['vars'] : [];
    }

    private function setVar(Chat $chat, string $key, $value): void
    {
        $state = $this->getState($chat);
        $state['vars'] = is_array($state['vars'] ?? null) ? $state['vars'] : [];
        $state['vars'][$key] = $value;

        $chat->bot_state = $state;
        $chat->save();

        try {
            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_vars_' . uniqid());
            $mqtt->connect();

            $mqtt->publish("chat/{$chat->id}/vars", json_encode([
                'chat_id' => $chat->id,
                'var' => [
                    'name' => $key,
                    'value' => $value,
                ],
                'vars' => $state['vars'],
                'timestamp' => now()->toIso8601String(),
            ]), 0);

            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::error('MQTT Error (setVar vars): ' . $e->getMessage());
        }
    }



    private function setPendingInput(Chat $chat, BotNode $node): void
    {
        $settings = is_array($node->settings) ? $node->settings : [];

        $state = $this->getState($chat);
        $state['pending_input'] = [
            'node_id' => $node->id,
            'variable' => (string)($settings['variable'] ?? ''),
            'validation_regex' => (string)($settings['validation_regex'] ?? ''),
            'error_message' => (string)($settings['error_message'] ?? 'Valor inválido, intentá de nuevo.'),
            'next_node_id' => $node->next_node_id, // clave: a dónde avanzar cuando capture OK
        ];
        $this->setState($chat, $state);
    }

    private function clearPendingInput(Chat $chat): void
    {
        $state = $this->getState($chat);
        unset($state['pending_input']);
        $this->setState($chat, $state);
    }

    private function getPendingInput(Chat $chat): ?array
    {
        $state = $this->getState($chat);
        $pending = $state['pending_input'] ?? null;
        return is_array($pending) ? $pending : null;
    }

    private function findNodeInFlow(int $flowId, int $nodeId): ?BotNode
    {
        return BotNode::where('flow_id', $flowId)->where('id', $nodeId)->first();
    }
}
