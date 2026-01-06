<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
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


class WhatsAppController extends Controller
{
    public function verify(Request $request)
    {
        $verifyToken = env('WHATSAPP_VERIFY_TOKEN');

        $mode      = $request->query('hub_mode');
        $token     = $request->query('hub_verify_token');
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

        $value       = $data['entry'][0]['changes'][0]['value'];
        $messageData = $value['messages'][0];
        $from        = $messageData['from'] ?? null;
        $type        = $messageData['type'] ?? 'text';
        $whatsappMessageId = $messageData['id'] ?? null;

        // --------------------------------
        // 2) Variables base
        // --------------------------------
        $body        = null;
        $messageType = 'text';   // para tu enum
        $mediaUrl    = null;     // URL de WhatsApp
        $mediaName   = null;     // id / filename
        $mime        = null;     // mime_type si existe

        $interactiveReplyId = null;

        // --------------------------------
        // 2.bis) Mensajes interactivos (botones / listas)
        // --------------------------------
        if ($type === 'interactive') {
            $interactive = $messageData['interactive'] ?? [];
            $replyType   = $interactive['type'] ?? null;

            if ($replyType === 'button_reply') {
                $interactiveReplyId = $interactive['button_reply']['id'] ?? null;
                $body               = $interactive['button_reply']['title'] ?? null; // opcional
            } elseif ($replyType === 'list_reply') {
                $interactiveReplyId = $interactive['list_reply']['id'] ?? null;
                $body               = $interactive['list_reply']['title'] ?? null;   // opcional
            }

            // Lo tratamos lógicamente como texto
            $messageType = 'text';
            $type        = 'text'; // 👈 así el switch entra en case 'text'
        }

        // --------------------------------
        // 3) Normalizar info según tipo
        // --------------------------------
        switch ($type) {
            case 'text':
                // Si todavía no se seteó (por interactive), tomamos el text normal
                if ($body === null) {
                    $body = $messageData['text']['body'] ?? null;
                }
                $messageType = 'text';
                break;

            case 'image':
                $body        = $messageData['image']['caption'] ?? null;
                $messageType = 'image';
                $mediaUrl    = $messageData['image']['url'] ?? null;
                $mediaName   = $messageData['image']['id'] ?? null;
                $mime        = $messageData['image']['mime_type'] ?? null;
                break;

            case 'video':
                $body        = $messageData['video']['caption'] ?? null;
                $messageType = 'video';
                $mediaUrl    = $messageData['video']['url'] ?? null;
                $mediaName   = $messageData['video']['id'] ?? null;
                $mime        = $messageData['video']['mime_type'] ?? null;
                break;

            case 'audio':
                $messageType = 'audio';
                $body        = '[Audio]';
                $mediaUrl    = $messageData['audio']['url'] ?? null;
                $mediaName   = $messageData['audio']['id'] ?? null;
                $mime        = $messageData['audio']['mime_type'] ?? null;
                break;

            case 'document':
                $messageType = 'document';
                $body        = $messageData['document']['caption']
                    ?? ($messageData['document']['filename'] ?? '[Documento]');
                $mediaUrl    = $messageData['document']['url'] ?? null;
                $mediaName   = $messageData['document']['filename']
                    ?? ($messageData['document']['id'] ?? null);
                $mime        = $messageData['document']['mime_type'] ?? null;
                break;

            case 'sticker':
                // Tu ENUM no tiene 'sticker', lo tratamos como image
                $messageType = 'image';
                $body        = '[Sticker]';
                $mediaUrl    = $messageData['sticker']['url'] ?? null;
                $mediaName   = $messageData['sticker']['id'] ?? null;
                $mime        = $messageData['sticker']['mime_type'] ?? null;
                break;

            default:
                $messageType = 'text';
                $body        = $body ?? ('[Mensaje tipo ' . $type . ']');
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
                    'whatsapp_id'         => $contactData['wa_id'],
                    'name'                => $contactData['profile']['name'] ?? null,
                    'profile_pic'         => $contactData['profile']['picture'] ?? null,
                    'last_interaction_at' => now(),
                ]);
            } else {
                $contact->name                = $contactData['profile']['name'] ?? $contact->name;
                $contact->profile_pic         = $contactData['profile']['picture'] ?? $contact->profile_pic;
                $contact->last_interaction_at = now();
                $contact->save();
            }
        } else {
            // Fallback si no viene "contacts"
            $contact = Contact::firstOrCreate(
                ['whatsapp_id' => $from],
                [
                    'name'                => null,
                    'profile_pic'         => null,
                    'last_interaction_at' => now(),
                ]
            );
        }

        $contact->last_interaction_at = now();
        $contact->save();

        // --------------------------------
        // 5) Crear / obtener chat
        // --------------------------------
        $chat = Chat::firstOrCreate(
            ['contact_id' => $contact->id, 'status' => 'open'],
            ['title' => null]
        );

        // --------------------------------
        // 6) Descargar media (si hay) y generar URL pública
        // --------------------------------
        $publicMediaUrl = null;  // lo que va a la DB y al front

        if ($mediaUrl) {
            try {
                $accessToken  = env('WHATSAPP_ACCESS_TOKEN');
                $fileResponse = Http::withToken($accessToken)->get($mediaUrl);

                if ($fileResponse->successful()) {
                    // extensión a partir del mime_type
                    $ext = null;
                    if ($mime && str_contains($mime, '/')) {
                        $parts = explode('/', $mime);
                        $ext   = $parts[1] ?? null;     // jpeg, mp4, ogg, webp, etc.
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
                'image'    => '[Imagen]',
                'video'    => '[Video]',
                'audio'    => '[Audio]',
                'document' => '[Documento]',
                default    => '[Mensaje]',
            };

            $previewText = $body ? "$prefix $body" : $prefix;
        }

        // --------------------------------
        // 8) Guardar mensaje en DB
        // --------------------------------
        $message = Message::firstOrCreate(
            ['whatsapp_message_id' => $whatsappMessageId],
            [
                'chat_id'      => $chat->id,
                'sender'       => 'contact',
                'message_type' => $messageType,
                'body'         => $body,
                'status'       => 'received',
                'media_url'    => $publicMediaUrl,
                'media_name'   => $mediaName,
            ]
        );

        // --------------------------------
        // 9) MQTT (mensaje entrante)
        // --------------------------------
        try {
            $mqtt = new MqttClient('127.0.0.1', 1883, 'laravel_recv_' . uniqid());
            $mqtt->connect();

            // Sidebar
            $mqtt->publish('sidebar/chat', json_encode([
                'chat_id'     => $chat->id,
                'name'        => $contact->name ?? 'Desconocido',
                'lastMessage' => $previewText,
                'timestamp'   => now()->utc()->toIso8601String(),
            ]), 0);

            // ChatMain
            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id'      => $chat->id,
                'message_id'   => $message->id,
                'sender'       => $message->sender,
                'body'         => $message->body,
                'message_type' => $message->message_type,
                'media_url'    => $message->media_url,
                'media_name'   => $message->media_name,
                'status'       => $message->status,
                'timestamp'    => $message->created_at?->toIso8601String(),
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
            'ok'       => true,
            'message'  => [
                'id'        => $message->id,
                'chat_id'   => $message->chat_id,
                'sender'    => $message->sender,
                'body'      => $message->body,
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
            $areaCode    = substr($number, 3, 3);
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
        $url         = 'https://graph.facebook.com/v22.0/' . env('WHATSAPP_PHONE_ID') . '/messages';

        $phoneNumber = $this->formatPhoneNumber($contact->whatsapp_id);

        $data = [
            'messaging_product' => 'whatsapp',
            'to'   => $phoneNumber,
            'text' => ['body' => $messageBody],
        ];

        $response = Http::withToken($accessToken)->post($url, $data);

        if ($response->failed()) {
            Log::error('API Error (sendWhatsAppText): ' . $response->body());
            throw new \RuntimeException('Error enviando mensaje a WhatsApp');
        }

        $message = Message::create([
            'chat_id'             => $chat->id,
            'sender'              => $sender, // 'user' desde tu sistema (incluye bot)
            'message_type'        => 'text',
            'body'                => $messageBody,
            'status'              => 'sent',
            'whatsapp_message_id' => $response->json()['messages'][0]['id'] ?? null,
        ]);

        // MQTT
        try {
            $mqtt = new MqttClient('127.0.0.1', 1883, 'laravel_send_' . uniqid());
            $mqtt->connect();

            // Sidebar
            $mqtt->publish('sidebar/chat', json_encode([
                'chat_id'     => $chat->id,
                'name'        => $contact->name ?? 'Desconocido',
                'lastMessage' => $messageBody,
                'timestamp'   => $message->created_at->toIso8601String(),
            ]), 0);

            // ChatMain
            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id'      => $chat->id,
                'message_id'   => $message->id,
                'sender'       => $message->sender,
                'body'         => $message->body,
                'message_type' => $message->message_type,
                'media_url'    => null,
                'media_name'   => null,
                'timestamp'    => $message->created_at->toIso8601String(),
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
            'chat_id'             => $chat->id,
            'sender'              => 'user',
            'message_type'        => 'text',   // tu enum actual
            'body'                => $body,
            'status'              => 'sent',
            'whatsapp_message_id' => $waMessageId,
        ]);

        // MQTT
        try {
            $mqtt = new MqttClient('127.0.0.1', 1883, 'laravel_send_' . uniqid());
            $mqtt->connect();

            $mqtt->publish('sidebar/chat', json_encode([
                'chat_id'     => $chat->id,
                'name'        => $contact->name ?? 'Desconocido',
                'lastMessage' => $body,
                'timestamp'   => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id'      => $chat->id,
                'message_id'   => $message->id,
                'sender'       => $message->sender,
                'body'         => $message->body,
                'message_type' => $message->message_type,
                'media_url'    => null,
                'media_name'   => null,
                'status'       => $message->status,
                'timestamp'    => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->disconnect();
        } catch (MqttClientException $e) {
            Log::error('MQTT Error (persistAndPublishOutgoing): ' . $e->getMessage());
        }
    }


    private function ensureChatHasFlow(Chat $chat): void
    {
        if ($chat->bot_flow_id && $chat->bot_node_id) {
            return;
        }

        // Por ahora: tomamos el primer flujo activo como “principal”
        $flow = BotFlow::where('is_active', true)->first();

        if (!$flow) {
            return; // no hay flujo configurado
        }

        $chat->bot_flow_id = $flow->id;
        $chat->bot_node_id = $flow->start_node_id;
        $chat->bot_enabled = true;
        $chat->bot_state   = $chat->bot_state ?? [];
        $chat->save();
    }

    private function handleBotFromDb(Chat $chat, Message $incoming, ?string $interactiveReplyId = null): ?BotNode
    {
        if (!$chat->bot_enabled) {
            return null;
        }

        $this->ensureChatHasFlow($chat);

        if (!$chat->bot_flow_id || !$chat->bot_node_id) {
            return null;
        }

        /** @var BotNode|null $currentNode */
        $currentNode = BotNode::find($chat->bot_node_id);
        if (!$currentNode) {
            return null;
        }

        $text  = trim($incoming->body ?? '');
        $state = $chat->bot_state ?? [];

        switch ($currentNode->type) {
            // 1) Nodos con botones / listas: se avanza por id del botón/lista
            case 'buttons':
            case 'list':
                if (!$interactiveReplyId) {
                    return $currentNode;
                }

                $settings = $currentNode->settings ?? [];
                $options  = $settings['buttons'] ?? $settings['rows'] ?? [];

                $nextNodeId = null;
                $nextKey    = null;

                foreach ($options as $opt) {
                    if (($opt['id'] ?? null) === $interactiveReplyId) {
                        $nextNodeId = $opt['next_node_id'] ?? null; // ✅ NUEVO
                        $nextKey    = $opt['next_key'] ?? null;     // fallback viejo
                        break;
                    }
                }

                if ($nextNodeId) {
                    $nextNode = BotNode::where('flow_id', $currentNode->flow_id)
                        ->where('id', $nextNodeId)
                        ->first();
                } elseif ($nextKey) {
                    $nextNode = BotNode::where('flow_id', $currentNode->flow_id)
                        ->where('key', $nextKey)
                        ->first();
                } else {
                    return $currentNode;
                }

                if (!$nextNode) {
                    return null;
                }

                if ($nextNode->type === 'handoff') {
                    $chat->bot_enabled = false;
                    $chat->bot_node_id = $nextNode->id;
                    $chat->save();
                    return $nextNode;
                }

                $chat->bot_node_id = $nextNode->id;
                $chat->save();

                return $nextNode;


                // 2) Nodos de input (captura de variable, ej: DNI)
            case 'input':
                $settings = $currentNode->settings ?? [];
                $variable = $settings['variable']         ?? null;
                $regex    = $settings['validation_regex'] ?? null;
                $errorMsg = $settings['error_message']    ?? 'Valor inválido, intentá de nuevo.';

                if ($regex && !preg_match('/' . $regex . '/u', $text)) {
                    // no avanzamos, devolvemos el mismo nodo pero cambiando el body al mensaje de error
                    $currentNode->body = $errorMsg;
                    return $currentNode;
                }

                if ($variable) {
                    $state[$variable] = $text;
                    $chat->bot_state  = $state;
                }

                $nextNodeId = $settings['next_node_id'] ?? null; // ✅ NUEVO
                $nextKey    = $settings['next_key'] ?? null;     // fallback viejo

                if ($nextNodeId) {
                    $nextNode = BotNode::where('flow_id', $currentNode->flow_id)
                        ->where('id', $nextNodeId)
                        ->first();
                } elseif ($nextKey) {
                    $nextNode = BotNode::where('flow_id', $currentNode->flow_id)
                        ->where('key', $nextKey)
                        ->first();
                } else {
                    $chat->bot_state = $state;
                    $chat->save();
                    return null;
                }

                if (!$nextNode) {
                    $chat->bot_state = $state;
                    $chat->save();
                    return null;
                }

                $chat->bot_node_id = $nextNode->id;
                $chat->bot_state   = $state;
                $chat->save();

                // placeholders {variable}
                if ($variable && isset($state[$variable])) {
                    $value = $state[$variable];
                    $nextNode->body = str_replace('{' . $variable . '}', $value, $nextNode->body ?? '');
                }

                return $nextNode;


                if (!$nextNode) {
                    $chat->bot_state = $state;
                    $chat->save();
                    return null;
                }

                $chat->bot_node_id = $nextNode->id;
                $chat->bot_state   = $state;
                $chat->save();

                // caso especial: usamos la variable en el texto (ej: {dni})
                if ($variable && isset($state[$variable])) {
                    $value = $state[$variable];
                    $nextNode->body = str_replace('{' . $variable . '}', $value, $nextNode->body ?? '');
                }

                return $nextNode;

                // 3) Nodos de texto plano
            case 'text':
                // comando "menú" de emergencia
                if (strtolower($text) === 'menú' || strtolower($text) === 'menu') {
                    $menuNode = BotNode::where('flow_id', $currentNode->flow_id)
                        ->where('key', 'menu_principal')
                        ->first();

                    if ($menuNode) {
                        $chat->bot_node_id = $menuNode->id;
                        $chat->save();
                        return $menuNode;
                    }
                }

                // 🚀 NUEVA LÓGICA:
                // Enviamos SIEMPRE el nodo de texto actual
                // y, si tiene next_node_id, solo movemos el puntero.
                if ($currentNode->next_node_id) {
                    $chat->bot_node_id = $currentNode->next_node_id;
                    $chat->save();
                }

                return $currentNode;

            case 'handoff':
                // en handoff ya desactivamos el bot; no respondemos más
                return null;

            default:
                return null;
        }
    }



    private function sendBotNode(Chat $chat, BotNode $node): void
    {
        // handoff no envía nada extra (ya mandamos su body como texto si queremos)
        if ($node->type === 'handoff') {
            // mensaje de texto simple al usuario
            if ($node->body) {
                $this->sendWhatsAppText($chat, $node->body, 'user');
            }
            return;
        }

        if ($node->type === 'text' || $node->type === 'input') {
            // input también es solo texto (la pregunta)
            if ($node->body) {
                $this->sendWhatsAppText($chat, $node->body, 'user');
            }
            return;
        }

        if ($node->type === 'buttons') {
            $this->sendWhatsAppButtons($chat, $node);
            return;
        }

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
        $buttons  = $settings['buttons'] ?? [];

        if (empty($buttons)) {
            // si no hay botones configurados, mandamos texto simple
            $this->sendWhatsAppText($chat, $node->body ?? '', 'user');
            return;
        }

        $accessToken = env('WHATSAPP_ACCESS_TOKEN');
        $url         = 'https://graph.facebook.com/v22.0/' . env('WHATSAPP_PHONE_ID') . '/messages';

        $phoneNumber = $this->formatPhoneNumber($contact->whatsapp_id);

        $waButtons = [];
        foreach ($buttons as $btn) {
            $waButtons[] = [
                'type'  => 'reply',
                'reply' => [
                    'id'    => $btn['id'],
                    'title' => $btn['title'],
                ],
            ];
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'to'   => $phoneNumber,
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

        $buttonText   = $settings['button_text']   ?? 'Ver opciones';
        $sectionTitle = $settings['section_title'] ?? 'Opciones';
        $rows         = $settings['rows']          ?? [];

        if (empty($rows)) {
            $this->sendWhatsAppText($chat, $node->body ?? '', 'user');
            return;
        }

        $accessToken = env('WHATSAPP_ACCESS_TOKEN');
        $url         = 'https://graph.facebook.com/v22.0/' . env('WHATSAPP_PHONE_ID') . '/messages';

        $phoneNumber = $this->formatPhoneNumber($contact->whatsapp_id);

        $waRows = [];
        foreach ($rows as $row) {
            $waRows[] = [
                'id'          => $row['id'],
                'title'       => $row['title'],
                'description' => $row['description'] ?? null,
            ];
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'to'   => $phoneNumber,
            'type' => 'interactive',
            'interactive' => [
                'type' => 'list',
                'body' => [
                    'text' => $node->body ?? '',
                ],
                'action' => [
                    'button'   => $buttonText,
                    'sections' => [
                        [
                            'title' => $sectionTitle,
                            'rows'  => $waRows,
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
            'ok'   => true,
            'chat' => $chat,
        ]);
    }
}
