<?php

namespace App\Http\Controllers;

use App\Models\BotFlow;
use App\Models\BotNode;
use App\Models\CampaignRecipient;
use App\Models\Chat;
use App\Models\Contact;
use App\Models\Message;
use App\Models\MessageStatus;
use App\Models\SystemSetting;
use App\Services\AuditService;
use App\Services\BotInactivityService;
use App\Services\CampaignMetricsService;
use Illuminate\Http\Request;
use Illuminate\Support\Env;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
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

    private function processMessageStatuses(array $statuses): void
    {
        $priority = [
            'failed' => 0,
            'sent' => 1,
            'delivered' => 2,
            'read' => 3,
        ];

        foreach ($statuses as $statusData) {
            $whatsappMessageId = $statusData['id'] ?? null;
            $status = $statusData['status'] ?? null;

            if (!$whatsappMessageId || !isset($priority[$status])) {
                continue;
            }

            $message = Message::where('whatsapp_message_id', $whatsappMessageId)->first();
            $campaignRecipient = CampaignRecipient::query()
                ->where('whatsapp_message_id', $whatsappMessageId)
                ->first();

            if ($campaignRecipient) {
                $currentPriority = $priority[$campaignRecipient->status] ?? -1;
                $nextPriority = $priority[$status];
                $changedAt = isset($statusData['timestamp'])
                    ? now()->setTimestamp((int) $statusData['timestamp'])
                    : now();
                $updates = [];

                if ($status === 'failed' || $nextPriority >= $currentPriority) {
                    $updates['status'] = $status;
                }

                if ($status === 'sent') {
                    $updates['sent_at'] = $campaignRecipient->sent_at ?? $changedAt;
                } elseif ($status === 'delivered') {
                    $updates['delivered_at'] = $changedAt;
                } elseif ($status === 'read') {
                    $updates['read_at'] = $changedAt;
                    $updates['delivered_at'] = $campaignRecipient->delivered_at ?? $changedAt;
                } elseif ($status === 'failed') {
                    $updates['failed_at'] = $changedAt;
                    $updates['error_code'] = (string) data_get($statusData, 'errors.0.code', '');
                    $updates['error_message'] = (string) data_get(
                        $statusData,
                        'errors.0.error_data.details',
                        data_get($statusData, 'errors.0.title', 'Meta informo que el mensaje fallo.')
                    );
                }

                if ($updates !== []) {
                    $campaignRecipient->update($updates);
                    app(CampaignMetricsService::class)->refresh($campaignRecipient->campaign_id);
                }
            }

            if (!$message) {
                Log::warning('Status recibido para mensaje no encontrado', [
                    'whatsapp_message_id' => $whatsappMessageId,
                    'status' => $status,
                ]);
                continue;
            }

            $currentPriority = $priority[$message->status] ?? -1;
            $nextPriority = $priority[$status];

            if ($status === 'failed' || $nextPriority >= $currentPriority) {
                $message->status = $status;
                $message->save();
            }

            MessageStatus::create([
                'message_id' => $message->id,
                'status' => $status,
                'changed_at' => isset($statusData['timestamp'])
                    ? now()->setTimestamp((int) $statusData['timestamp'])
                    : now(),
            ]);

            $this->publishMessageStatus($message, $status);
        }
    }

    private function publishMessageStatus(Message $message, string $status): void
    {
        $host = env('MQTT_HOST') ?: env('VITE_MOSQUITTO_HOST');
        if (!$host) {
            Log::warning('MQTT host not configured for message status publish.', [
                'chat_id' => $message->chat_id,
                'message_id' => $message->id,
                'status' => $status,
            ]);
            return;
        }

        try {
            $mqtt = new MqttClient((string) $host, 1883, 'laravel_msg_status_' . uniqid());
            $mqtt->connect();
            $mqtt->publish("chat/{$message->chat_id}/status", json_encode([
                'chat_id' => (int) $message->chat_id,
                'message_id' => (int) $message->id,
                'whatsapp_message_id' => $message->whatsapp_message_id,
                'status' => $status,
            ]), 0);
            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::error('MQTT Error (message status): ' . $e->getMessage());
        }
    }

    /**
     * Webhook de recepciÃƒÂ³n de mensajes desde WhatsApp.
     */
    public function receiveMessage(Request $request)
    {
        $data = $request->all();

        Log::info('Recibido mensaje de WhatsApp: ' . json_encode($data));

        if (isset($data['entry'][0]['changes'][0]['value']['statuses'][0])) {
            $this->processMessageStatuses($data['entry'][0]['changes'][0]['value']['statuses']);
            return response('EVENT_RECEIVED', 200);
        }

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
        // 3) Normalizar info segÃƒÂºn tipo
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

            case 'contacts':
                $messageType = 'contacts';
                $contacts = is_array($messageData['contacts'] ?? null) ? $messageData['contacts'] : [];
                $firstContact = $contacts[0] ?? [];
                $displayName = (string) ($firstContact['name']['formatted_name'] ?? $firstContact['name']['first_name'] ?? 'Contacto');
                $phone = (string) ($firstContact['phones'][0]['wa_id'] ?? $firstContact['phones'][0]['phone'] ?? '');
                $body = json_encode([
                    'contacts' => $contacts,
                    'display_name' => $displayName,
                    'phone' => $phone,
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                $mediaName = $displayName;
                break;

            case 'location':
                $messageType = 'location';
                $location = is_array($messageData['location'] ?? null) ? $messageData['location'] : [];
                $body = json_encode([
                    'latitude' => isset($location['latitude']) ? (float) $location['latitude'] : null,
                    'longitude' => isset($location['longitude']) ? (float) $location['longitude'] : null,
                    'name' => $location['name'] ?? null,
                    'address' => $location['address'] ?? null,
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                $mediaName = (string) ($location['name'] ?? $location['address'] ?? 'Ubicacion');
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


            // 3) Actualizar ÃƒÂºltima interacciÃƒÂ³n del usuario (entrante)
            $chat->last_user_message_at = now();

            // Si por algÃƒÂºn motivo quedÃƒÂ³ sin nodo, iniciamos
            if (!$chat->bot_node_id) {
                $chat->bot_node_id = $flow->start_node_id ?? null;
            }

            $chat->save();
        }


        // --------------------------------
        // 6) Descargar media (si hay) y generar URL pÃƒÂºblica
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
                    // extensiÃƒÂ³n a partir del mime_type
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

                    // Evitar duplicar extensiÃƒÂ³n si el nombre ya la trae (documentos)
                    if ($ext && !str_contains($baseName, '.')) {
                        $fileName = ($messageType ?: 'file') . '_' . $baseName . '.' . $ext;
                    } else {
                        $fileName = ($messageType ?: 'file') . '_' . $baseName;
                    }

                    $path = 'whatsapp/' . $chat->id . '/' . $fileName;

                    Storage::disk('public')->put($path, $fileResponse->body());

                    // URL pÃƒÂºblica relativa (requiere php artisan storage:link)
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
                'avatar' => $contact->profile_pic,
                'lastMessage' => $previewText,
                'timestamp' => now()->utc()->toIso8601String(),
            ]), 0);

            // ChatMain
            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id' => $chat->id,
                'message_id' => $message->id,
                'sender' => $message->sender,
                'sender_subtype' => $message->sender_subtype,
                'operator_name' => $message->operator_name,
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
                            // opcional: si el start tambiÃƒÂ©n tiene auto_advance, lo corrÃƒÂ©s
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
            $message = $this->sendWhatsAppText($chat, $messageBody, 'user', 'operator', null, null, $actor?->name);
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
                'operator_name' => $message->operator_name,
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
            'file' => 'required|file|max:102400',
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
        $extension = strtolower((string) ($file->getClientOriginalExtension() ?: pathinfo($originalName, PATHINFO_EXTENSION)));
        $sniff = $this->sniffAudioContainer($file->getRealPath());

        $allowedMimes = match ($messageType) {
            'image' => ['image/jpeg', 'image/png', 'image/webp'],
            'video' => ['video/mp4', 'video/3gpp'],
            'audio' => ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg', 'audio/opus'],
            'document' => [
                'text/plain',
                'application/pdf',
                'application/msword',
                'application/vnd.ms-excel',
                'application/vnd.ms-powerpoint',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            ],
            default => [],
        };
        $allowedExtensions = match ($messageType) {
            'image' => ['jpg', 'jpeg', 'png', 'webp'],
            'video' => ['mp4', '3gp'],
            'audio' => ['aac', 'm4a', 'mp3', 'amr', 'ogg', 'opus'],
            'document' => ['txt', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
            default => [],
        };

        if (
            $allowedMimes
            && !in_array(strtolower($uploadMime), $allowedMimes, true)
            && !in_array(strtolower($mime), $allowedMimes, true)
            && !in_array($extension, $allowedExtensions, true)
        ) {
            return response()->json([
                'error' => match ($messageType) {
                    'image' => 'Formato de imagen no compatible con WhatsApp. UsÃƒÂ¡ JPG, PNG o WEBP.',
                    'video' => 'Formato de video no compatible con WhatsApp. UsÃƒÂ¡ MP4 o 3GP.',
                    'audio' => 'Formato de audio no compatible con WhatsApp. UsÃƒÂ¡ AAC, M4A, MP3, AMR, OGG u OPUS.',
                    'document' => 'Formato de documento no compatible con WhatsApp. UsÃƒÂ¡ PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX o TXT.',
                    default => 'Formato no compatible con WhatsApp.',
                },
            ], 422);
        }

        if ($allowedExtensions && $extension !== '' && !in_array($extension, $allowedExtensions, true)) {
            return response()->json([
                'error' => match ($messageType) {
                    'image' => 'Formato de imagen no compatible con WhatsApp. UsÃƒÂ¡ JPG, PNG o WEBP.',
                    'video' => 'Formato de video no compatible con WhatsApp. UsÃƒÂ¡ MP4 o 3GP.',
                    'audio' => 'Formato de audio no compatible con WhatsApp. UsÃƒÂ¡ AAC, M4A, MP3, AMR, OGG u OPUS.',
                    'document' => 'Formato de documento no compatible con WhatsApp. UsÃƒÂ¡ PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX o TXT.',
                    default => 'Formato no compatible con WhatsApp.',
                },
            ], 422);
        }

        $maxSize = $this->maxWhatsAppMediaBytes($messageType);
        if ($maxSize > 0 && (int) $file->getSize() > $maxSize) {
            return response()->json([
                'error' => match ($messageType) {
                    'image' => 'La imagen supera el limite de WhatsApp. UsÃƒÂ¡ un archivo de hasta 5 MB.',
                    'video' => 'El video supera el limite de WhatsApp. UsÃƒÂ¡ un archivo de hasta 16 MB.',
                    'audio' => 'El audio supera el limite de WhatsApp. UsÃƒÂ¡ un archivo de hasta 16 MB.',
                    'document' => 'El documento supera el limite de WhatsApp. UsÃƒÂ¡ un archivo de hasta 100 MB.',
                    default => 'El archivo supera el limite permitido por WhatsApp.',
                },
            ], 422);
        }

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
                    'error' => "Audio no soportado para WhatsApp: {$mime} (uploadMime={$uploadMime}). SubÃƒÂ­ OGG/OPUS o MP3/M4A.",
                ], 422);
            }

            if ($uploadMime === 'audio/mp4' && $sniff !== 'mp4') {
                return response()->json([
                    'error' => "El archivo NO parece MP4/M4A vÃƒÂ¡lido (firma={$sniff}).",
                ], 422);
            }
            if ($uploadMime === 'audio/mpeg' && $sniff !== 'mp3') {
                return response()->json([
                    'error' => "El archivo NO parece MP3 vÃƒÂ¡lido (firma={$sniff}).",
                ], 422);
            }
            if (str_starts_with($uploadMime, 'audio/ogg') && $sniff !== 'ogg') {
                return response()->json([
                    'error' => "El archivo NO parece OGG vÃƒÂ¡lido (firma={$sniff}).",
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

            // 3) Guardar copia local para previsualizaciÃƒÂ³n en front
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
                'operator_name' => $actor?->name,
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
                    'avatar' => $contact->profile_pic,
                    'lastMessage' => $previewText,
                    'timestamp' => $message->created_at->toIso8601String(),
                ]), 0);

                $mqtt->publish("chat/{$chat->id}", json_encode([
                    'chat_id' => $chat->id,
                    'message_id' => $message->id,
                    'sender' => $message->sender,
                    'sender_subtype' => $message->sender_subtype,
                    'operator_name' => $message->operator_name,
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
                    'operator_name' => $message->operator_name,
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
     * Formatear nÃƒÂºmero de telÃƒÂ©fono a formato internacional.
     */
    public function sendContact(Request $request)
    {
        $validated = $request->validate([
            'chat_id' => 'required|integer|exists:chats,id',
            'first_name' => 'nullable|string|max:80',
            'last_name' => 'nullable|string|max:80',
            'formatted_name' => 'required|string|max:160',
            'phone' => 'required|string|max:32',
            'organization' => 'nullable|string|max:120',
            'title' => 'nullable|string|max:120',
        ]);

        $chat = Chat::with('contact')->findOrFail($validated['chat_id']);
        $contact = $chat->contact;
        $actor = $request->user();

        if (!$contact || !$contact->whatsapp_id) {
            return response()->json(['error' => 'Contacto sin whatsapp_id'], 422);
        }

        $firstName = trim((string) ($validated['first_name'] ?? ''));
        $lastName = trim((string) ($validated['last_name'] ?? ''));
        $formattedName = trim((string) $validated['formatted_name']);
        $phone = preg_replace('/[^\d+]/', '', (string) $validated['phone']);
        $organization = trim((string) ($validated['organization'] ?? ''));
        $title = trim((string) ($validated['title'] ?? ''));

        if ($firstName === '') {
            $firstName = $formattedName;
        }

        $contactPayload = [
            'name' => array_filter([
                'formatted_name' => mb_substr($formattedName, 0, 160),
                'first_name' => mb_substr($firstName, 0, 80),
                'last_name' => $lastName !== '' ? mb_substr($lastName, 0, 80) : null,
            ], fn ($value) => $value !== null && $value !== ''),
            'phones' => [
                array_filter([
                    'phone' => mb_substr($phone, 0, 32),
                    'wa_id' => preg_replace('/\D+/', '', $phone),
                    'type' => 'CELL',
                ], fn ($value) => $value !== null && $value !== ''),
            ],
        ];

        if ($organization !== '' || $title !== '') {
            $contactPayload['org'] = array_filter([
                'company' => $organization !== '' ? mb_substr($organization, 0, 120) : null,
                'title' => $title !== '' ? mb_substr($title, 0, 120) : null,
            ], fn ($value) => $value !== null && $value !== '');
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'to' => $this->formatPhoneNumber($contact->whatsapp_id),
            'type' => 'contacts',
            'contacts' => [$contactPayload],
        ];

        $url = 'https://graph.facebook.com/v22.0/' . $this->whatsappPhoneId() . '/messages';
        $response = Http::withToken($this->whatsappAccessToken())->post($url, $payload);

        if ($response->failed()) {
            Log::error('API Error (sendContact): ' . $response->body(), [
                'chat_id' => $chat->id,
                'payload' => $payload,
            ]);

            $this->auditService->recordMessageAction(
                'contact_send_failed',
                'Fallo al enviar contacto al chat',
                $chat,
                $actor,
                null,
                [
                    'meta' => [
                        'display_name' => $formattedName,
                        'phone' => $phone,
                        'error' => 'Error enviando contacto a WhatsApp',
                    ],
                ],
            );

            return response()->json(['error' => 'Error enviando contacto a WhatsApp'], 500);
        }

        $body = json_encode([
            'contacts' => [$contactPayload],
            'display_name' => $formattedName,
            'phone' => $phone,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $message = Message::create([
            'chat_id' => $chat->id,
            'sender' => 'user',
            'sender_subtype' => 'operator',
            'operator_name' => $request->user()?->name,
            'bot_node_type' => null,
            'interactive_options' => null,
            'message_type' => 'contacts',
            'body' => $body,
            'status' => 'sent',
            'whatsapp_message_id' => $response->json('messages.0.id'),
        ]);

        $this->auditService->recordMessageAction(
            'contact_sent',
            'Envio contacto manual',
            $chat,
            $actor,
            $message,
            [
                'meta' => [
                    'display_name' => $formattedName,
                    'phone' => $phone,
                    'message_id' => $message->id,
                ],
            ],
        );

        try {
            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_send_contact_' . uniqid());
            $mqtt->connect();

            $mqtt->publish('sidebar/chat', json_encode([
                'chat_id' => $chat->id,
                'name' => $contact->name ?? 'Desconocido',
                'avatar' => $contact->profile_pic,
                'lastMessage' => $body,
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id' => $chat->id,
                'message_id' => $message->id,
                'sender' => $message->sender,
                'sender_subtype' => $message->sender_subtype,
                'operator_name' => $message->operator_name,
                'bot_node_type' => $message->bot_node_type,
                'interactive_options' => $message->interactive_options,
                'body' => $message->body,
                'message_type' => $message->message_type,
                'media_url' => null,
                'media_name' => null,
                'status' => $message->status,
                'timestamp' => $message->created_at?->toIso8601String(),
            ]), 0);

            $mqtt->disconnect();
        } catch (MqttClientException $e) {
            Log::error('MQTT Error (sendContact): ' . $e->getMessage());
        }

        return response()->json(['ok' => true, 'message' => $message]);
    }

    public function sendLocation(Request $request)
    {
        $validated = $request->validate([
            'chat_id' => 'required|integer|exists:chats,id',
            'latitude' => 'required|numeric|between:-90,90',
            'longitude' => 'required|numeric|between:-180,180',
            'name' => 'nullable|string|max:1000',
            'address' => 'nullable|string|max:1000',
        ]);

        $chat = Chat::with('contact')->findOrFail($validated['chat_id']);
        $contact = $chat->contact;
        $actor = $request->user();

        if (!$contact || !$contact->whatsapp_id) {
            return response()->json(['error' => 'Contacto sin whatsapp_id'], 422);
        }

        $location = [
            'latitude' => (float) $validated['latitude'],
            'longitude' => (float) $validated['longitude'],
        ];
        $name = trim((string) ($validated['name'] ?? ''));
        $address = trim((string) ($validated['address'] ?? ''));

        if ($name !== '') {
            $location['name'] = mb_substr($name, 0, 1000);
        }
        if ($address !== '') {
            $location['address'] = mb_substr($address, 0, 1000);
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'recipient_type' => 'individual',
            'to' => $this->formatPhoneNumber($contact->whatsapp_id),
            'type' => 'location',
            'location' => $location,
        ];

        $url = 'https://graph.facebook.com/v22.0/' . $this->whatsappPhoneId() . '/messages';
        $response = Http::withToken($this->whatsappAccessToken())->post($url, $payload);

        if ($response->failed()) {
            Log::error('API Error (sendLocation): ' . $response->body(), [
                'chat_id' => $chat->id,
                'payload' => $payload,
            ]);

            $this->auditService->recordMessageAction(
                'location_send_failed',
                'Fallo al enviar ubicacion al chat',
                $chat,
                $actor,
                null,
                [
                    'meta' => [
                        'location' => $location,
                        'error' => 'Error enviando ubicacion a WhatsApp',
                    ],
                ],
            );

            return response()->json(['error' => 'Error enviando ubicacion a WhatsApp'], 500);
        }

        $body = json_encode($location, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $message = Message::create([
            'chat_id' => $chat->id,
            'sender' => 'user',
            'sender_subtype' => 'operator',
            'operator_name' => $actor?->name,
            'bot_node_type' => null,
            'interactive_options' => null,
            'message_type' => 'location',
            'body' => $body,
            'status' => 'sent',
            'whatsapp_message_id' => $response->json('messages.0.id'),
        ]);

        $this->auditService->recordMessageAction(
            'location_sent',
            'Envio ubicacion manual',
            $chat,
            $actor,
            $message,
            [
                'meta' => [
                    'location' => $location,
                    'message_id' => $message->id,
                ],
            ],
        );

        $previewText = '[Ubicacion] ' . ($name !== '' ? $name : ($address !== '' ? $address : "{$location['latitude']}, {$location['longitude']}"));

        try {
            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_send_location_' . uniqid());
            $mqtt->connect();

            $mqtt->publish('sidebar/chat', json_encode([
                'chat_id' => $chat->id,
                'name' => $contact->name ?? 'Desconocido',
                'avatar' => $contact->profile_pic,
                'lastMessage' => $previewText,
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id' => $chat->id,
                'message_id' => $message->id,
                'sender' => $message->sender,
                'sender_subtype' => $message->sender_subtype,
                'operator_name' => $message->operator_name,
                'bot_node_type' => $message->bot_node_type,
                'interactive_options' => $message->interactive_options,
                'body' => $message->body,
                'message_type' => $message->message_type,
                'media_url' => null,
                'media_name' => null,
                'status' => $message->status,
                'timestamp' => $message->created_at?->toIso8601String(),
            ]), 0);

            $mqtt->disconnect();
        } catch (MqttClientException $e) {
            Log::error('MQTT Error (sendLocation): ' . $e->getMessage());
        }

        return response()->json(['ok' => true, 'message' => $message]);
    }

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
     * LÃƒÂ³gica del bot (mini "ÃƒÂ¡rbol" de estados) dentro del controlador.
     */


    /**
     * Enviar texto por WhatsApp, guardar mensaje y publicar por MQTT.
     * $sender = 'user' (desde tu sistema) o 'contact' si algÃƒÂºn dÃƒÂ­a hicieras eco, etc.
     */
    private function sendWhatsAppText(
        Chat $chat,
        string $messageBody,
        string $sender = 'user',
        string $senderSubtype = 'bot',
        ?string $botNodeType = null,
        ?array $interactiveOptions = null,
        ?string $operatorName = null
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
            'operator_name' => $senderSubtype === 'operator' ? $operatorName : null,
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
                'avatar' => $contact->profile_pic,
                'lastMessage' => $messageBody,
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            // ChatMain
            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id' => $chat->id,
                'message_id' => $message->id,
                'sender' => $message->sender,
                'sender_subtype' => $message->sender_subtype,
                'operator_name' => $message->operator_name,
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
                'avatar' => $contact->profile_pic,
                'lastMessage' => $body,
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id' => $chat->id,
                'message_id' => $message->id,
                'sender' => $message->sender,
                'sender_subtype' => $message->sender_subtype,
                'operator_name' => $message->operator_name,
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
                'avatar' => $contact->profile_pic,
                'lastMessage' => $body,
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id' => $chat->id,
                'message_id' => $message->id,
                'sender' => $message->sender,
                'sender_subtype' => $message->sender_subtype,
                'operator_name' => $message->operator_name,
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

        // Si el chat estÃƒÂ¡ en otro flow, lo sincronizamos al default
        if ((int) $chat->bot_flow_id !== (int) $flow->id) {
            $chat->bot_flow_id = $flow->id;
            $chat->bot_node_id = $flow->start_node_id; // resetea el puntero al inicio
            $chat->bot_state = [];                    // opcional: reset state
            $chat->bot_enabled = true;
            $chat->save();

            return $flow;
        }

        // Si ya estÃƒÂ¡ en el default, pero no tiene nodo, lo inicializamos
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
                    $state['pending_input']['last_error'] = $pending['error_message'] ?? 'ElegÃƒÂ­ una opciÃƒÂ³n vÃƒÂ¡lida.';
                    $this->setState($chat, $state);

                    return BotNode::find($pending['node_id']);
                }

                $value = $option['label'];
                $pending['selected_next_node_id'] = $option['next_node_id'] ?? null;
                if (is_array($option['vars'] ?? null)) {
                    $this->setVars($chat, $option['vars']);
                }
            }

            if ($value === '') {
                $state = $this->getState($chat);
                $state['pending_input']['last_error'] = $pending['error_message'] ?? 'Valor invÃƒÂ¡lido, intentÃƒÂ¡ de nuevo.';
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
                    $state['pending_input']['last_error'] = $pending['error_message'] ?? 'Valor invÃƒÂ¡lido, intentÃƒÂ¡ de nuevo.';
                    $this->setState($chat, $state);

                    return BotNode::find($pending['node_id']);
                }
            }

            // Ã¢Å“â€¦ guardar variable
            $varName = trim((string) ($pending['variable'] ?? ''));
            if ($varName !== '') {
                $this->setVar($chat, $varName, $value); // este ya guarda en DB
            }

            $nextId = $pending['selected_next_node_id'] ?? ($pending['next_node_id'] ?? null);

            // Ã¢Å“â€¦ SIEMPRE limpiamos pending_input
            $this->clearPendingInput($chat);

            // Ã¢Å“â€¦ CASO: finalizar flujo
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

        // Ã¢Å“â€¦ 1) Si el bot estÃƒÂ¡ apagado, no respondemos
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
            case 'appointment_lookup':
            case 'appointment_create':
            case 'appointment_cancel':
            case 'specialty_search':
            case 'doctor_select':
            case 'availability_select':
                // devolvemos el mismo nodo (para que el bot lo envÃƒÂ­e)
                // y sendBotNode va a setear pending_input
                return $currentNode;

                // 3) Texto plano
            case 'image':
            case 'document':
            case 'video':
            case 'audio':
            case 'location':
            case 'text':
                if (in_array(mb_strtolower($text), ['menÃƒÂº', 'menu'], true)) {
                    $menuNode = BotNode::where('flow_id', $currentNode->flow_id)
                        ->where('key', 'menu_principal')
                        ->first();

                    if ($menuNode) {
                        $chat->bot_node_id = $menuNode->id;
                        $chat->save();
                        return $menuNode;
                    }
                }

                // mover puntero al prÃƒÂ³ximo (sea handoff o lo que sea)
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
        Log::warning('sendBotNode trace', [
            'chat_id' => $chat->id,
            'node_id' => $node->id,
            'type' => $node->type,
            'next_node_id' => $node->next_node_id,
        ]);

        // handoff
        if ($node->type === 'handoff') {

            // enviar mensaje del handoff (si tiene)
            if ($node->body) {
                $body = $this->renderTemplate($node->body, $chat, $node);
                $this->sendWhatsAppText($chat, $body, 'user', 'bot', 'handoff');
            }

            // apagar bot
            $chat->bot_enabled = false;

            // por seguridad (por si venÃƒÂ­a de un input)
            $this->clearPendingInput($chat);

            // Ã¢Å“â€¦ preparar puntero para cuando se reactive
            $flow = $this->ensureChatUsesDefaultFlow($chat) ?? $this->getDefaultFlow();
            if ($flow && $flow->start_node_id) {
                $chat->bot_node_id = $flow->start_node_id;
            }

            // Ã¢Å“â€¦ marcar que estÃƒÂ¡/estuvo en handoff (para UI)
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

            // 1) Si ya habÃƒÂ­a pending_input, lo leemos para ver si hay error
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

            // 3) Asegurar que pending_input exista (si no existÃƒÂ­a)
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

        if ($node->type === 'contact') {
            $this->sendBotContactNode($chat, $node);
            return;
        }

        if ($node->type === 'location') {
            $this->sendBotLocationNode($chat, $node);
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

        if ($node->type === 'appointment_lookup') {
            $this->sendAppointmentLookupNode($chat, $node);
            return;
        }

        if ($node->type === 'appointment_create') {
            $this->sendAppointmentCreateNode($chat, $node);
            return;
        }

        if ($node->type === 'appointment_cancel') {
            $this->sendAppointmentCancelNode($chat, $node);
            return;
        }

        if (in_array($node->type, ['specialty_search', 'doctor_select', 'availability_select'], true)) {
            $this->sendAlephooSelectionNode($chat, $node);
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
            Log::warning('sendBotMediaNode: media source vacÃƒÂ­o', [
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
        $phoneId = $this->whatsappPhoneId();
        $url = 'https://graph.facebook.com/v22.0/' . $phoneId . '/messages';
        $phoneNumber = $this->formatPhoneNumber($contact->whatsapp_id);

        $mediaReference = null;
        if ($sourceKind === 'id') {
            $mediaReference = ['id' => $source];
        } else {
            $uploadedMediaId = $this->uploadLocalBotMediaToWhatsApp($source, $mediaType, $filename, $accessToken, $phoneId);
            if ($uploadedMediaId === false) {
                throw new \RuntimeException("Error subiendo media del nodo {$node->id} a WhatsApp");
            }

            $mediaReference = $uploadedMediaId
                ? ['id' => $uploadedMediaId]
                : ['link' => $this->absoluteMediaLink($source)];
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'to' => $phoneNumber,
            'type' => $mediaType,
        ];

        if ($mediaType === 'image') {
            $payload['image'] = $mediaReference;
            if ($caption !== '') {
                $payload['image']['caption'] = mb_substr($caption, 0, 1024);
            }
        } elseif ($mediaType === 'video') {
            $payload['video'] = $mediaReference;
            if ($caption !== '') {
                $payload['video']['caption'] = mb_substr($caption, 0, 1024);
            }
        } elseif ($mediaType === 'audio') {
            $payload['audio'] = $mediaReference;
        } else {
            $payload['document'] = $mediaReference;
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
            throw new \RuntimeException("Error enviando media del nodo {$node->id} a WhatsApp");
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

    private function sendBotContactNode(Chat $chat, BotNode $node): void
    {
        $contact = $chat->contact;
        if (!$contact || !$contact->whatsapp_id) {
            return;
        }

        $settings = $this->nodeSettings($node);
        $firstName = trim($this->renderTemplate((string) ($settings['first_name'] ?? ''), $chat, $node));
        $lastName = trim($this->renderTemplate((string) ($settings['last_name'] ?? ''), $chat, $node));
        $formattedName = trim($this->renderTemplate((string) ($settings['formatted_name'] ?? ''), $chat, $node));
        $phone = preg_replace('/[^\d+]/', '', $this->renderTemplate((string) ($settings['phone'] ?? ''), $chat, $node));
        $organization = trim($this->renderTemplate((string) ($settings['organization'] ?? ''), $chat, $node));
        $title = trim($this->renderTemplate((string) ($settings['title'] ?? ''), $chat, $node));

        if ($formattedName === '') {
            $formattedName = trim($firstName . ' ' . $lastName);
        }

        if ($firstName === '') {
            $firstName = $formattedName !== '' ? $formattedName : 'Contacto';
        }

        if ($formattedName === '' || $phone === '') {
            Log::warning('sendBotContactNode: contacto incompleto', [
                'chat_id' => $chat->id,
                'node_id' => $node->id,
                'formatted_name' => $formattedName,
                'phone' => $phone,
            ]);
            return;
        }

        $contactPayload = [
            'name' => array_filter([
                'formatted_name' => mb_substr($formattedName, 0, 160),
                'first_name' => mb_substr($firstName, 0, 80),
                'last_name' => $lastName !== '' ? mb_substr($lastName, 0, 80) : null,
            ], fn ($value) => $value !== null && $value !== ''),
            'phones' => [
                array_filter([
                    'phone' => mb_substr($phone, 0, 32),
                    'wa_id' => preg_replace('/\D+/', '', $phone),
                    'type' => 'CELL',
                ], fn ($value) => $value !== null && $value !== ''),
            ],
        ];

        if ($organization !== '' || $title !== '') {
            $contactPayload['org'] = array_filter([
                'company' => $organization !== '' ? mb_substr($organization, 0, 120) : null,
                'title' => $title !== '' ? mb_substr($title, 0, 120) : null,
            ], fn ($value) => $value !== null && $value !== '');
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'to' => $this->formatPhoneNumber($contact->whatsapp_id),
            'type' => 'contacts',
            'contacts' => [$contactPayload],
        ];

        $url = 'https://graph.facebook.com/v22.0/' . $this->whatsappPhoneId() . '/messages';
        $response = Http::withToken($this->whatsappAccessToken())->post($url, $payload);

        if ($response->failed()) {
            Log::error('API Error (sendBotContactNode): ' . $response->body(), [
                'chat_id' => $chat->id,
                'node_id' => $node->id,
                'payload' => $payload,
            ]);
            throw new \RuntimeException("Error enviando contacto del nodo {$node->id} a WhatsApp");
        }

        $waMessageId = $response->json('messages.0.id');
        $body = json_encode([
            'contacts' => [$contactPayload],
            'display_name' => $formattedName,
            'phone' => $phone,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $message = Message::create([
            'chat_id' => $chat->id,
            'sender' => 'user',
            'sender_subtype' => 'bot',
            'bot_node_type' => 'contact',
            'interactive_options' => [],
            'message_type' => 'contacts',
            'body' => $body,
            'status' => 'sent',
            'whatsapp_message_id' => $waMessageId,
        ]);

        try {
            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_send_contact_bot_' . uniqid());
            $mqtt->connect();

            $mqtt->publish('sidebar/chat', json_encode([
                'chat_id' => $chat->id,
                'name' => $contact->name ?? 'Desconocido',
                'avatar' => $contact->profile_pic,
                'lastMessage' => $body,
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id' => $chat->id,
                'message_id' => $message->id,
                'sender' => $message->sender,
                'sender_subtype' => $message->sender_subtype,
                'operator_name' => $message->operator_name,
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
            Log::error('MQTT Error (sendBotContactNode): ' . $e->getMessage());
        }
    }

    private function sendBotLocationNode(Chat $chat, BotNode $node): void
    {
        $contact = $chat->contact;
        if (!$contact || !$contact->whatsapp_id) {
            return;
        }

        $settings = $this->nodeSettings($node);
        $latitudeRaw = trim($this->renderTemplate((string) ($settings['latitude'] ?? ''), $chat, $node));
        $longitudeRaw = trim($this->renderTemplate((string) ($settings['longitude'] ?? ''), $chat, $node));
        $latitudeNormalized = str_replace(',', '.', $latitudeRaw);
        $longitudeNormalized = str_replace(',', '.', $longitudeRaw);
        $latitude = (float) $latitudeNormalized;
        $longitude = (float) $longitudeNormalized;
        $name = trim($this->renderTemplate((string) ($settings['name'] ?? ''), $chat, $node));
        $address = trim($this->renderTemplate((string) ($settings['address'] ?? ''), $chat, $node));

        if (
            $latitudeRaw === ''
            || $longitudeRaw === ''
            || !is_numeric($latitudeNormalized)
            || !is_numeric($longitudeNormalized)
            || $latitude < -90
            || $latitude > 90
            || $longitude < -180
            || $longitude > 180
        ) {
            Log::warning('sendBotLocationNode: ubicacion invalida', [
                'chat_id' => $chat->id,
                'node_id' => $node->id,
                'latitude' => $latitudeRaw,
                'longitude' => $longitudeRaw,
            ]);
            return;
        }

        $locationPayload = [
            'latitude' => $latitude,
            'longitude' => $longitude,
        ];

        if ($name !== '') {
            $locationPayload['name'] = mb_substr($name, 0, 1000);
        }
        if ($address !== '') {
            $locationPayload['address'] = mb_substr($address, 0, 1000);
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'recipient_type' => 'individual',
            'to' => $this->formatPhoneNumber($contact->whatsapp_id),
            'type' => 'location',
            'location' => $locationPayload,
        ];

        $url = 'https://graph.facebook.com/v22.0/' . $this->whatsappPhoneId() . '/messages';
        $response = Http::withToken($this->whatsappAccessToken())->post($url, $payload);

        if ($response->failed()) {
            Log::error('API Error (sendBotLocationNode): ' . $response->body(), [
                'chat_id' => $chat->id,
                'node_id' => $node->id,
                'payload' => $payload,
            ]);
            throw new \RuntimeException("Error enviando ubicacion del nodo {$node->id} a WhatsApp");
        }

        $body = json_encode($locationPayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $message = Message::create([
            'chat_id' => $chat->id,
            'sender' => 'user',
            'sender_subtype' => 'bot',
            'bot_node_type' => 'location',
            'interactive_options' => [],
            'message_type' => 'location',
            'body' => $body,
            'status' => 'sent',
            'whatsapp_message_id' => $response->json('messages.0.id'),
        ]);

        $previewText = '[Ubicacion] ' . ($name !== '' ? $name : ($address !== '' ? $address : "{$latitude}, {$longitude}"));

        try {
            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_send_location_bot_' . uniqid());
            $mqtt->connect();

            $mqtt->publish('sidebar/chat', json_encode([
                'chat_id' => $chat->id,
                'name' => $contact->name ?? 'Desconocido',
                'avatar' => $contact->profile_pic,
                'lastMessage' => $previewText,
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->publish("chat/{$chat->id}", json_encode([
                'chat_id' => $chat->id,
                'message_id' => $message->id,
                'sender' => $message->sender,
                'sender_subtype' => $message->sender_subtype,
                'operator_name' => $message->operator_name,
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
            Log::error('MQTT Error (sendBotLocationNode): ' . $e->getMessage());
        }
    }

    private function absoluteMediaLink(string $source): string
    {
        if (str_starts_with($source, 'http://') || str_starts_with($source, 'https://')) {
            return $source;
        }

        return url('/' . ltrim($source, '/'));
    }

    private function uploadLocalBotMediaToWhatsApp(string $source, string $mediaType, string $filename, string $accessToken, string $phoneId): string|false|null
    {
        $localPath = $this->localPublicStoragePathFromSource($source);
        if (!$localPath) {
            return null;
        }

        $uploadName = $filename !== '' ? $filename : basename($localPath);
        $mime = (string) (mime_content_type($localPath) ?: '');
        $uploadMime = $this->normalizeWhatsAppUploadMime($mime, $mediaType);
        $sniff = $this->sniffAudioContainer($localPath);

        Log::warning('sendBotMediaNode debug', [
            'source' => $source,
            'path' => $localPath,
            'upload_name' => $uploadName,
            'messageType' => $mediaType,
            'mime' => $mime,
            'uploadMime' => $uploadMime,
            'size' => filesize($localPath) ?: null,
            'sniff' => $sniff,
        ]);

        $fileSize = (int) (filesize($localPath) ?: 0);
        $maxSize = $this->maxWhatsAppMediaBytes($mediaType);
        if ($maxSize > 0 && $fileSize > $maxSize) {
            Log::error('sendBotMediaNode: archivo supera limite de WhatsApp', [
                'source' => $source,
                'path' => $localPath,
                'type' => $mediaType,
                'size' => $fileSize,
                'max_size' => $maxSize,
            ]);
            return false;
        }

        if ($mediaType === 'audio') {
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
                Log::error('sendBotMediaNode: audio no soportado para WhatsApp', [
                    'source' => $source,
                    'mime' => $mime,
                    'upload_mime' => $uploadMime,
                    'sniff' => $sniff,
                ]);
                return false;
            }

            if ($uploadMime === 'audio/mp4' && $sniff !== 'mp4') {
                Log::error('sendBotMediaNode: el audio no parece MP4/M4A vÃƒÂ¡lido', [
                    'source' => $source,
                    'mime' => $mime,
                    'upload_mime' => $uploadMime,
                    'sniff' => $sniff,
                ]);
                return false;
            }
            if ($uploadMime === 'audio/mpeg' && $sniff !== 'mp3') {
                Log::error('sendBotMediaNode: el audio no parece MP3 vÃƒÂ¡lido', [
                    'source' => $source,
                    'mime' => $mime,
                    'upload_mime' => $uploadMime,
                    'sniff' => $sniff,
                ]);
                return false;
            }
            if (str_starts_with($uploadMime, 'audio/ogg') && $sniff !== 'ogg') {
                Log::error('sendBotMediaNode: el audio no parece OGG vÃƒÂ¡lido', [
                    'source' => $source,
                    'mime' => $mime,
                    'upload_mime' => $uploadMime,
                    'sniff' => $sniff,
                ]);
                return false;
            }
        }

        $handle = fopen($localPath, 'r');
        if (!$handle) {
            Log::error('sendBotMediaNode: no se pudo abrir archivo local', [
                'source' => $source,
                'path' => $localPath,
            ]);
            return false;
        }

        try {
            $mediaUploadUrl = "https://graph.facebook.com/v22.0/{$phoneId}/media";
            $uploadResponse = Http::withToken($accessToken)
                ->attach('file', $handle, $uploadName, ['Content-Type' => $uploadMime])
                ->post($mediaUploadUrl, [
                    'messaging_product' => 'whatsapp',
                ]);
        } finally {
            fclose($handle);
        }

        if ($uploadResponse->failed()) {
            Log::error('API Error (sendBotMediaNode upload): ' . $uploadResponse->body(), [
                'source' => $source,
                'path' => $localPath,
                'type' => $mediaType,
                'mime' => $mime,
                'upload_mime' => $uploadMime,
            ]);
            return false;
        }

        $mediaId = $uploadResponse->json('id');
        if (!$mediaId) {
            Log::error('sendBotMediaNode upload: Meta no devolviÃƒÂ³ media_id', [
                'source' => $source,
                'path' => $localPath,
                'type' => $mediaType,
            ]);
            return false;
        }

        return (string) $mediaId;
    }

    private function maxWhatsAppMediaBytes(string $mediaType): int
    {
        return match ($mediaType) {
            'image' => 5 * 1024 * 1024,
            'video', 'audio' => 16 * 1024 * 1024,
            'document' => 100 * 1024 * 1024,
            default => 0,
        };
    }

    private function localPublicStoragePathFromSource(string $source): ?string
    {
        $path = parse_url($source, PHP_URL_PATH) ?: $source;
        $storageMarker = '/storage/';
        $storagePosition = strpos($path, $storageMarker);

        if ($storagePosition === false) {
            if (str_starts_with($path, 'storage/')) {
                $relativePath = substr($path, strlen('storage/'));
            } else {
                return null;
            }
        } else {
            $relativePath = substr($path, $storagePosition + strlen($storageMarker));
        }

        $relativePath = ltrim($relativePath, '/');
        if ($relativePath === '' || !Storage::disk('public')->exists($relativePath)) {
            return null;
        }

        return Storage::disk('public')->path($relativePath);
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
        $appointmentsToSend = [];


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

    private function sendAppointmentLookupNode(Chat $chat, BotNode $node): void
    {
        $settings = $this->nodeSettings($node);
        $vars = $this->getVars($chat);
        $personVariable = trim((string) ($settings['person_variable'] ?? 'persona_id'));
        $personId = preg_replace('/\D+/u', '', (string) ($vars[$personVariable] ?? ''));
        $baseVars = $this->emptyAppointmentVars();
        $targetNextNodeId = null;
        $messageToSend = null;

        if ($personId === '') {
            $this->setVars($chat, array_merge($baseVars, ['turnos_lookup_status' => 'missing_person']));
            $messageToSend = (string) ($settings['error_message'] ?? 'No pudimos consultar tus turnos porque falta identificar a la persona.');
            $targetNextNodeId = $settings['error_next_node_id'] ?? null;
        } elseif (!$this->isAlephooEndpointEnabled('/admision/turnos')) {
            $this->setVars($chat, array_merge($baseVars, ['turnos_lookup_status' => 'endpoint_disabled']));
            $messageToSend = (string) ($settings['error_message'] ?? 'La consulta de turnos no esta habilitada en este momento.');
            $targetNextNodeId = $settings['error_next_node_id'] ?? null;
        } else {
            $baseUrl = rtrim((string) config('services.alephoo_v3.base_url'), '/');
            $username = (string) config('services.alephoo_v3.username');
            $password = (string) config('services.alephoo_v3.password');
            $timeout = max(1, min(300, (int) config('services.alephoo_v3.timeout', 30)));

            if ($baseUrl === '' || $username === '' || $password === '') {
                $this->setVars($chat, array_merge($baseVars, ['turnos_lookup_status' => 'misconfigured']));
                $messageToSend = (string) ($settings['error_message'] ?? 'La integracion con Alephoo no esta configurada correctamente.');
                $targetNextNodeId = $settings['error_next_node_id'] ?? null;
            } else {
                try {
                    $timezone = new \DateTimeZone((string) config('services.alephoo_v3.timezone', 'America/Argentina/Buenos_Aires'));
                    $now = new \DateTimeImmutable('now', $timezone);
                    $query = [
                        'filter[persona]' => $personId,
                        'filter[incluirAdHoc]' => !empty($settings['include_ad_hoc']) ? 'true' : 'false',
                        'filter[nocancelado]' => 'true',
                        'offset' => 0,
                        // En Alephoo filter[fecha] es una igualdad, no un "desde".
                        // Traemos los más recientes y aplicamos el rango desde hoy localmente.
                        'sort' => '-fecha,-hora',
                        'limit' => max(1, min(50, (int) ($settings['limit'] ?? 50))),
                    ];

                    $specialty = $this->appointmentSpecialtyFilter($settings, $vars);
                    if ($specialty !== null) {
                        $query['filter[especialidades]'] = $specialty;
                    }

                    $response = Http::timeout($timeout)
                        ->accept('application/vnd.api+json')
                        ->withBasicAuth($username, $password)
                        ->get($baseUrl . '/admision/turnos', $query);

                    Log::info('Alephoo active appointments response', [
                        'chat_id' => $chat->id,
                        'node_id' => $node->id,
                        'person_id' => $personId,
                        'status' => $response->status(),
                        'ok' => $response->successful(),
                    ]);

                    if ($response->successful()) {
                        $appointments = $this->normalizeActiveAppointments(
                            is_array($response->json()) ? $response->json() : [],
                            $now,
                            !array_key_exists('exclude_elapsed_today', $settings) || !empty($settings['exclude_elapsed_today'])
                        );

                        if ($appointments !== []) {
                            $first = $appointments[0];
                            $this->setVars($chat, array_merge($baseVars, [
                                'turnos_encontrados' => true,
                                'turnos_lookup_status' => 'found',
                                'turnos_cantidad' => count($appointments),
                                'turnos' => $appointments,
                                'turno_id' => $first['id'],
                                'turno_fecha' => $first['fecha'],
                                'turno_hora' => $first['hora'],
                                'turno_estado_id' => $first['estado_id'],
                                'turno_estado' => $first['estado'],
                                'turno_agenda_id' => $first['agenda_id'],
                                'turno_especialidad_id' => $first['especialidad_id'],
                                'turno_especialidad' => $first['especialidad'],
                                'turno_profesional_id' => $first['profesional_id'],
                                'turno_profesional' => $first['profesional'],
                                'turno_plan_id' => $first['plan_id'],
                                'turno_sobreturno' => $first['sobreturno'],
                                'turno_observacion' => $first['observacion'],
                                'turno_arribo' => $first['arribo'],
                            ]));
                            $appointmentsToSend = $appointments;
                            $targetNextNodeId = $node->next_node_id;
                        } else {
                            $this->setVars($chat, array_merge($baseVars, ['turnos_lookup_status' => 'not_found']));
                            $messageToSend = (string) ($settings['not_found_message'] ?? 'No encontramos turnos pendientes próximos.');
                            $targetNextNodeId = $settings['not_found_next_node_id'] ?? null;
                        }
                    } else {
                        $this->setVars($chat, array_merge($baseVars, ['turnos_lookup_status' => 'error']));
                        $messageToSend = (string) ($settings['error_message'] ?? 'No pudimos consultar tus turnos en este momento.');
                        $targetNextNodeId = $settings['error_next_node_id'] ?? null;
                        Log::warning('Alephoo active appointments error response', [
                            'chat_id' => $chat->id,
                            'node_id' => $node->id,
                            'person_id' => $personId,
                            'status' => $response->status(),
                            'body' => $response->body(),
                        ]);
                    }
                } catch (\Throwable $e) {
                    $this->setVars($chat, array_merge($baseVars, ['turnos_lookup_status' => 'error']));
                    $messageToSend = (string) ($settings['error_message'] ?? 'No pudimos consultar tus turnos en este momento.');
                    $targetNextNodeId = $settings['error_next_node_id'] ?? null;
                    Log::error('Alephoo active appointments lookup failed: ' . $e->getMessage(), [
                        'chat_id' => $chat->id,
                        'node_id' => $node->id,
                        'person_id' => $personId,
                    ]);
                }
            }
        }

        if ($appointmentsToSend !== []) {
            $selectionMode = ($settings['result_mode'] ?? 'messages') === 'cancel_buttons';
            $pendingOptions = [];

            foreach ($appointmentsToSend as $appointment) {
                $appointmentVars = $this->appointmentTemplateVars($appointment);
                $this->setVars($chat, $appointmentVars);
                $renderedMessage = $this->renderTemplate(trim((string) $node->body), $chat, $node);

                if ($renderedMessage === '') {
                    continue;
                }

                if ($selectionMode) {
                    $replyId = 'cancel_appointment:' . (string) $appointment['id'];
                    $buttonTitle = trim((string) ($settings['cancel_button_text'] ?? 'Cancelar'));
                    $this->sendAppointmentCancelChoice(
                        $chat,
                        $node,
                        $renderedMessage,
                        $replyId,
                        $buttonTitle
                    );
                    $pendingOptions[] = [
                        'id' => $replyId,
                        'label' => $buttonTitle,
                        'next_node_id' => $node->next_node_id,
                        'vars' => $appointmentVars,
                    ];
                } else {
                    $this->sendWhatsAppText($chat, $renderedMessage, 'user', 'bot', 'appointment_lookup');
                }
            }

            // Las variables turno_* conservan el próximo turno para mantener compatibilidad.
            $this->setVars($chat, $this->appointmentTemplateVars($appointmentsToSend[0]));

            if ($selectionMode && $pendingOptions !== []) {
                $state = $this->getState($chat);
                $state['pending_input'] = [
                    'node_id' => $node->id,
                    'variable' => '',
                    'validation_regex' => '',
                    'error_message' => (string) ($settings['invalid_message'] ?? 'Selecciona el botón Cancelar del turno que quieras cancelar.'),
                    'next_node_id' => $node->next_node_id,
                    'response_mode' => 'buttons',
                    'options' => $pendingOptions,
                ];
                $this->setState($chat, $state);
                $chat->bot_node_id = $node->id;
                $chat->save();
                $node->setAttribute('runtime_waiting_input', true);
            }
        } elseif (trim((string) $messageToSend) !== '') {
            $renderedMessage = $this->renderTemplate(trim((string) $messageToSend), $chat, $node);
            if ($renderedMessage !== '') {
                $this->sendWhatsAppText($chat, $renderedMessage, 'user', 'bot', 'appointment_lookup');
            }
        }

        $node->next_node_id = $targetNextNodeId ? (int) $targetNextNodeId : null;
    }

    private function appointmentTemplateVars(array $appointment): array
    {
        return [
            'turno_id' => $appointment['id'] ?? null,
            'turno_fecha' => $appointment['fecha'] ?? null,
            'turno_hora' => $appointment['hora'] ?? null,
            'turno_estado_id' => $appointment['estado_id'] ?? null,
            'turno_estado' => $appointment['estado'] ?? null,
            'turno_agenda_id' => $appointment['agenda_id'] ?? null,
            'turno_especialidad_id' => $appointment['especialidad_id'] ?? null,
            'turno_especialidad' => $appointment['especialidad'] ?? null,
            'turno_profesional_id' => $appointment['profesional_id'] ?? null,
            'turno_profesional' => $appointment['profesional'] ?? null,
            'turno_plan_id' => $appointment['plan_id'] ?? null,
            'turno_sobreturno' => $appointment['sobreturno'] ?? false,
            'turno_observacion' => $appointment['observacion'] ?? null,
            'turno_arribo' => $appointment['arribo'] ?? null,
        ];
    }

    private function sendAppointmentCancelChoice(
        Chat $chat,
        BotNode $node,
        string $body,
        string $replyId,
        string $buttonTitle
    ): void {
        $contact = $chat->contact;
        if (!$contact || !$contact->whatsapp_id) {
            return;
        }

        $body = mb_substr(trim((string) preg_replace('/\s+/u', ' ', $body)), 0, 1024);
        $buttonTitle = mb_substr($buttonTitle !== '' ? $buttonTitle : 'Cancelar', 0, 20);
        $payload = [
            'messaging_product' => 'whatsapp',
            'to' => $this->formatPhoneNumber($contact->whatsapp_id),
            'type' => 'interactive',
            'interactive' => [
                'type' => 'button',
                'body' => ['text' => $body],
                'action' => ['buttons' => [[
                    'type' => 'reply',
                    'reply' => ['id' => $replyId, 'title' => $buttonTitle],
                ]]],
            ],
        ];

        $response = Http::withToken($this->whatsappAccessToken())
            ->post('https://graph.facebook.com/v22.0/' . $this->whatsappPhoneId() . '/messages', $payload);

        if ($response->failed()) {
            Log::error('API Error (sendAppointmentCancelChoice): ' . $response->body(), [
                'chat_id' => $chat->id,
                'node_id' => $node->id,
                'reply_id' => $replyId,
            ]);
            return;
        }

        $this->persistAndPublishOutgoing($chat, $body, $response->json('messages.0.id'), 'appointment_lookup', [[
            'id' => $replyId,
            'label' => $buttonTitle,
            'kind' => 'button',
        ]]);
    }

    private function sendAlephooSelectionNode(Chat $chat, BotNode $node): void
    {
        $settings = $this->nodeSettings($node);
        $vars = $this->getVars($chat);
        $baseUrl = $this->alephooApiRootUrl();
        $apiKey = $this->alephooApiKey();
        $rows = [];
        $failed = false;

        try {
            if ($baseUrl === '' || $apiKey === '') {
                throw new \RuntimeException('La integracion con Alephoo no esta configurada.');
            }

            $client = Http::timeout($this->alephooTimeout())
                ->acceptJson()
                ->withHeaders(['X-API-KEY' => $apiKey]);

            if ($node->type === 'specialty_search') {
                if (!$this->isAlephooEndpointEnabled('/especialidades')) {
                    throw new \RuntimeException('El endpoint de especialidades no esta habilitado.');
                }
                $queryVariable = trim((string) ($settings['query_variable'] ?? 'especialidad_busqueda'));
                $query = trim((string) ($vars[$queryVariable] ?? ''));
                if ($query === '') {
                    throw new \RuntimeException('Falta el texto de busqueda de especialidad.');
                }
                $response = $client->get($baseUrl . '/especialidades');
                if (!$response->successful()) {
                    throw new \RuntimeException("Alephoo respondio {$response->status()} al consultar especialidades.");
                }
                $items = $response->successful() && is_array($response->json()) ? $response->json() : [];
                $needle = mb_strtolower(Str::ascii($query));
                $items = array_values(array_filter($items, fn($item) =>
                    is_array($item)
                    && str_contains(mb_strtolower(Str::ascii((string) ($item['nombre'] ?? ''))), $needle)
                ));
                usort($items, fn($a, $b) => strcasecmp((string) ($a['nombre'] ?? ''), (string) ($b['nombre'] ?? '')));
                foreach (array_slice($items, 0, 10) as $item) {
                    $id = (string) ($item['id'] ?? '');
                    $name = trim((string) ($item['nombre'] ?? ''));
                    if ($id !== '' && $name !== '') {
                        $rows[] = [
                            'id' => 'specialty:' . $id,
                            'title' => Str::limit($name, 24, ''),
                            'description' => '',
                            'vars' => ['especialidad_id' => $id, 'especialidad_nombre' => $name],
                        ];
                    }
                }
            } elseif ($node->type === 'doctor_select') {
                if (!$this->isAlephooEndpointEnabled('/profesionales/{especialidad}')) {
                    throw new \RuntimeException('El endpoint de profesionales no esta habilitado.');
                }
                $specialtyVariable = trim((string) ($settings['specialty_variable'] ?? 'especialidad_id'));
                $specialtyId = preg_replace('/\D+/u', '', (string) ($vars[$specialtyVariable] ?? ''));
                if ($specialtyId === '') {
                    throw new \RuntimeException('Falta el ID de especialidad.');
                }
                $response = $client->get($baseUrl . '/profesionales/' . $specialtyId);
                if (!$response->successful()) {
                    throw new \RuntimeException("Alephoo respondio {$response->status()} al consultar profesionales.");
                }
                $items = $response->successful() && is_array($response->json()) ? $response->json() : [];
                usort($items, fn($a, $b) => strcasecmp(
                    trim((string) ($a['apellidos'] ?? '') . ' ' . (string) ($a['nombres'] ?? '')),
                    trim((string) ($b['apellidos'] ?? '') . ' ' . (string) ($b['nombres'] ?? ''))
                ));
                foreach (array_slice($items, 0, 10) as $item) {
                    $id = (string) ($item['id'] ?? '');
                    $name = trim((string) ($item['nombres'] ?? '') . ' ' . (string) ($item['apellidos'] ?? ''));
                    if ($id !== '' && $name !== '') {
                        $rows[] = [
                            'id' => 'doctor:' . $id,
                            'title' => Str::limit($name, 24, ''),
                            'description' => '',
                            'vars' => [
                                'profesional_id' => $id,
                                'profesional_nombre' => $name,
                                'profesional_agenda_dias' => (int) ($item['agenda_days'] ?? $settings['days'] ?? 28),
                            ],
                        ];
                    }
                }
            } else {
                if (!$this->isAlephooEndpointEnabled('/turnos/{profesional}/{especialidad}/{dias}')) {
                    throw new \RuntimeException('El endpoint de turnos disponibles no esta habilitado.');
                }
                $specialtyId = preg_replace('/\D+/u', '', (string) ($vars[trim((string) ($settings['specialty_variable'] ?? 'especialidad_id'))] ?? ''));
                $doctorId = preg_replace('/\D+/u', '', (string) ($vars[trim((string) ($settings['doctor_variable'] ?? 'profesional_id'))] ?? ''));
                $daysValue = $vars[trim((string) ($settings['days_variable'] ?? 'profesional_agenda_dias'))] ?? ($settings['days'] ?? 28);
                $days = max(1, min(365, (int) $daysValue));
                if ($specialtyId === '' || $doctorId === '') {
                    throw new \RuntimeException('Falta especialidad o profesional.');
                }
                $response = $client->get($baseUrl . "/turnos/{$doctorId}/{$specialtyId}/{$days}");
                if (!$response->successful()) {
                    throw new \RuntimeException("Alephoo respondio {$response->status()} al consultar turnos.");
                }
                $items = $response->successful() && is_array($response->json()) ? $response->json() : [];
                usort($items, fn($a, $b) => strcmp(
                    (string) ($a['fecha'] ?? '') . ' ' . (string) ($a['hora'] ?? ''),
                    (string) ($b['fecha'] ?? '') . ' ' . (string) ($b['hora'] ?? '')
                ));
                foreach (array_slice($items, 0, 10) as $index => $item) {
                    $date = (string) ($item['fecha'] ?? '');
                    $time = (string) ($item['hora'] ?? '');
                    $agenda = (string) ($item['agenda'] ?? '');
                    if ($date !== '' && $time !== '' && $agenda !== '') {
                        $rows[] = [
                            'id' => 'slot:' . $index . ':' . $agenda,
                            'title' => Str::limit($date . ' ' . $time, 24, ''),
                            'description' => '',
                            'vars' => [
                                'turno_fecha' => $date,
                                'turno_hora' => $time,
                                'turno_agenda_id' => $agenda,
                                'turno_orden' => is_numeric($item['orden'] ?? null) ? (int) $item['orden'] : -1,
                            ],
                        ];
                    }
                }
            }
        } catch (\Throwable $e) {
            $failed = true;
            Log::error('Hospital API selection node failed: ' . $e->getMessage(), [
                'chat_id' => $chat->id,
                'node_id' => $node->id,
                'type' => $node->type,
            ]);
        }

        if ($rows === []) {
            $message = $failed
                ? (string) ($settings['error_message'] ?? 'No pudimos consultar Alephoo en este momento.')
                : (string) ($settings['empty_message'] ?? 'No encontramos opciones disponibles.');
            $this->sendWhatsAppText($chat, $this->renderTemplate($message, $chat, $node), 'user', 'bot', $node->type);
            $targetNextNodeId = $failed
                ? ($settings['error_next_node_id'] ?? null)
                : ($settings['empty_next_node_id'] ?? null);
            if ($targetNextNodeId) {
                $chat->bot_node_id = (int) $targetNextNodeId;
                $chat->save();
                $node->next_node_id = (int) $targetNextNodeId;
                $node->setAttribute('runtime_branch_resolved', true);
            }
            return;
        }

        $this->sendDynamicWhatsAppList($chat, $node, $rows);
        $state = $this->getState($chat);
        $state['pending_input'] = [
            'node_id' => $node->id,
            'variable' => '',
            'validation_regex' => '',
            'error_message' => (string) ($settings['invalid_message'] ?? 'Elegi una opcion de la lista.'),
            'next_node_id' => $node->next_node_id,
            'response_mode' => 'list',
            'options' => array_map(fn($row) => [
                'id' => $row['id'],
                'label' => $row['title'],
                'next_node_id' => $node->next_node_id,
                'vars' => $row['vars'],
            ], $rows),
        ];
        $this->setState($chat, $state);
        $chat->bot_node_id = $node->id;
        $chat->save();
    }

    private function sendDynamicWhatsAppList(Chat $chat, BotNode $node, array $rows): void
    {
        $contact = $chat->contact;
        if (!$contact || !$contact->whatsapp_id) {
            return;
        }
        $settings = $this->nodeSettings($node);
        $body = $this->renderTemplate((string) ($node->body ?: 'Selecciona una opcion.'), $chat, $node);
        $waRows = array_map(fn($row) => [
            'id' => (string) $row['id'],
            'title' => (string) $row['title'],
            'description' => $row['description'] !== '' ? (string) $row['description'] : null,
        ], array_slice($rows, 0, 10));
        $payload = [
            'messaging_product' => 'whatsapp',
            'to' => $this->formatPhoneNumber($contact->whatsapp_id),
            'type' => 'interactive',
            'interactive' => [
                'type' => 'list',
                'body' => ['text' => $body],
                'action' => [
                    'button' => Str::limit((string) ($settings['button_text'] ?? 'Ver opciones'), 20, ''),
                    'sections' => [[
                        'title' => Str::limit((string) ($settings['section_title'] ?? 'Opciones'), 24, ''),
                        'rows' => $waRows,
                    ]],
                ],
            ],
        ];
        $response = Http::withToken($this->whatsappAccessToken())
            ->post('https://graph.facebook.com/v22.0/' . $this->whatsappPhoneId() . '/messages', $payload);
        if ($response->failed()) {
            Log::error('API Error (sendDynamicWhatsAppList): ' . $response->body());
            return;
        }
        $interactiveOptions = array_map(fn($row) => [
            'id' => $row['id'],
            'label' => $row['title'],
            'description' => $row['description'] ?? '',
            'kind' => 'list',
        ], $waRows);
        $this->persistAndPublishOutgoing($chat, $body, $response->json('messages.0.id'), $node->type, $interactiveOptions);
    }

    private function sendAppointmentCreateNode(Chat $chat, BotNode $node): void
    {
        $settings = $this->nodeSettings($node);
        $vars = $this->getVars($chat);
        $value = fn(string $setting, string $default) => $vars[trim((string) ($settings[$setting] ?? $default))] ?? null;

        $personId = preg_replace('/\D+/u', '', (string) $value('person_variable', 'persona_id'));
        $specialtyId = preg_replace('/\D+/u', '', (string) $value('specialty_variable', 'especialidad_id'));
        $doctorId = preg_replace('/\D+/u', '', (string) $value('doctor_variable', 'profesional_id'));
        $agendaId = preg_replace('/\D+/u', '', (string) $value('agenda_variable', 'turno_agenda_id'));
        $date = trim((string) $value('date_variable', 'turno_fecha'));
        $time = trim((string) $value('time_variable', 'turno_hora'));
        $order = $value('order_variable', 'turno_orden');
        $updateInsurance = filter_var($value('update_insurance_variable', 'actualizar_obra_social') ?? false, FILTER_VALIDATE_BOOL);
        $insuranceId = $value('insurance_variable', 'persona_obra_social_id');
        $planId = $value('plan_variable', 'persona_plan_id');

        $resultVars = [
            'turno_creado' => false,
            'turno_create_status' => 'error',
            'turno_creado_id' => null,
            'turno_create_response' => null,
        ];
        $targetNextNodeId = $settings['error_next_node_id'] ?? null;
        $messageToSend = (string) ($settings['error_message'] ?? 'No pudimos confirmar el turno en este momento.');

        $validDate = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        $missingData = $personId === '' || $specialtyId === '' || $doctorId === '' || $agendaId === ''
            || !$validDate || $validDate->format('Y-m-d') !== $date || $time === '';

        if ($missingData) {
            $resultVars['turno_create_status'] = 'missing_data';
        } elseif (
            !$this->isAlephooEndpointEnabled('/turnos/{profesional}/{especialidad}/{dias}')
            || !$this->isAlephooEndpointEnabled('/crear/turno')
        ) {
            $resultVars['turno_create_status'] = 'endpoint_disabled';
        } else {
            $baseUrl = $this->alephooApiRootUrl();
            $apiKey = $this->alephooApiKey();

            if ($baseUrl === '' || $apiKey === '') {
                $resultVars['turno_create_status'] = 'misconfigured';
            } else {
                try {
                    $today = new \DateTimeImmutable('today', new \DateTimeZone('America/Argentina/Buenos_Aires'));
                    $days = max(1, min(365, (int) $today->diff($validDate)->format('%r%a') + 1));
                    $availability = Http::timeout($this->alephooTimeout())
                        ->acceptJson()
                        ->withHeaders(['X-API-KEY' => $apiKey])
                        ->get($baseUrl . "/turnos/{$doctorId}/{$specialtyId}/{$days}");

                    $slots = $availability->successful() && is_array($availability->json()) ? $availability->json() : [];
                    $stillAvailable = collect($slots)->contains(fn($slot) =>
                        is_array($slot)
                        && (string) ($slot['fecha'] ?? '') === $date
                        && (string) ($slot['hora'] ?? '') === $time
                        && (string) ($slot['agenda'] ?? '') === $agendaId
                    );

                    if (!$stillAvailable) {
                        $resultVars['turno_create_status'] = 'unavailable';
                        $targetNextNodeId = $settings['unavailable_next_node_id'] ?? null;
                        $messageToSend = (string) ($settings['unavailable_message'] ?? 'El turno seleccionado ya no esta disponible.');
                    } else {
                        $payload = [
                            'hora' => $time,
                            'fecha' => $date,
                            'orden' => is_numeric($order) ? (int) $order : -1,
                            'agenda_id' => (int) $agendaId,
                            'persona_id' => (int) $personId,
                            'especialidad_id' => (int) $specialtyId,
                            'actualizarObraSocial' => $updateInsurance,
                            'obraSocialId' => $insuranceId !== null && $insuranceId !== '' ? $insuranceId : null,
                            'planId' => $planId !== null && $planId !== '' ? $planId : null,
                        ];
                        $response = Http::timeout($this->alephooTimeout())
                            ->acceptJson()
                            ->withHeaders(['X-API-KEY' => $apiKey])
                            ->post($baseUrl . '/crear/turno', $payload);

                        if ($response->successful()) {
                            $json = is_array($response->json()) ? $response->json() : [];
                            $resultVars = array_merge($resultVars, [
                                'turno_creado' => true,
                                'turno_create_status' => 'created',
                                'turno_creado_id' => data_get($json, 'turno.data.id'),
                                'turno_create_response' => $json,
                            ]);
                            $targetNextNodeId = $node->next_node_id;
                            $messageToSend = (string) ($node->body ?? '');
                        } elseif (in_array($response->status(), [409, 422], true)) {
                            $resultVars['turno_create_status'] = 'unavailable';
                            $resultVars['turno_create_response'] = $response->json();
                            $targetNextNodeId = $settings['unavailable_next_node_id'] ?? null;
                            $messageToSend = (string) ($settings['unavailable_message'] ?? 'El turno seleccionado ya no esta disponible.');
                        } else {
                            $resultVars['turno_create_status'] = 'error';
                            Log::warning('Hospital API appointment create error response', [
                                'chat_id' => $chat->id,
                                'node_id' => $node->id,
                                'status' => $response->status(),
                                'body' => $response->body(),
                            ]);
                        }
                    }
                } catch (\Throwable $e) {
                    $resultVars['turno_create_status'] = 'error';
                    Log::error('Hospital API appointment create failed: ' . $e->getMessage(), [
                        'chat_id' => $chat->id,
                        'node_id' => $node->id,
                    ]);
                }
            }
        }

        $this->setVars($chat, $resultVars);
        if (trim($messageToSend) !== '') {
            $renderedMessage = $this->renderTemplate(trim($messageToSend), $chat, $node);
            if ($renderedMessage !== '') {
                $this->sendWhatsAppText($chat, $renderedMessage, 'user', 'bot', 'appointment_create');
            }
        }
        $node->next_node_id = $targetNextNodeId ? (int) $targetNextNodeId : null;
    }

    private function sendAppointmentCancelNode(Chat $chat, BotNode $node): void
    {
        $settings = $this->nodeSettings($node);
        $vars = $this->getVars($chat);
        $appointmentVariable = trim((string) ($settings['appointment_variable'] ?? 'turno_id'));
        $appointmentId = preg_replace('/\D+/u', '', (string) ($vars[$appointmentVariable] ?? ''));
        $knownAppointments = is_array($vars['turnos'] ?? null) ? $vars['turnos'] : [];
        $knownAppointmentIds = array_values(array_filter(array_map(
            fn($appointment) => is_array($appointment) ? (string) ($appointment['id'] ?? '') : '',
            $knownAppointments
        )));
        $resultVars = [
            'turno_cancelado' => false,
            'turno_cancel_status' => 'error',
            'turno_cancelado_id' => null,
            'turno_cancel_response' => null,
        ];
        $targetNextNodeId = $settings['error_next_node_id'] ?? null;
        $messageToSend = (string) ($settings['error_message'] ?? 'No pudimos cancelar el turno en este momento.');

        if ($appointmentId === '') {
            $resultVars['turno_cancel_status'] = 'missing_data';
        } elseif ($knownAppointmentIds === [] || !in_array((string) $appointmentId, $knownAppointmentIds, true)) {
            $resultVars['turno_cancel_status'] = 'invalid_appointment';
        } elseif (!$this->isAlephooEndpointEnabled('/cancelarTurnos/{turno}')) {
            $resultVars['turno_cancel_status'] = 'endpoint_disabled';
        } else {
            $key = base64_decode((string) config('services.alephoo_cancel.key'), true);
            $iv = base64_decode((string) config('services.alephoo_cancel.iv'), true);
            $baseUrl = $this->alephooApiRootUrl();
            $apiKey = $this->alephooApiKey();

            if ($key === false || $key === '' || $iv === false || strlen($iv) !== 16 || $baseUrl === '' || $apiKey === '') {
                $resultVars['turno_cancel_status'] = 'misconfigured';
            } else {
                try {
                    $encrypted = openssl_encrypt($appointmentId, 'AES-128-CBC', $key, OPENSSL_RAW_DATA, $iv);
                    if ($encrypted === false) {
                        throw new \RuntimeException('No se pudo cifrar el ID del turno.');
                    }
                    $encryptedId = rtrim(strtr(base64_encode($encrypted), '+/', '-_'), '=');
                    $response = Http::timeout($this->alephooTimeout())
                        ->acceptJson()
                        ->withHeaders(['X-API-KEY' => $apiKey])
                        ->put($baseUrl . '/cancelarTurnos/' . rawurlencode($encryptedId));

                    $resultVars['turno_cancel_response'] = $response->json() ?? $response->body();

                    if ($response->successful()) {
                        $resultVars['turno_cancelado'] = true;
                        $resultVars['turno_cancel_status'] = 'cancelled';
                        $resultVars['turno_cancelado_id'] = $appointmentId;
                        $messageToSend = $node->body ?: 'Tu turno fue cancelado correctamente.';
                        $targetNextNodeId = $node->next_node_id;
                    } elseif (in_array($response->status(), [404, 409, 410, 422], true)) {
                        $resultVars['turno_cancel_status'] = 'not_available';
                        $messageToSend = (string) ($settings['unavailable_message'] ?? 'El turno ya no esta disponible o fue cancelado anteriormente.');
                        $targetNextNodeId = $settings['unavailable_next_node_id'] ?? null;
                    } else {
                        $resultVars['turno_cancel_status'] = 'error';
                        Log::warning('Alephoo appointment cancellation error response', [
                            'chat_id' => $chat->id,
                            'node_id' => $node->id,
                            'appointment_id' => $appointmentId,
                            'status' => $response->status(),
                            'body' => $response->body(),
                        ]);
                    }
                } catch (\Throwable $e) {
                    $resultVars['turno_cancel_status'] = 'error';
                    Log::error('Alephoo appointment cancellation failed: ' . $e->getMessage(), [
                        'chat_id' => $chat->id,
                        'node_id' => $node->id,
                        'appointment_id' => $appointmentId,
                    ]);
                }
            }
        }

        $this->setVars($chat, $resultVars);
        if (trim($messageToSend) !== '') {
            $renderedMessage = $this->renderTemplate($messageToSend, $chat, $node);
            if ($renderedMessage !== '') {
                $this->sendWhatsAppText($chat, $renderedMessage, 'user', 'bot', 'appointment_cancel');
            }
        }

        $node->next_node_id = $targetNextNodeId ? (int) $targetNextNodeId : null;
    }

    private function appointmentSpecialtyFilter(array $settings, array $vars): ?string
    {
        $mode = (string) ($settings['specialty_mode'] ?? 'all');
        $value = $mode === 'variable'
            ? ($vars[trim((string) ($settings['specialty_variable'] ?? 'especialidad_id'))] ?? null)
            : ($mode === 'fixed' ? ($settings['specialty_id'] ?? null) : null);
        $normalized = preg_replace('/\D+/u', '', (string) $value);

        return $normalized !== '' ? $normalized : null;
    }

    private function emptyAppointmentVars(): array
    {
        return [
            'turnos_encontrados' => false,
            'turnos_lookup_status' => 'error',
            'turnos_cantidad' => 0,
            'turnos' => [],
            'turno_id' => null,
            'turno_fecha' => null,
            'turno_hora' => null,
            'turno_estado_id' => null,
            'turno_estado' => null,
            'turno_agenda_id' => null,
            'turno_especialidad_id' => null,
            'turno_especialidad' => null,
            'turno_profesional_id' => null,
            'turno_profesional' => null,
            'turno_plan_id' => null,
            'turno_sobreturno' => false,
            'turno_observacion' => null,
            'turno_arribo' => null,
        ];
    }

    private function normalizeActiveAppointments(array $payload, \DateTimeImmutable $now, bool $excludeElapsedToday): array
    {
        $included = [];
        foreach (($payload['included'] ?? []) as $resource) {
            if (is_array($resource) && isset($resource['type'], $resource['id'])) {
                $included[(string) $resource['type'] . ':' . (string) $resource['id']] = $resource;
            }
        }

        $appointments = [];
        foreach (($payload['data'] ?? []) as $resource) {
            if (!is_array($resource)) {
                continue;
            }
            $attributes = is_array($resource['attributes'] ?? null) ? $resource['attributes'] : [];
            $date = (string) ($attributes['fecha'] ?? '');
            $time = substr((string) ($attributes['hora'] ?? ''), 0, 5);
            $dateTime = \DateTimeImmutable::createFromFormat(
                '!Y-m-d H:i',
                $date . ' ' . $time,
                $now->getTimezone()
            );
            if (!$dateTime || $dateTime->format('Y-m-d') < $now->format('Y-m-d')) {
                continue;
            }
            if ($excludeElapsedToday && $dateTime < $now) {
                continue;
            }

            $relationships = is_array($resource['relationships'] ?? null) ? $resource['relationships'] : [];
            $stateRef = $relationships['estadoTurno']['data'] ?? null;
            $state = $this->includedResource($included, $stateRef);
            $stateAttributes = is_array($state['attributes'] ?? null) ? $state['attributes'] : [];
            $stateId = is_array($stateRef) ? ($stateRef['id'] ?? null) : null;
            $stateCode = mb_strtoupper(trim((string) ($stateAttributes['codigo'] ?? '')));
            $stateName = trim((string) ($stateAttributes['alias'] ?? $stateAttributes['nombre'] ?? ''));
            if ((string) $stateId !== '1' && $stateCode !== 'P' && mb_strtolower($stateName) !== 'pendiente') {
                continue;
            }

            $agendaRef = $relationships['agenda']['data'] ?? null;
            $agenda = $this->includedResource($included, $agendaRef);
            $agendaRelationships = is_array($agenda['relationships'] ?? null) ? $agenda['relationships'] : [];
            $specialtyRef = $agendaRelationships['especialidad']['data'] ?? null;
            $specialty = $this->includedResource($included, $specialtyRef);
            $professionalRef = $agendaRelationships['profesional']['data'] ?? null;
            $professional = $this->includedResource($included, $professionalRef);
            $professionalPersonRef = $professional['relationships']['persona']['data'] ?? null;
            $professionalPerson = $this->includedResource($included, $professionalPersonRef);
            $professionalAttributes = is_array($professionalPerson['attributes'] ?? null)
                ? $professionalPerson['attributes']
                : [];
            $planRef = $relationships['plan']['data'] ?? null;

            $appointments[] = [
                'id' => $resource['id'] ?? null,
                'fecha' => $date,
                'hora' => $time,
                'estado_id' => $stateId,
                'estado' => $stateName !== '' ? $stateName : 'Pendiente',
                'agenda_id' => is_array($agendaRef) ? ($agendaRef['id'] ?? null) : null,
                'especialidad_id' => is_array($specialtyRef) ? ($specialtyRef['id'] ?? null) : null,
                'especialidad' => $specialty['attributes']['nombre'] ?? null,
                'profesional_id' => is_array($professionalRef) ? ($professionalRef['id'] ?? null) : null,
                'profesional' => trim(implode(' ', array_filter([
                    $professionalAttributes['nombres'] ?? null,
                    $professionalAttributes['apellidos'] ?? null,
                ]))) ?: null,
                'plan_id' => is_array($planRef) ? ($planRef['id'] ?? null) : null,
                'sobreturno' => (bool) ($attributes['sobreturno'] ?? false),
                'observacion' => $attributes['observacion'] ?? null,
                'arribo' => $attributes['fechahoraArribo'] ?? null,
            ];
        }

        usort($appointments, fn(array $a, array $b) => strcmp($a['fecha'] . ' ' . $a['hora'], $b['fecha'] . ' ' . $b['hora']));

        return $appointments;
    }

    private function includedResource(array $included, mixed $reference): array
    {
        if (!is_array($reference) || !isset($reference['type'], $reference['id'])) {
            return [];
        }

        return $included[(string) $reference['type'] . ':' . (string) $reference['id']] ?? [];
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

        // Ã¢Å“â€¦ Render con variables
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

        // Ã¢Å“â€¦ persistimos el texto renderizado
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

    public function resetBotFlow(Request $request, Chat $chat)
    {
        $flow = $this->getDefaultFlow();

        if (!$flow || !$flow->start_node_id) {
            return response()->json([
                'ok' => false,
                'message' => 'No hay un flujo activo con nodo inicial configurado.',
            ], 422);
        }

        $before = [
            'bot_enabled' => (bool) $chat->bot_enabled,
            'bot_flow_id' => $chat->bot_flow_id,
            'bot_node_id' => $chat->bot_node_id,
            'bot_step' => $chat->bot_step,
            'bot_state' => $chat->bot_state,
        ];

        $chat->bot_flow_id = $flow->id;
        $chat->bot_node_id = $flow->start_node_id;
        $chat->bot_step = null;
        $chat->bot_state = [];
        $chat->bot_enabled = true;
        $chat->save();

        try {
            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_reset_bot_' . uniqid());
            $mqtt->connect();
            $mqtt->publish("status_bot/chat/" . $chat->id, json_encode([
                'chat_id' => $chat->id,
                'status' => 'enabled',
                'reset' => true,
            ]), 0);
            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::error('MQTT Error (resetBotFlow): ' . $e->getMessage());
        }

        $this->auditService->recordChatAction(
            'bot_flow_reset',
            'Reinicio el flujo del bot del chat',
            $chat,
            $request->user(),
            [
                'before' => $before,
                'after' => [
                    'bot_enabled' => true,
                    'bot_flow_id' => $flow->id,
                    'bot_node_id' => $flow->start_node_id,
                    'bot_step' => null,
                    'bot_state' => [],
                ],
            ],
        );

        return response()->json([
            'ok' => true,
            'chat' => $chat->fresh(),
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

        // Ã¢Å“â€¦ preservar variables ya capturadas
        $state = $this->getState($chat);
        $vars = is_array($state['vars'] ?? null) ? $state['vars'] : [];
        $varsByDate = is_array($state['vars_by_date'] ?? null) ? $state['vars_by_date'] : [];

        $chat->bot_flow_id = $flow->id;
        $chat->bot_node_id = $flow->start_node_id;

        // Ã¢Å“â€¦ limpiamos solo lo que rompe el prÃƒÂ³ximo ciclo
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

        // Ã¢Å“â€¦ text y person_lookup pueden ser terminales automÃƒÂ¡ticos
        if (in_array($sentNode->type, ['text', 'person_lookup', 'appointment_lookup', 'appointment_create', 'appointment_cancel', 'image', 'document', 'video', 'audio', 'location'], true) && empty($sentNode->next_node_id)) {
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
        if ($node->type === 'appointment_lookup' && $node->getAttribute('runtime_waiting_input')) {
            return false;
        }

        if (in_array($node->type, ['person_lookup', 'appointment_lookup', 'appointment_create', 'appointment_cancel'], true)) {
            return true;
        }

        if (in_array($node->type, ['specialty_search', 'doctor_select', 'availability_select'], true)) {
            return (bool) $node->getAttribute('runtime_branch_resolved');
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
        $chat->refresh();

        Log::warning('runAutoAdvance start', [
            'chat_id' => $chat->id,
            'just_sent_node_id' => $justSent->id,
            'type' => $justSent->type,
            'next_node_id' => $justSent->next_node_id,
            'bot_enabled' => $chat->bot_enabled,
            'should_auto_advance' => $this->shouldAutoAdvance($justSent),
        ]);

        if (!$chat->bot_enabled)
            return;

        // Solo si el nodo reciÃƒÂ©n enviado tiene next_node_id y auto_advance activo
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

            if ($chat->bot_enabled) {
                $chat->bot_node_id = $nextNode->next_node_id ?: $nextNode->id;
                $chat->save();
            }

            // Ã¢Å“â€¦ si el nodo apagÃƒÂ³ el bot (handoff), cortar acÃƒÂ¡
            if (!$chat->bot_enabled) {
                break;
            }

            // si el nodo enviado fue terminal, se resetea y se corta
            $this->maybeResetAfterSendingNode($chat, $flow, $nextNode);
            if ((int) $chat->bot_node_id === (int) $flow->start_node_id && empty($nextNode->next_node_id)) {
                break;
            }

            // Si el siguiente nodo tambiÃƒÂ©n tiene auto_advance, seguimos.
            // Si no, cortamos (la conversaciÃƒÂ³n queda esperando input).
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
            'error_message' => (string) ($settings['error_message'] ?? 'Valor invÃƒÂ¡lido, intentÃƒÂ¡ de nuevo.'),
            'next_node_id' => $node->next_node_id, // clave: a dÃƒÂ³nde avanzar cuando capture OK
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
                    'vars' => is_array($option['vars'] ?? null) ? $option['vars'] : [],
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
                    'vars' => is_array($option['vars'] ?? null) ? $option['vars'] : [],
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

            // default si vacÃƒÂ­o
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
        // (si querÃƒÂ©s, podÃƒÂ©s hacerlo mÃƒÂ¡s estricto)
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

    private function alephooApiRootUrl(): string
    {
        $baseUrl = $this->alephooBaseUrl();
        return str_ends_with($baseUrl, '/personas') ? substr($baseUrl, 0, -9) : $baseUrl;
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
