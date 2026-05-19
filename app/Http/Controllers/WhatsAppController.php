<?php

namespace App\Http\Controllers;

use App\Models\BotFlow;
use App\Models\BotNode;
use App\Models\Chat;
use App\Models\Contact;
use App\Models\Message;
use App\Models\SystemSetting;
use App\Services\AuditService;
use App\Services\BotInactivityService;
use Illuminate\Http\Request;
use Illuminate\Support\Env;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use PhpMqtt\Client\Exceptions\MqttClientException;
use PhpMqtt\Client\MqttClient;

class WhatsAppController extends Controller
{
    private ?array $runtimeSettingsCache = null;

    public function __construct(
        private readonly BotInactivityService $botInactivityService,
        private readonly AuditService $auditService,
    )
    {
    }

    public function verify(Request $request)
    {
        $verifyToken = $this->whatsappVerifyToken();

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
        $mediaId = null;
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
                $mediaId = $messageData['image']['id'] ?? null;
                $mediaUrl = $messageData['image']['url'] ?? null;
                $mediaName = $mediaId;
                $mime = $messageData['image']['mime_type'] ?? null;
                break;

            case 'video':
                $body = $messageData['video']['caption'] ?? null;
                $messageType = 'video';
                $mediaId = $messageData['video']['id'] ?? null;
                $mediaUrl = $messageData['video']['url'] ?? null;
                $mediaName = $mediaId;
                $mime = $messageData['video']['mime_type'] ?? null;
                break;

            case 'audio':
                $messageType = 'audio';
                $body = '[Audio]';
                $mediaId = $messageData['audio']['id'] ?? null;
                $mediaUrl = $messageData['audio']['url'] ?? null;
                $mediaName = $mediaId;
                $mime = $messageData['audio']['mime_type'] ?? null;
                break;

            case 'document':
                $messageType = 'document';
                $body = $messageData['document']['caption']
                    ?? ($messageData['document']['filename'] ?? '[Documento]');
                $mediaId = $messageData['document']['id'] ?? null;
                $mediaUrl = $messageData['document']['url'] ?? null;
                $mediaName = $messageData['document']['filename']
                    ?? $mediaId;
                $mime = $messageData['document']['mime_type'] ?? null;
                break;

            case 'sticker':
                $messageType = 'image';
                $body = '[Sticker]';
                $mediaId = $messageData['sticker']['id'] ?? null;
                $mediaUrl = $messageData['sticker']['url'] ?? null;
                $mediaName = $mediaId;
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

            // 2) Reset por timeout configurable (ANTES de procesar el bot)
            $this->botInactivityService->processExpiredChat($chat, $flow);


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

        if (!$mediaUrl && $mediaId) {
            $mediaUrl = $this->resolveWhatsAppMediaUrl($mediaId);
        }

        if ($mediaUrl) {
            try {
                $accessToken = $this->whatsappAccessToken();
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
                'sender_subtype' => 'contact',
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
                'sender_subtype' => $message->sender_subtype,
                'bot_node_type' => $message->bot_node_type,
                'interactive_options' => $message->interactive_options,
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
        $actor = $request->user();

        try {
            $message = $this->sendWhatsAppText($chat, $messageBody, 'user', 'operator');
        } catch (\Throwable $e) {
            $this->auditService->recordMessageAction(
                'message_send_failed',
                'Fallo al enviar mensaje manual',
                $chat,
                $actor,
                null,
                [
                    'meta' => [
                        'message_type' => 'text',
                        'body_preview' => mb_substr($messageBody, 0, 160),
                        'error' => $e->getMessage(),
                    ],
                ],
            );
            return response()->json(['error' => $e->getMessage()], 500);
        }

        $this->auditService->recordMessageAction(
            'message_sent',
            'Envio mensaje manual',
            $chat,
            $actor,
            $message,
            [
                'meta' => [
                    'message_type' => 'text',
                    'body_preview' => mb_substr((string) $message->body, 0, 160),
                    'message_id' => $message->id,
                ],
            ],
        );

        return response()->json([
            'ok' => true,
            'message' => [
                'id' => $message->id,
                'chat_id' => $message->chat_id,
                'sender' => $message->sender,
                'sender_subtype' => $message->sender_subtype,
                'body' => $message->body,
                'timestamp' => $message->created_at->toIso8601String(),
            ],
        ], 200);
    }

    /**
     * Enviar media (imagen/video/audio/documento) a WhatsApp desde el operador.
     */
    public function sendMedia(Request $request)
    {
        $validated = $request->validate([
            'chat_id' => 'required|integer|exists:chats,id',
            'file' => 'required|file|max:51200',
            'caption' => 'nullable|string',
            'media_kind' => 'nullable|in:image,video,audio,document',
        ]);

        $chat = Chat::with('contact')->findOrFail($validated['chat_id']);
        $contact = $chat->contact;
        $actor = $request->user();

        if (!$contact || !$contact->whatsapp_id) {
            $this->auditService->recordMessageAction(
                'media_send_failed',
                'Fallo al enviar archivo al chat',
                $chat,
                $actor,
                null,
                [
                    'meta' => [
                        'error' => 'Contacto sin whatsapp_id',
                    ],
                ],
            );
            return response()->json(['error' => 'Contacto sin whatsapp_id'], 422);
        }

        $file = $request->file('file');
        $caption = trim((string) ($validated['caption'] ?? ''));
        $mime = (string) ($file->getMimeType() ?? '');
        $clientMime = (string) ($file->getClientMimeType() ?? '');
        $messageType = $validated['media_kind'] ?? $this->resolveOutgoingMediaType($mime);
        $uploadMime = $this->normalizeWhatsAppUploadMime($mime, $messageType);
        $originalName = (string) ($file->getClientOriginalName() ?? ('file_' . uniqid()));
        $sniff = $this->sniffAudioContainer($file->getRealPath());

        $accessToken = $this->whatsappAccessToken();
        $phoneId = $this->whatsappPhoneId();
        $phoneNumber = $this->formatPhoneNumber($contact->whatsapp_id);

        if ($messageType === 'audio') {
            $allowedAudioMimes = [
                'audio/ogg',
                'audio/ogg; codecs=opus',
                'audio/mpeg',
                'audio/mp4',
                'audio/aac',
                'audio/amr',
                'audio/opus',
            ];

            if (!in_array(strtolower($uploadMime), $allowedAudioMimes, true)) {
                return response()->json([
                    'error' => "Audio no soportado para WhatsApp: {$mime} (uploadMime={$uploadMime}). Subí OGG/OPUS o MP3/M4A.",
                ], 422);
            }

            if ($uploadMime === 'audio/mp4' && $sniff !== 'mp4') {
                return response()->json([
                    'error' => "El archivo NO parece MP4/M4A válido (firma={$sniff}).",
                ], 422);
            }
            if ($uploadMime === 'audio/mpeg' && $sniff !== 'mp3') {
                return response()->json([
                    'error' => "El archivo NO parece MP3 válido (firma={$sniff}).",
                ], 422);
            }
            if (str_starts_with($uploadMime, 'audio/ogg') && $sniff !== 'ogg') {
                return response()->json([
                    'error' => "El archivo NO parece OGG válido (firma={$sniff}).",
                ], 422);
            }
        }

        Log::info('sendMedia debug', [
            'chat_id' => $chat->id,
            'orig_name' => $originalName,
            'messageType' => $messageType,
            'getMimeType' => $mime,
            'clientMimeType' => $clientMime,
            'uploadMime' => $uploadMime,
            'size' => $file->getSize(),
            'sniff' => $sniff,
        ]);

        try {
            // 1) Subir media a WhatsApp para obtener media_id
            $mediaUploadUrl = "https://graph.facebook.com/v22.0/{$phoneId}/media";
            $uploadResponse = Http::withToken($accessToken)
                ->attach(
                    'file',
                    fopen($file->getRealPath(), 'r'),
                    $originalName,
                    ['Content-Type' => $uploadMime]
                )
                ->post($mediaUploadUrl, [
                    'messaging_product' => 'whatsapp',
                ]);

            if ($uploadResponse->failed()) {
                Log::error('API Error (sendMedia upload): ' . $uploadResponse->body());
                $this->auditService->recordMessageAction(
                    'media_send_failed',
                    'Fallo al enviar archivo al chat',
                    $chat,
                    $actor,
                    null,
                    [
                        'meta' => [
                            'message_type' => $messageType,
                            'file_name' => $originalName,
                            'error' => 'Error subiendo media a WhatsApp',
                        ],
                    ],
                );
                return response()->json(['error' => 'Error subiendo media a WhatsApp'], 500);
            }

            $mediaId = $uploadResponse->json('id');
            if (!$mediaId) {
                $this->auditService->recordMessageAction(
                    'media_send_failed',
                    'Fallo al enviar archivo al chat',
                    $chat,
                    $actor,
                    null,
                    [
                        'meta' => [
                            'message_type' => $messageType,
                            'file_name' => $originalName,
                            'error' => 'No se obtuvo media_id de WhatsApp',
                        ],
                    ],
                );
                return response()->json(['error' => 'No se obtuvo media_id de WhatsApp'], 500);
            }

            // 2) Enviar mensaje con ese media_id
            $sendUrl = "https://graph.facebook.com/v22.0/{$phoneId}/messages";
            $payload = [
                'messaging_product' => 'whatsapp',
                'to' => $phoneNumber,
                'type' => $messageType,
            ];

            if ($messageType === 'image') {
                $payload['image'] = ['id' => $mediaId];
                if ($caption !== '') {
                    $payload['image']['caption'] = $caption;
                }
            } elseif ($messageType === 'video') {
                $payload['video'] = ['id' => $mediaId];
                if ($caption !== '') {
                    $payload['video']['caption'] = $caption;
                }
            } elseif ($messageType === 'audio') {
                $payload['audio'] = ['id' => $mediaId];
            } else {
                $payload['document'] = [
                    'id' => $mediaId,
                    'filename' => $originalName,
                ];
                if ($caption !== '') {
                    $payload['document']['caption'] = $caption;
                }
            }

            $sendResponse = Http::withToken($accessToken)->post($sendUrl, $payload);
            if ($sendResponse->failed()) {
                Log::error('API Error (sendMedia message): ' . $sendResponse->body());
                $this->auditService->recordMessageAction(
                    'media_send_failed',
                    'Fallo al enviar archivo al chat',
                    $chat,
                    $actor,
                    null,
                    [
                        'meta' => [
                            'message_type' => $messageType,
                            'file_name' => $originalName,
                            'error' => 'Error enviando media a WhatsApp',
                        ],
                    ],
                );
                return response()->json(['error' => 'Error enviando media a WhatsApp'], 500);
            }

            // 3) Guardar copia local para previsualización en front
            $storedName = uniqid($messageType . '_') . '_' . preg_replace('/[^A-Za-z0-9._-]/', '_', $originalName);
            $localPath = "whatsapp/{$chat->id}/{$storedName}";
            Storage::disk('public')->put($localPath, file_get_contents($file->getRealPath()));
            $publicMediaUrl = '/storage/' . $localPath;

            // 4) Persistir mensaje
            $body = $caption !== '' ? $caption : null;
            $message = Message::create([
                'chat_id' => $chat->id,
                'sender' => 'user',
                'sender_subtype' => 'operator',
                'bot_node_type' => null,
                'interactive_options' => null,
                'message_type' => $messageType,
                'body' => $body,
                'status' => 'sent',
                'media_url' => $publicMediaUrl,
                'media_name' => $originalName,
                'whatsapp_message_id' => $sendResponse->json('messages.0.id'),
            ]);

            $this->auditService->recordMessageAction(
                'media_sent',
                'Envio archivo manual',
                $chat,
                $actor,
                $message,
                [
                    'meta' => [
                        'message_type' => $messageType,
                        'file_name' => $originalName,
                        'file_size' => $file->getSize(),
                        'caption_preview' => $caption !== '' ? mb_substr($caption, 0, 160) : null,
                        'message_id' => $message->id,
                    ],
                ],
            );

            // 5) MQTT (sidebar + chat)
            $previewText = match ($messageType) {
                'image' => '[Imagen]',
                'video' => '[Video]',
                'audio' => '[Audio]',
                default => '[Documento]',
            };
            if ($caption !== '') {
                $previewText .= " {$caption}";
            }

            try {
                $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_send_media_' . uniqid());
                $mqtt->connect();

                $mqtt->publish('sidebar/chat', json_encode([
                    'chat_id' => $chat->id,
                    'name' => $contact->name ?? 'Desconocido',
                    'lastMessage' => $previewText,
                    'timestamp' => $message->created_at->toIso8601String(),
                ]), 0);

                $mqtt->publish("chat/{$chat->id}", json_encode([
                    'chat_id' => $chat->id,
                    'message_id' => $message->id,
                    'sender' => $message->sender,
                    'sender_subtype' => $message->sender_subtype,
                    'bot_node_type' => $message->bot_node_type,
                    'interactive_options' => $message->interactive_options,
                    'body' => $message->body,
                    'message_type' => $message->message_type,
                    'media_url' => $message->media_url,
                    'media_name' => $message->media_name,
                    'status' => $message->status,
                    'timestamp' => $message->created_at->toIso8601String(),
                ]), 0);

                $mqtt->disconnect();
            } catch (\Throwable $e) {
                Log::error('MQTT Error (sendMedia): ' . $e->getMessage());
            }

            return response()->json([
                'ok' => true,
                'message' => [
                    'id' => $message->id,
                    'chat_id' => $message->chat_id,
                    'sender' => $message->sender,
                    'sender_subtype' => $message->sender_subtype,
                    'message_type' => $message->message_type,
                    'body' => $message->body,
                    'media_url' => $message->media_url,
                    'media_name' => $message->media_name,
                    'timestamp' => $message->created_at->toIso8601String(),
                ],
            ], 200);
        } catch (\Throwable $e) {
            Log::error('Error sendMedia: ' . $e->getMessage());
            $this->auditService->recordMessageAction(
                'media_send_failed',
                'Fallo al enviar archivo al chat',
                $chat,
                $actor,
                null,
                [
                    'meta' => [
                        'message_type' => $messageType,
                        'file_name' => $originalName,
                        'error' => $e->getMessage(),
                    ],
                ],
            );
            return response()->json(['error' => 'Error interno al enviar media'], 500);
        }
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

    private function resolveOutgoingMediaType(string $mime): string
    {
        if (str_starts_with($mime, 'image/')) {
            return 'image';
        }
        if (str_starts_with($mime, 'video/')) {
            return 'video';
        }
        if (str_starts_with($mime, 'audio/')) {
            return 'audio';
        }
        return 'document';
    }

    private function normalizeWhatsAppUploadMime(string $mime, ?string $messageType = null): string
    {
        $normalized = strtolower(trim($mime));

        return match ($normalized) {
            'audio/x-m4a', 'audio/m4a' => 'audio/mp4',
            'audio/mp4a-latm' => 'audio/mp4',
            'audio/x-wav' => 'audio/mpeg', // fallback compatible para algunos navegadores/OS
            default => $normalized !== '' ? $normalized : 'application/octet-stream',
        };
    }

    private function sniffAudioContainer(string $path): ?string
    {
        $fh = @fopen($path, 'rb');
        if (!$fh) {
            return null;
        }
        $head = fread($fh, 16);
        fclose($fh);

        if (!$head) {
            return null;
        }

        if (str_starts_with($head, 'OggS')) {
            return 'ogg';
        }

        if (str_starts_with($head, 'ID3')) {
            return 'mp3';
        }

        if (isset($head[0], $head[1])) {
            $b0 = ord($head[0]);
            $b1 = ord($head[1]);
            if ($b0 === 0xFF && ($b1 & 0xE0) === 0xE0) {
                return 'mp3';
            }
        }

        if (strlen($head) >= 8 && substr($head, 4, 4) === 'ftyp') {
            return 'mp4';
        }

        return null;
    }

    /**
     * Lógica del bot (mini "árbol" de estados) dentro del controlador.
     */


    /**
     * Enviar texto por WhatsApp, guardar mensaje y publicar por MQTT.
     * $sender = 'user' (desde tu sistema) o 'contact' si algún día hicieras eco, etc.
     */
    private function sendWhatsAppText(
        Chat $chat,
        string $messageBody,
        string $sender = 'user',
        string $senderSubtype = 'bot',
        ?string $botNodeType = null,
        ?array $interactiveOptions = null
    ): Message {
        $contact = $chat->contact;

        if (!$contact || !$contact->whatsapp_id) {
            throw new \RuntimeException('Contacto sin whatsapp_id');
        }

        $accessToken = $this->whatsappAccessToken();
        $url = 'https://graph.facebook.com/v22.0/' . $this->whatsappPhoneId() . '/messages';
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
            'sender_subtype' => $sender === 'contact' ? 'contact' : $senderSubtype,
            'bot_node_type' => $botNodeType,
            'interactive_options' => $interactiveOptions,
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
                'sender_subtype' => $message->sender_subtype,
                'bot_node_type' => $message->bot_node_type,
                'interactive_options' => $message->interactive_options,
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

    private function persistAndPublishOutgoing(
        Chat $chat,
        string $body,
        ?string $waMessageId = null,
        ?string $botNodeType = null,
        ?array $interactiveOptions = null
    ): void {
        $contact = $chat->contact;

        $message = Message::create([
            'chat_id' => $chat->id,
            'sender' => 'user',
            'sender_subtype' => 'bot',
            'bot_node_type' => $botNodeType,
            'interactive_options' => $interactiveOptions,
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
                'sender_subtype' => $message->sender_subtype,
                'bot_node_type' => $message->bot_node_type,
                'interactive_options' => $message->interactive_options,
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

    private function persistAndPublishOutgoingMedia(
        Chat $chat,
        string $messageType,
        string $body,
        ?string $mediaUrl,
        ?string $mediaName,
        ?string $waMessageId = null,
        ?string $botNodeType = null
    ): void {
        $contact = $chat->contact;

        $message = Message::create([
            'chat_id' => $chat->id,
            'sender' => 'user',
            'sender_subtype' => 'bot',
            'bot_node_type' => $botNodeType,
            'interactive_options' => null,
            'message_type' => $messageType,
            'body' => $body,
            'status' => 'sent',
            'media_url' => $mediaUrl,
            'media_name' => $mediaName,
            'whatsapp_message_id' => $waMessageId,
        ]);

        try {
            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_send_media_bot_' . uniqid());
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
                'sender_subtype' => $message->sender_subtype,
                'bot_node_type' => $message->bot_node_type,
                'interactive_options' => $message->interactive_options,
                'body' => $message->body,
                'message_type' => $message->message_type,
                'media_url' => $message->media_url,
                'media_name' => $message->media_name,
                'status' => $message->status,
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->disconnect();
        } catch (MqttClientException $e) {
            Log::error('MQTT Error (persistAndPublishOutgoingMedia): ' . $e->getMessage());
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
            $responseMode = (string) ($pending['response_mode'] ?? 'text');

            if (in_array($responseMode, ['buttons', 'list'], true)) {
                $option = $this->resolvePendingInputOption($pending, $interactiveReplyId, $value);

                if (!$option) {
                    $state = $this->getState($chat);
                    $state['pending_input']['last_error'] = $pending['error_message'] ?? 'Elegí una opción válida.';
                    $this->setState($chat, $state);

                    return BotNode::find($pending['node_id']);
                }

                $value = $option['label'];
                $pending['selected_next_node_id'] = $option['next_node_id'] ?? null;
            }

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

            $nextId = $pending['selected_next_node_id'] ?? ($pending['next_node_id'] ?? null);

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
                if (!$interactiveReplyId)
                    return $currentNode;

                $settings = $currentNode->settings ?? [];
                $options = $settings['buttons'] ?? $settings['rows'] ?? [];

                $nextNodeId = null;
                foreach ($options as $opt) {
                    if (($opt['id'] ?? null) === $interactiveReplyId) {
                        $nextNodeId = $opt['next_node_id'] ?? null;
                        break;
                    }
                }

                if (!$nextNodeId)
                    return $currentNode;

                $nextNode = BotNode::where('flow_id', $currentNode->flow_id)
                    ->where('id', $nextNodeId)
                    ->first();

                if (!$nextNode)
                    return null;

                $chat->bot_node_id = $nextNode->id;
                $chat->save();

                return $nextNode;


            case 'input':
            case 'person_lookup':
                // devolvemos el mismo nodo (para que el bot lo envíe)
                // y sendBotNode va a setear pending_input
                return $currentNode;

                // 3) Texto plano
            case 'image':
            case 'document':
            case 'video':
            case 'audio':
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
                $body = $this->renderTemplate($node->body, $chat, $node);
                $this->sendWhatsAppText($chat, $body, 'user', 'bot', 'handoff');
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

            try {
                $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_status_bot_' . uniqid());
                $mqtt->connect();

                $mqtt->publish("status_bot/chat/{$chat->id}", json_encode([
                    'chat_id' => $chat->id,
                    'status' => $chat->bot_enabled ? 'enabled' : 'disabled',
                ]), 0);

                $mqtt->disconnect();
            } catch (\Throwable $e) {
                Log::error('MQTT Error (handoff status_bot): ' . $e->getMessage());
            }

            return;
        }

        // input
        if ($node->type === 'input') {

            // 1) Si ya había pending_input, lo leemos para ver si hay error
            $pending = $this->getPendingInput($chat);
            $errorToSend = is_array($pending) ? ($pending['last_error'] ?? null) : null;
            $responseMode = (string) (($node->settings ?? [])['response_mode'] ?? 'text');

            // 2) Mandamos primero el error si existe, sino el body normal (renderizado)
            if ($errorToSend) {
                $err = $this->renderTemplate($errorToSend, $chat, $node);
                $this->sendWhatsAppText($chat, $err, 'user', 'bot', 'input');

                // limpiamos last_error para que no se repita infinitamente
                $state = $this->getState($chat);
                if (isset($state['pending_input'])) {
                    unset($state['pending_input']['last_error']);
                    $this->setState($chat, $state);
                }
            } elseif ($node->body) {
                if ($responseMode === 'buttons') {
                    $this->sendWhatsAppButtons($chat, $node, 'input');
                } elseif ($responseMode === 'list') {
                    $this->sendWhatsAppList($chat, $node, 'input');
                } else {
                    $body = $this->renderTemplate($node->body, $chat, $node);
                    $this->sendWhatsAppText($chat, $body, 'user', 'bot', 'input');
                }
            }

            if ($errorToSend && in_array($responseMode, ['buttons', 'list'], true) && $node->body) {
                if ($responseMode === 'buttons') {
                    $this->sendWhatsAppButtons($chat, $node, 'input');
                } else {
                    $this->sendWhatsAppList($chat, $node, 'input');
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
                $body = $this->renderTemplate($node->body, $chat, $node);
                $this->sendWhatsAppText($chat, $body, 'user', 'bot', 'text');
            }
            return;
        }

        if (in_array($node->type, ['image', 'document', 'video', 'audio'], true)) {
            $this->sendBotMediaNode($chat, $node);
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

        // person lookup
        if ($node->type === 'person_lookup') {
            $this->sendPersonLookupNode($chat, $node);
            return;
        }
    }

    private function sendBotMediaNode(Chat $chat, BotNode $node): void
    {
        $contact = $chat->contact;
        if (!$contact || !$contact->whatsapp_id) {
            return;
        }

        $mediaType = (string) $node->type;
        if (!in_array($mediaType, ['image', 'document', 'video', 'audio'], true)) {
            return;
        }

        $settings = $this->nodeSettings($node);
        $sourceKind = ($settings['source_kind'] ?? 'url') === 'id' ? 'id' : 'url';
        $source = trim($this->renderTemplate((string) ($settings['source'] ?? ''), $chat, $node));
        if ($source === '') {
            Log::warning('sendBotMediaNode: media source vacío', [
                'chat_id' => $chat->id,
                'node_id' => $node->id,
                'type' => $mediaType,
            ]);
            return;
        }

        $caption = $mediaType === 'audio'
            ? ''
            : trim($this->renderTemplate($node->body ?? '', $chat, $node));
        $filename = trim($this->renderTemplate((string) ($settings['filename'] ?? ''), $chat, $node));

        $accessToken = $this->whatsappAccessToken();
        $url = 'https://graph.facebook.com/v22.0/' . $this->whatsappPhoneId() . '/messages';
        $phoneNumber = $this->formatPhoneNumber($contact->whatsapp_id);

        $payload = [
            'messaging_product' => 'whatsapp',
            'to' => $phoneNumber,
            'type' => $mediaType,
            $mediaType => [
                $sourceKind === 'id' ? 'id' : 'link' => $sourceKind === 'id' ? $source : $this->absoluteMediaLink($source),
            ],
        ];

        if (in_array($mediaType, ['image', 'video'], true) && $caption !== '') {
            $payload[$mediaType]['caption'] = mb_substr($caption, 0, 1024);
        }

        if ($mediaType === 'document') {
            if ($filename !== '') {
                $payload['document']['filename'] = mb_substr($filename, 0, 240);
            }
            if ($caption !== '') {
                $payload['document']['caption'] = mb_substr($caption, 0, 1024);
            }
        }

        $response = Http::withToken($accessToken)->post($url, $payload);
        if ($response->failed()) {
            Log::error('API Error (sendBotMediaNode): ' . $response->body(), [
                'chat_id' => $chat->id,
                'node_id' => $node->id,
                'type' => $mediaType,
                'payload' => $payload,
            ]);
            return;
        }

        $waMessageId = $response->json('messages.0.id');
        $body = $caption !== '' ? $caption : match ($mediaType) {
            'image' => '[Imagen]',
            'video' => '[Video]',
            'audio' => '[Audio]',
            default => '[Documento]',
        };

        $this->persistAndPublishOutgoingMedia(
            $chat,
            $mediaType,
            $body,
            $sourceKind === 'url' ? $source : null,
            $filename !== '' ? $filename : null,
            $waMessageId,
            $mediaType,
        );
    }

    private function absoluteMediaLink(string $source): string
    {
        if (str_starts_with($source, 'http://') || str_starts_with($source, 'https://')) {
            return $source;
        }

        return url('/' . ltrim($source, '/'));
    }

    private function sendPersonLookupNode(Chat $chat, BotNode $node): void
    {
        $settings = $this->nodeSettings($node);
        $vars = $this->getVars($chat);

        $dniVariable = trim((string) ($settings['dni_variable'] ?? 'dni'));
        $rawDni = (string) ($vars[$dniVariable] ?? '');
        $dni = preg_replace('/\D+/u', '', $rawDni);

        $baseVars = [
            'persona_encontrada' => false,
            'persona_lookup_status' => 'error',
            'persona_id' => null,
            'persona_nombres' => null,
            'persona_apellidos' => null,
            'persona_documento' => null,
            'persona_fecha_nacimiento' => null,
            'persona_genero' => null,
            'persona_obra_social' => null,
            'persona_obra_social_id' => null,
            'persona_plan_id' => null,
            'persona_email' => null,
            'persona_contacto_telefono' => null,
            'persona_contacto_telefono_2' => null,
            'persona_planes_activos' => [],
        ];

        $targetNextNodeId = null;
        $messageToSend = null;


        if ($dni === '') {
            $this->setVars($chat, array_merge($baseVars, ['persona_lookup_status' => 'missing_dni']));
            $messageToSend = (string) ($settings['error_message'] ?? 'No pudimos consultar tus datos porque falta el DNI.');
            $targetNextNodeId = $settings['error_next_node_id'] ?? null;
        } else {
            $lookupUrl = $this->alephooPersonLookupUrl($dni);
            $apiKey = $this->alephooApiKey();

            if (!$this->isAlephooEndpointEnabled('/personas/{dni}')) {
                $this->setVars($chat, array_merge($baseVars, ['persona_lookup_status' => 'endpoint_disabled']));
                $messageToSend = (string) ($settings['error_message'] ?? 'La consulta de datos personales no esta habilitada en este momento.');
                $targetNextNodeId = $settings['error_next_node_id'] ?? null;
            } elseif ($lookupUrl === '' || $apiKey === '') {
                $this->setVars($chat, array_merge($baseVars, ['persona_lookup_status' => 'misconfigured']));
                $messageToSend = (string) ($settings['error_message'] ?? 'La integracion con Alephoo no esta configurada correctamente.');
                $targetNextNodeId = $settings['error_next_node_id'] ?? null;
            } else {
                try {
                    $response = Http::timeout($this->alephooTimeout())
                        ->acceptJson()
                        ->withHeaders([
                            'X-API-KEY' => $apiKey,
                        ])
                        ->get($lookupUrl);

                    Log::info('Hospital API person lookup response', [
                        'chat_id' => $chat->id,
                        'node_id' => $node->id,
                        'dni' => $dni,
                        'url' => $lookupUrl,
                        'status' => $response->status(),
                        'ok' => $response->successful(),
                        'json' => $response->json(),
                        'body' => $response->body(),
                    ]);

                    if ($response->successful()) {
                        $payload = $response->json();
                        $person = is_array($payload) && isset($payload[0]) && is_array($payload[0]) ? $payload[0] : null;

                        if ($person) {
                            $this->setVars($chat, array_merge($baseVars, [
                                'persona_encontrada' => true,
                                'persona_lookup_status' => 'found',
                                'persona_id' => $person['id'] ?? null,
                                'persona_nombres' => $person['nombres'] ?? null,
                                'persona_apellidos' => $person['apellidos'] ?? null,
                                'persona_documento' => $person['documento'] ?? null,
                                'persona_fecha_nacimiento' => $person['fecha_nacimiento'] ?? null,
                                'persona_genero' => $person['genero'] ?? null,
                                'persona_obra_social' => $person['obra_social'] ?? null,
                                'persona_obra_social_id' => $person['obra_social_id'] ?? null,
                                'persona_plan_id' => $person['plan_id'] ?? null,
                                'persona_email' => $person['email'] ?? null,
                                'persona_contacto_telefono' => $person['contacto_telefono'] ?? null,
                                'persona_contacto_telefono_2' => $person['contacto_telefono_2'] ?? null,
                                'persona_planes_activos' => is_array($person['planes_activos'] ?? null) ? $person['planes_activos'] : [],
                            ]));

                            $messageToSend = $node->body ? $this->renderTemplate($node->body, $chat, $node) : null;
                            $targetNextNodeId = $node->next_node_id;
                        } else {
                            $this->setVars($chat, array_merge($baseVars, ['persona_lookup_status' => 'not_found']));
                            $messageToSend = (string) ($settings['not_found_message'] ?? 'No encontramos datos personales para el DNI ingresado.');
                            $targetNextNodeId = $settings['not_found_next_node_id'] ?? null;
                        }
                    } elseif ($response->status() === 404) {
                        $this->setVars($chat, array_merge($baseVars, ['persona_lookup_status' => 'not_found']));
                        $messageToSend = (string) ($settings['not_found_message'] ?? 'No encontramos datos personales para el DNI ingresado.');
                        $targetNextNodeId = $settings['not_found_next_node_id'] ?? null;
                    } else {
                        $this->setVars($chat, array_merge($baseVars, ['persona_lookup_status' => 'error']));
                        $messageToSend = (string) ($settings['error_message'] ?? 'No pudimos consultar tus datos en este momento.');
                        $targetNextNodeId = $settings['error_next_node_id'] ?? null;

                        Log::warning('Hospital API person lookup error response', [
                            'chat_id' => $chat->id,
                            'node_id' => $node->id,
                            'dni' => $dni,
                            'status' => $response->status(),
                            'body' => $response->body(),
                        ]);
                    }
                } catch (\Throwable $e) {
                    $this->setVars($chat, array_merge($baseVars, ['persona_lookup_status' => 'error']));
                    $messageToSend = (string) ($settings['error_message'] ?? 'No pudimos consultar tus datos en este momento.');
                    $targetNextNodeId = $settings['error_next_node_id'] ?? null;

                    Log::error('Hospital API person lookup failed: ' . $e->getMessage(), [
                        'chat_id' => $chat->id,
                        'node_id' => $node->id,
                        'dni' => $dni,
                    ]);
                }
            }
        }

        if ($messageToSend !== null && trim((string) $messageToSend) !== '') {
            $renderedMessage = $this->renderTemplate(trim((string) $messageToSend), $chat, $node);
            if ($renderedMessage !== '') {
                $this->sendWhatsAppText($chat, $renderedMessage, 'user', 'bot', 'person_lookup');
            }
        }

        $node->next_node_id = $targetNextNodeId ? (int) $targetNextNodeId : null;
    }



    private function sendWhatsAppButtons(Chat $chat, BotNode $node, string $botNodeType = 'buttons'): void
    {
        $contact = $chat->contact;
        if (!$contact || !$contact->whatsapp_id) {
            return;
        }

        $settings = $node->settings ?? [];
        $buttons = $settings['buttons'] ?? [];
        $bodyText = $this->renderTemplate($node->body ?? '', $chat, $node);

        if (empty($buttons)) {
            $this->sendWhatsAppText($chat, $bodyText, 'user', 'bot', $botNodeType, []);
            return;
        }

        $accessToken = $this->whatsappAccessToken();
        $url = 'https://graph.facebook.com/v22.0/' . $this->whatsappPhoneId() . '/messages';
        $phoneNumber = $this->formatPhoneNumber($contact->whatsapp_id);

        $waButtons = $this->normalizeWhatsAppReplyButtons($buttons, $chat, $node);

        if (empty($waButtons)) {
            Log::warning('sendWhatsAppButtons: no hay botones validos luego de normalizar', [
                'chat_id' => $chat->id,
                'node_id' => $node->id,
                'raw_buttons' => $buttons,
            ]);

            $this->sendWhatsAppText($chat, $bodyText, 'user', 'bot', $botNodeType, []);
            return;
        }

        $bodyText = trim((string) preg_replace('/\s+/u', ' ', (string) $bodyText));
        if ($bodyText === '') {
            $bodyText = 'Selecciona una opcion';
        }
        $bodyText = mb_substr($bodyText, 0, 1024);

        $interactiveOptions = array_map(function ($btn) {
            return [
                'id' => (string) ($btn['reply']['id'] ?? ''),
                'label' => (string) ($btn['reply']['title'] ?? ''),
                'kind' => 'button',
            ];
        }, $waButtons);

        $payload = [
            'messaging_product' => 'whatsapp',
            'to' => $phoneNumber,
            'type' => 'interactive',
            'interactive' => [
                'type' => 'button',
                'body' => [
                    'text' => $bodyText,
                ],
                'action' => [
                    'buttons' => $waButtons,
                ],
            ],
        ];

        $response = Http::withToken($accessToken)->post($url, $payload);

        if ($response->failed()) {
            Log::error('API Error (sendWhatsAppButtons): ' . $response->body(), [
                'chat_id' => $chat->id,
                'node_id' => $node->id,
                'body_length' => mb_strlen($bodyText),
                'payload' => $payload,
            ]);
            return;
        }

        $waMessageId = $response->json()['messages'][0]['id'] ?? null;
        $this->persistAndPublishOutgoing($chat, $bodyText, $waMessageId, $botNodeType, $interactiveOptions);
    }

    private function normalizeWhatsAppReplyButtons(array $buttons, Chat $chat, BotNode $node): array
    {
        $normalized = [];
        $usedIds = [];
        $usedTitles = [];

        foreach (array_slice($buttons, 0, 3) as $index => $btn) {
            $rawTitle = $this->renderTemplate((string) ($btn['title'] ?? ''), $chat, $node);
            $title = preg_replace('/\s+/u', ' ', trim($rawTitle));
            $title = preg_replace('/[*_~`]/u', '', (string) $title);
            $title = trim((string) $title);

            if ($title === '') {
                $title = 'Opcion ' . ($index + 1);
            }

            $title = mb_substr($title, 0, 20);
            $baseTitle = $title;
            $titleSuffix = 2;

            while (isset($usedTitles[mb_strtolower($title)])) {
                $title = mb_substr($baseTitle, 0, max(1, 20 - mb_strlen(' ' . $titleSuffix))) . ' ' . $titleSuffix;
                $titleSuffix++;
            }

            $usedTitles[mb_strtolower($title)] = true;

            $rawId = preg_replace('/\s+/u', '_', trim((string) ($btn['id'] ?? '')));
            $rawId = preg_replace('/[^A-Za-z0-9_.:-]/u', '_', (string) $rawId);
            $id = trim((string) $rawId, '_');

            if ($id === '') {
                $id = 'btn_' . ($index + 1);
            }

            $id = mb_substr($id, 0, 256);
            $baseId = $id;
            $suffix = 2;

            while (isset($usedIds[$id])) {
                $id = mb_substr($baseId . '_' . $suffix, 0, 256);
                $suffix++;
            }

            $usedIds[$id] = true;

            $normalized[] = [
                'type' => 'reply',
                'reply' => [
                    'id' => $id,
                    'title' => $title,
                ],
            ];
        }

        return $normalized;
    }

    private function sendWhatsAppList(Chat $chat, BotNode $node, string $botNodeType = 'list'): void
    {
        $contact = $chat->contact;
        if (!$contact || !$contact->whatsapp_id) {
            return;
        }

        $settings = $node->settings ?? [];

        $buttonText = $settings['button_text'] ?? 'Ver opciones';
        $sectionTitle = $settings['section_title'] ?? 'Opciones';
        $rows = $settings['rows'] ?? [];

        // ✅ Render con variables
        $bodyText = $this->renderTemplate($node->body ?? '', $chat, $node);
        $buttonText = $this->renderTemplate((string) $buttonText, $chat, $node);
        $sectionTitle = $this->renderTemplate((string) $sectionTitle, $chat, $node);

        if (empty($rows)) {
            $this->sendWhatsAppText($chat, $bodyText, 'user', 'bot', $botNodeType, []);
            return;
        }

        $accessToken = $this->whatsappAccessToken();
        $url = 'https://graph.facebook.com/v22.0/' . $this->whatsappPhoneId() . '/messages';

        $phoneNumber = $this->formatPhoneNumber($contact->whatsapp_id);

        $waRows = [];
        foreach ($rows as $row) {
            $waRows[] = [
                'id' => $row['id'],
                'title' => $this->renderTemplate((string) ($row['title'] ?? ''), $chat, $node),
                'description' => ($desc = $this->renderTemplate((string) ($row['description'] ?? ''), $chat, $node)) !== ''
                    ? $desc
                    : null,
            ];
        }

        $interactiveOptions = array_map(function ($row) {
            return [
                'id' => (string) ($row['id'] ?? ''),
                'label' => (string) ($row['title'] ?? ''),
                'description' => (string) ($row['description'] ?? ''),
                'kind' => 'list',
            ];
        }, $waRows);

        $payload = [
            'messaging_product' => 'whatsapp',
            'to' => $phoneNumber,
            'type' => 'interactive',
            'interactive' => [
                'type' => 'list',
                'body' => [
                    'text' => $bodyText,
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

        // ✅ persistimos el texto renderizado
        $this->persistAndPublishOutgoing($chat, $bodyText, $waMessageId, $botNodeType, $interactiveOptions);
    }


    public function updateBotStatus(Request $request, Chat $chat)
    {
        $data = $request->validate([
            'bot_enabled' => 'required|boolean',
        ]);
        $actor = $request->user();
        $before = (bool) $chat->bot_enabled;

        try {
            $chat->bot_enabled = $data['bot_enabled'];
            $chat->save();

            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_status_bot_' . uniqid());
            $mqtt->connect();

            $mqtt->publish("status_bot/chat/" . $chat->id, json_encode([
                'chat_id' => $chat->id,
                'status' => $chat->bot_enabled ? 'enabled' : 'disabled',
            ]), 0);

            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::error('MQTT Error (setVar vars): ' . $e->getMessage());
        }

        $this->auditService->recordChatAction(
            $chat->bot_enabled ? 'bot_enabled' : 'bot_disabled',
            $chat->bot_enabled ? 'Activo el bot del chat' : 'Pauso el bot del chat',
            $chat,
            $actor,
            [
                'before' => [
                    'bot_enabled' => $before,
                ],
                'after' => [
                    'bot_enabled' => (bool) $chat->bot_enabled,
                ],
            ],
        );

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

    private function resetChatToStartFromFlow(Chat $chat, BotFlow $flow, string $reason = null): void
    {
        if (!$flow->start_node_id)
            return;

        // ✅ preservar variables ya capturadas
        $state = $this->getState($chat);
        $vars = is_array($state['vars'] ?? null) ? $state['vars'] : [];
        $varsByDate = is_array($state['vars_by_date'] ?? null) ? $state['vars_by_date'] : [];

        $chat->bot_flow_id = $flow->id;
        $chat->bot_node_id = $flow->start_node_id;

        // ✅ limpiamos solo lo que rompe el próximo ciclo
        $chat->bot_state = [
            'vars' => $vars,
            'vars_by_date' => $varsByDate,
            // pending_input se elimina al reset
        ];
        $chat->bot_step = null;
        $chat->bot_enabled = true;

        $chat->save();

        Log::info("Chat {$chat->id} reset to start_node_id={$flow->start_node_id}. reason={$reason}");
    }


    private function maybeResetAfterSendingNode(Chat $chat, BotFlow $flow, BotNode $sentNode): bool
    {
        if (!$chat->bot_enabled)
            return false;

        // ✅ text y person_lookup pueden ser terminales automáticos
        if (in_array($sentNode->type, ['text', 'person_lookup', 'image', 'document', 'video', 'audio'], true) && empty($sentNode->next_node_id)) {
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
        if ($node->type === 'person_lookup') {
            return true;
        }

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

    private function setVars(Chat $chat, array $pairs): void
    {
        if (empty($pairs)) {
            return;
        }

        $state = $this->getState($chat);
        $state['vars'] = is_array($state['vars'] ?? null) ? $state['vars'] : [];
        $state['vars_by_date'] = is_array($state['vars_by_date'] ?? null) ? $state['vars_by_date'] : [];

        $isoNow = now()->toIso8601String();
        $dateKey = now()->format('Y-m-d');
        $state['vars_by_date'][$dateKey] = is_array($state['vars_by_date'][$dateKey] ?? null)
            ? $state['vars_by_date'][$dateKey]
            : [];

        foreach ($pairs as $key => $value) {
            $state['vars'][$key] = $value;
            $state['vars_by_date'][$dateKey][$key] = [
                'value' => $value,
                'updated_at' => $isoNow,
            ];
        }

        $chat->bot_state = $state;
        $chat->save();

        try {
            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_vars_batch_' . uniqid());
            $mqtt->connect();

            $mqtt->publish("chat/{$chat->id}/vars", json_encode([
                'chat_id' => $chat->id,
                'updated_vars' => array_keys($pairs),
                'vars' => $state['vars'],
                'vars_by_date' => $state['vars_by_date'],
                'timestamp' => $isoNow,
            ]), 0);

            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::error('MQTT Error (setVars vars): ' . $e->getMessage());
        }
    }

    private function setVar(Chat $chat, string $key, $value): void
    {
        $this->setVars($chat, [$key => $value]);
    }



    private function setPendingInput(Chat $chat, BotNode $node): void
    {
        $settings = is_array($node->settings) ? $node->settings : [];
        $responseMode = in_array(($settings['response_mode'] ?? 'text'), ['buttons', 'list'], true)
            ? (string) $settings['response_mode']
            : 'text';

        $state = $this->getState($chat);
        $state['pending_input'] = [
            'node_id' => $node->id,
            'variable' => (string) ($settings['variable'] ?? ''),
            'validation_regex' => (string) ($settings['validation_regex'] ?? ''),
            'error_message' => (string) ($settings['error_message'] ?? 'Valor inválido, intentá de nuevo.'),
            'next_node_id' => $node->next_node_id, // clave: a dónde avanzar cuando capture OK
            'response_mode' => $responseMode,
            'options' => $this->pendingInputOptions($settings, $responseMode, $chat, $node),
        ];
        $this->setState($chat, $state);
    }

    private function pendingInputOptions(array $settings, string $responseMode, Chat $chat, BotNode $node): array
    {
        $items = $responseMode === 'buttons'
            ? ($settings['buttons'] ?? [])
            : ($responseMode === 'list' ? ($settings['rows'] ?? []) : []);

        if (!is_array($items)) {
            return [];
        }

        return array_values(array_filter(array_map(function ($item) use ($chat, $node) {
            if (!is_array($item)) {
                return null;
            }

            $id = trim((string) ($item['id'] ?? ''));
            $label = trim((string) $this->renderTemplate((string) ($item['title'] ?? ''), $chat, $node));

            if ($id === '' || $label === '') {
                return null;
            }

            return [
                'id' => $id,
                'label' => $label,
                'next_node_id' => $item['next_node_id'] ?? null,
            ];
        }, $items)));
    }

    private function resolvePendingInputOption(array $pending, ?string $interactiveReplyId, string $body): ?array
    {
        $options = is_array($pending['options'] ?? null) ? $pending['options'] : [];

        foreach ($options as $option) {
            if (is_array($option) && $interactiveReplyId !== null && (string) ($option['id'] ?? '') === $interactiveReplyId) {
                return [
                    'id' => (string) ($option['id'] ?? ''),
                    'label' => (string) ($option['label'] ?? ''),
                    'next_node_id' => $option['next_node_id'] ?? null,
                ];
            }
        }

        $normalizedBody = mb_strtolower(trim($body));

        foreach ($options as $option) {
            if (is_array($option) && mb_strtolower(trim((string) ($option['label'] ?? ''))) === $normalizedBody) {
                return [
                    'id' => (string) ($option['id'] ?? ''),
                    'label' => (string) ($option['label'] ?? ''),
                    'next_node_id' => $option['next_node_id'] ?? null,
                ];
            }
        }

        return null;
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

    private function renderTemplate(?string $text, Chat $chat, ?BotNode $node = null): string
    {
        if ($text === null || $text === '')
            return (string) $text;

        $vars = $this->getVars($chat);

        // built-ins (sin ensuciar vars del usuario)
        $builtins = [
            'chat.id' => (string) $chat->id,
            'chat.status' => (string) $chat->status,
            'contact.name' => (string) ($chat->contact?->name ?? ''),
            'contact.whatsapp_id' => (string) ($chat->contact?->whatsapp_id ?? ''),
            'flow.id' => (string) ($chat->bot_flow_id ?? ''),
            'node.id' => (string) ($node?->id ?? ($chat->bot_node_id ?? '')),
            'node.key' => (string) ($node?->key ?? ''),
        ];

        // Reemplaza {{ ... }}
        $out = preg_replace_callback('/\{\{\s*(.+?)\s*\}\}/u', function ($m) use ($vars, $builtins) {
            $expr = trim($m[1]);

            // soporta: key|default|pipe1|pipe2...
            $parts = array_map('trim', explode('|', $expr));
            $key = $parts[0] ?? '';

            // default (si viene)
            $default = null;
            if (count($parts) >= 2 && $this->isDefaultCandidate($parts[1])) {
                $default = $parts[1];
            }

            // valor
            $value = null;

            if ($key !== '') {
                if (array_key_exists($key, $builtins)) {
                    $value = $builtins[$key];
                } elseif (array_key_exists($key, $vars)) {
                    $value = $vars[$key];
                }
            }

            // si es array/obj lo pasamos a json legible
            if (is_array($value) || is_object($value)) {
                $value = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            }

            $value = (string) ($value ?? '');

            // default si vacío
            if ($value === '' && $default !== null) {
                $value = (string) $default;
            }

            // pipes (a partir del 2do si usamos default, o del 2do siempre si no)
            $pipeStart = 1;
            if ($default !== null)
                $pipeStart = 2;

            for ($i = $pipeStart; $i < count($parts); $i++) {
                $pipe = strtolower(trim($parts[$i]));
                $value = $this->applyPipe($value, $pipe);
            }

            return $value;
        }, $text);

        return $out ?? $text;
    }

    private function isDefaultCandidate(string $s): bool
    {
        // cualquier texto que no sea un pipe conocido lo tratamos como default
        // (si querés, podés hacerlo más estricto)
        $pipes = ['upper', 'lower', 'trim'];
        return !in_array(strtolower(trim($s)), $pipes, true);
    }

    private function applyPipe(string $value, string $pipe): string
    {
        return match ($pipe) {
            'upper' => mb_strtoupper($value),
            'lower' => mb_strtolower($value),
            'trim' => trim($value),
            default => $value, // pipes desconocidos: no hacen nada
        };
    }

    private function runtimeSetting(string $key, ?string $fallback = null): ?string
    {
        if ($this->runtimeSettingsCache === null) {
            $this->runtimeSettingsCache = [];

            try {
                if (Schema::hasTable('system_settings')) {
                    $this->runtimeSettingsCache = SystemSetting::query()
                        ->whereIn('key', [
                            'integrations.whatsapp.token',
                            'integrations.whatsapp.phone_number_id',
                            'integrations.whatsapp.webhook_verify_token',
                            'integrations.alephoo.base_url',
                            'integrations.alephoo.api_key',
                            'integrations.alephoo.timeout',
                            'integrations.alephoo.enabled_endpoints',
                            'bot.inactivity_timeout_minutes',
                            'bot.inactivity_timeout_message',
                        ])
                        ->pluck('value', 'key')
                        ->toArray();
                }
            } catch (\Throwable $e) {
                $this->runtimeSettingsCache = [];
            }
        }

        $value = $this->runtimeSettingsCache[$key] ?? null;
        if (is_string($value) && trim($value) !== '') {
            return $value;
        }

        return $fallback;
    }

    private function whatsappAccessToken(): string
    {
        return (string) $this->runtimeSetting('integrations.whatsapp.token', env('WHATSAPP_ACCESS_TOKEN', ''));
    }

    private function whatsappPhoneId(): string
    {
        return (string) $this->runtimeSetting('integrations.whatsapp.phone_number_id', env('WHATSAPP_PHONE_ID', ''));
    }

    private function whatsappVerifyToken(): string
    {
        return (string) $this->runtimeSetting('integrations.whatsapp.webhook_verify_token', env('WHATSAPP_VERIFY_TOKEN', ''));
    }

    private function resolveWhatsAppMediaUrl(string $mediaId): ?string
    {
        try {
            $response = Http::withToken($this->whatsappAccessToken())
                ->get("https://graph.facebook.com/v22.0/{$mediaId}");

            if ($response->successful()) {
                return $response->json('url');
            }

            Log::warning('No se pudo resolver URL de media WhatsApp: ' . $response->status(), [
                'media_id' => $mediaId,
                'response' => $response->body(),
            ]);
        } catch (\Throwable $e) {
            Log::error('Error resolviendo URL de media WhatsApp: ' . $e->getMessage(), [
                'media_id' => $mediaId,
            ]);
        }

        return null;
    }

    private function alephooBaseUrl(): string
    {
        return rtrim((string) $this->runtimeSetting(
            'integrations.alephoo.base_url',
            env('HOSPITAL_PERSON_API_BASE', 'http://172.22.118.103/apiturnos/public/api/v1/personas')
        ), '/');
    }

    private function alephooApiKey(): string
    {
        return (string) $this->runtimeSetting('integrations.alephoo.api_key', env('HOSPITAL_PERSON_API_KEY', 'Turnos2025'));
    }

    private function alephooTimeout(): int
    {
        $timeout = (int) $this->runtimeSetting('integrations.alephoo.timeout', '30');

        return max(1, min(300, $timeout));
    }

    private function alephooPersonLookupUrl(string $dni): string
    {
        $baseUrl = $this->alephooBaseUrl();
        if ($baseUrl === '') {
            return '';
        }

        if (str_ends_with($baseUrl, '/personas')) {
            return $baseUrl . '/' . urlencode($dni);
        }

        return $baseUrl . '/personas/' . urlencode($dni);
    }

    private function isAlephooEndpointEnabled(string $endpoint): bool
    {
        $raw = (string) $this->runtimeSetting('integrations.alephoo.enabled_endpoints', '');
        $lines = array_values(array_filter(array_map(
            fn($line) => trim(str_replace('\\', '/', (string) $line)),
            preg_split('/\r\n|\r|\n/', $raw) ?: []
        )));

        if (empty($lines)) {
            return true;
        }

        $normalizedEndpoint = '/' . ltrim(str_replace('\\', '/', trim($endpoint)), '/');

        foreach ($lines as $line) {
            $normalizedLine = '/' . ltrim($line, '/');

            if ($normalizedLine === $normalizedEndpoint) {
                return true;
            }

            if (str_ends_with($normalizedLine, '/*')) {
                $prefix = substr($normalizedLine, 0, -1);
                if (str_starts_with($normalizedEndpoint, $prefix)) {
                    return true;
                }
            }
        }

        return false;
    }
}
