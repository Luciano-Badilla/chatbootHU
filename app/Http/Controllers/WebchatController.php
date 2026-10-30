<?php

namespace App\Http\Controllers;

use App\Models\BotFlow;
use App\Models\Chat;
use App\Models\Contact;
use App\Models\Message;
use App\Models\SystemSetting;
use App\Models\WebchatReferral;
use App\Models\WebPushSubscription;
use App\Services\WebchatAvailabilityService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Inertia\Inertia;
use PhpMqtt\Client\ConnectionSettings;
use PhpMqtt\Client\MqttClient;

class WebchatController extends Controller
{
    public function __construct(private readonly WebchatAvailabilityService $availabilityService)
    {
    }

    public function index()
    {
        $settings = $this->settings();
        $settings['available'] = $this->availabilityService->isBotAvailable($settings);
        $settings['operators_scheduled'] = $this->availabilityService->areOperatorsAvailable($settings);
        $settings['operators_available'] = $settings['operators_scheduled'] && $this->availabilityService->hasAvailableOperators();
        return Inertia::render('Webchat', ['webchat' => $settings]);
    }

    public function status()
    {
        $settings = $this->settings();
        $settings['available'] = $this->availabilityService->isBotAvailable($settings);
        $settings['operators_scheduled'] = $this->availabilityService->areOperatorsAvailable($settings);
        $settings['operators_available'] = $settings['operators_scheduled'] && $this->availabilityService->hasAvailableOperators();

        return response()->json(['webchat' => $settings]);
    }

    public function referralEntry(Request $request)
    {
        $data = $request->validate([
            'referral_token' => ['required', 'string', 'size:32', 'regex:/\A[A-Za-z0-9]+\z/'],
        ]);

        WebchatReferral::query()
            ->where('token', $data['referral_token'])
            ->whereNull('entered_at')
            ->update(['entered_at' => now()]);

        return response()->json(['ok' => true]);
    }

    public function presence(Request $request)
    {
        $data = $request->validate([
            'resume_token' => ['required', 'string', 'max:80'],
            'visible' => ['required', 'boolean'],
            'endpoint' => ['nullable', 'string', 'max:4096'],
        ]);
        $chat = $this->chatForToken($data['resume_token']);

        if (! $chat) {
            return response()->json(['message' => 'La conversación ya no está disponible.'], 404);
        }

        if ($data['visible']) {
            $chat->update(['webchat_last_seen_at' => now()]);

            if (! empty($data['endpoint'])) {
                WebPushSubscription::query()
                    ->where('chat_id', $chat->id)
                    ->whereNull('user_id')
                    ->where('endpoint_hash', hash('sha256', $data['endpoint']))
                    ->update(['updated_at' => now()]);
            }
        }

        return response()->json(['ok' => true]);
    }

    public function session(Request $request)
    {
        $token = (string) $request->input('resume_token', '');
        $chat = $this->chatForToken($token);

        if (! $chat) {
            return response()->json(['requires_profile' => true]);
        }

        $chat->update(['webchat_last_seen_at' => now()]);

        return response()->json([
            'requires_profile' => false,
            'resume_token' => $chat->webchat_token,
            'chat' => $this->payload($chat),
        ]);
    }

    public function markDelivered(Request $request)
    {
        return $this->updateOutgoingMessageStatus($request, ['sent'], 'delivered');
    }

    public function markRead(Request $request)
    {
        return $this->updateOutgoingMessageStatus($request, ['sent', 'delivered'], 'read');
    }

    public function start(Request $request)
    {
        $settings = $this->settings();
        if (! $this->availabilityService->isBotAvailable($settings)) {
            return response()->json(['message' => $settings['offline_message']], 423);
        }
        $data = $request->validate([
            'name' => ['required', 'string', 'max:200'],
        ]);

        $flow = $this->webchatFlow($settings);

        if (! $flow) {
            return response()->json([
                'message' => 'No hay un flujo activo habilitado para webchat.',
            ], 422);
        }

        $token = Str::random(64);
        $name = trim($data['name']);
        $contact = Contact::create([
            // La columna actual es obligatoria y única. Este valor nunca se muestra ni se usa como teléfono.
            'whatsapp_id' => 'webchat:'.$token,
            'name' => $name,
            'last_interaction_at' => now(),
        ]);
        $chat = Chat::create([
            'contact_id' => $contact->id,
            'channel' => 'webchat',
            'webchat_token' => $token,
            'webchat_last_seen_at' => now(),
            'bot_flow_id' => $flow->id,
            'bot_node_id' => $flow->start_node_id,
            'status' => 'open',
            'attention_status' => 'bot',
            'bot_enabled' => true,
            'bot_state' => [],
            'last_user_message_at' => now(),
        ]);
        app(WhatsAppController::class)->startWebchatConversation($chat, $flow);
        $chat->refresh();

        return response()->json([
            'resume_token' => $token,
            'chat' => $this->payload($chat),
        ], 201);
    }

    public function restart(Request $request)
    {
        $data = $request->validate([
            'resume_token' => ['required', 'string', 'max:80'],
            'force_restart' => ['sometimes', 'boolean'],
        ]);
        $chat = $this->requireChat($request, $data['resume_token']);

        $shouldRestart = (bool) ($data['force_restart'] ?? false)
            || $chat->status === 'closed'
            || ! $chat->bot_enabled;
        if ($shouldRestart) {
            $settings = $this->settings();
            $flow = $this->webchatFlow($settings);

            if (! $flow) {
                return response()->json(['message' => 'No hay un flujo activo habilitado para Webchat.'], 422);
            }

            $chat->update([
                'status' => 'open',
                'attention_status' => 'bot',
                'bot_enabled' => true,
                'operator_id' => null,
                'assigned_at' => null,
                'bot_flow_id' => $flow->id,
                'bot_node_id' => $flow->start_node_id,
                'bot_step' => null,
                'bot_state' => [],
                'closed_at' => null,
                'closed_by' => null,
                'closed_by_user_id' => null,
                'webchat_last_seen_at' => now(),
                'last_user_message_at' => now(),
                'last_operator_message_at' => null,
            ]);
            // No esperes a que termine todo el flujo inicial para responderle
            // al navegador: puede incluir consultas a Alephoo y demoras de nodos.
            app()->terminating(function () use ($chat, $flow) {
                $chat = $chat->fresh();
                // Las notificaciones MQTT y el arranque del flujo son tareas
                // secundarias; no deben mantener cargando el boton del paciente.
                $this->publishRestartedChatStatus($chat);

                try {
                    app(WhatsAppController::class)->startWebchatConversation($chat, $flow);
                } catch (\Throwable $e) {
                    Log::error('No se pudo iniciar el flujo del webchat reiniciado.', [
                        'chat_id' => $chat->id,
                        'flow_id' => $flow->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            });
        }

        $chat->refresh();

        return response()->json([
            'ok' => true,
            'restarted' => $shouldRestart,
            'chat' => $this->payload($chat),
        ]);
    }

    public function messages(Request $request)
    {
        $chat = $this->requireChat($request);

        return response()->json([
            'messages' => $chat->messages()->orderBy('id')->get(),
        ]);
    }

    public function send(Request $request)
    {
        $data = $request->validate([
            'resume_token' => ['required', 'string', 'max:80'],
            'message' => ['nullable', 'string', 'max:4000', 'required_without:option_id'],
            'option_id' => ['nullable', 'string', 'max:255'],
        ]);
        $chat = $this->requireChat($request, $data['resume_token']);
        $chat->update(['webchat_last_seen_at' => now(), 'last_user_message_at' => now()]);
        $chat->contact->update(['last_interaction_at' => now()]);

        $message = app(WhatsAppController::class)->processWebchatMessage(
            $chat,
            trim((string) ($data['message'] ?? '')),
            $data['option_id'] ?? null,
        );

        return response()->json(['ok' => true, 'message' => $message]);
    }

    public function sendMedia(Request $request)
    {
        $data = $request->validate([
            'resume_token' => ['required', 'string', 'max:80'],
            'file' => ['required', 'file'],
            'media_kind' => ['required', 'in:image,video,audio,document'],
            'caption' => ['nullable', 'string', 'max:4000'],
        ]);
        $fileRules = match ($data['media_kind']) {
            'image' => ['image', 'mimes:jpg,jpeg,png,webp,gif', 'max:10240'],
            'video' => ['mimes:mp4,mov,webm', 'max:51200'],
            'audio' => ['mimes:ogg,mp3,m4a,wav,webm', 'max:16384'],
            default => ['mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt', 'max:25600'],
        };
        $validator = Validator::make(['file' => $request->file('file')], ['file' => $fileRules]);
        if ($validator->fails()) {
            $limits = ['image' => '10 MB', 'video' => '50 MB', 'audio' => '16 MB', 'document' => '25 MB'];
            return response()->json([
                'message' => "El archivo no se puede enviar. Verificá el formato y que no supere {$limits[$data['media_kind']]}.",
                'errors' => $validator->errors(),
            ], 422);
        }
        $chat = $this->requireChat($request, $data['resume_token']);
        $this->touchWebchat($chat);
        $file = $request->file('file');
        $path = $file->store("webchat/{$chat->id}", 'public');

        $message = app(WhatsAppController::class)->processWebchatMessage(
            $chat,
            trim((string) ($data['caption'] ?? '')),
            null,
            $data['media_kind'],
            '/storage/'.$path,
            $file->getClientOriginalName(),
        );

        return response()->json(['ok' => true, 'message' => $message]);
    }

    public function sendContact(Request $request)
    {
        $data = $request->validate([
            'resume_token' => ['required', 'string', 'max:80'],
            'name' => ['required', 'string', 'max:160'],
            'phone' => ['required', 'string', 'max:32'],
            'organization' => ['nullable', 'string', 'max:120'],
            'title' => ['nullable', 'string', 'max:120'],
        ]);
        $chat = $this->requireChat($request, $data['resume_token']);
        $this->touchWebchat($chat);
        $body = json_encode([
            'display_name' => $data['name'],
            'phone' => $data['phone'],
            'organization' => $data['organization'] ?? '',
            'title' => $data['title'] ?? '',
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $message = app(WhatsAppController::class)->processWebchatMessage($chat, $body, null, 'contacts');
        return response()->json(['ok' => true, 'message' => $message]);
    }

    public function sendLocation(Request $request)
    {
        $data = $request->validate([
            'resume_token' => ['required', 'string', 'max:80'],
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            'name' => ['nullable', 'string', 'max:1000'],
            'address' => ['nullable', 'string', 'max:1000'],
        ]);
        $chat = $this->requireChat($request, $data['resume_token']);
        $this->touchWebchat($chat);
        $body = json_encode([
            'latitude' => (float) $data['latitude'],
            'longitude' => (float) $data['longitude'],
            'name' => trim((string) ($data['name'] ?? '')),
            'address' => trim((string) ($data['address'] ?? '')),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $message = app(WhatsAppController::class)->processWebchatMessage($chat, $body, null, 'location');
        return response()->json(['ok' => true, 'message' => $message]);
    }

    private function touchWebchat(Chat $chat): void
    {
        $chat->update(['webchat_last_seen_at' => now(), 'last_user_message_at' => now()]);
        $chat->contact?->update(['last_interaction_at' => now()]);
    }

    private function updateOutgoingMessageStatus(Request $request, array $fromStatuses, string $status)
    {
        $data = $request->validate([
            'resume_token' => ['required', 'string', 'max:80'],
            'message_ids' => ['required', 'array', 'min:1', 'max:100'],
            'message_ids.*' => ['integer'],
        ]);
        $chat = $this->requireChat($request, $data['resume_token']);
        $messages = Message::query()
            ->where('chat_id', $chat->id)
            ->where('sender', 'user')
            ->whereIn('id', $data['message_ids'])
            ->whereIn('status', $fromStatuses)
            ->get();

        foreach ($messages as $message) {
            $message->update(['status' => $status]);
            app(WhatsAppController::class)->publishMessageStatus($message, $status);
        }

        return response()->json(['ok' => true, 'updated' => $messages->count()]);
    }

    private function requireChat(Request $request, ?string $token = null): Chat
    {
        $chat = $this->chatForToken($token ?? (string) $request->input('resume_token', ''));
        abort_unless($chat, 404);

        return $chat;
    }

    private function chatForToken(string $token): ?Chat
    {
        return $token === '' ? null : Chat::with('contact')->where('channel', 'webchat')->where('webchat_token', $token)->first();
    }

    private function payload(Chat $chat): array
    {
        $chat->loadMissing(['operator', 'lastOperator']);

        return [
            'id' => $chat->id,
            'name' => $chat->contact?->name,
            'status' => $chat->status,
            'attention_status' => $chat->attention_status,
            'closed_by' => $chat->closed_by,
            'closed_by_name' => $chat->closed_by === 'operator' ? $chat->lastOperator?->name : null,
            'bot_enabled' => (bool) $chat->bot_enabled,
            'operator_name' => $chat->operator?->name,
            'messages' => $chat->messages()->orderBy('id')->get(),
        ];
    }

    private function publishRestartedChatStatus(Chat $chat): void
    {
        $host = env('MQTT_HOST') ?: env('VITE_MOSQUITTO_HOST');
        if (! $host) {
            Log::warning('MQTT host not configured for webchat restart status.', ['chat_id' => $chat->id]);

            return;
        }

        try {
            $mqtt = new MqttClient((string) $host, 1883, 'laravel_webchat_restart_'.uniqid());
            $settings = (new ConnectionSettings())
                ->setConnectTimeout(2)
                ->setSocketTimeout(2);
            $mqtt->connect($settings);

            $mqtt->publish("status_bot/chat/{$chat->id}", json_encode([
                'chat_id' => $chat->id,
                'status' => $chat->bot_enabled ? 'enabled' : 'disabled',
            ]), 0);
            $mqtt->publish("operator/chat/{$chat->id}", json_encode([
                'chat_id' => (int) $chat->id,
                'active' => false,
                'operator_id' => null,
                'operator_name' => null,
                'status' => $chat->status,
                'attention_status' => $chat->attention_status,
                'bot_enabled' => (bool) $chat->bot_enabled,
                'assigned_at' => null,
                'closed_at' => null,
                'closed_by' => null,
                'bot_flow_id' => $chat->bot_flow_id ? (int) $chat->bot_flow_id : null,
                'bot_node_id' => $chat->bot_node_id ? (int) $chat->bot_node_id : null,
                'bot_step' => $chat->bot_step,
                'bot_state' => $chat->bot_state,
            ]), 0);
            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::warning('MQTT Error (webchat restart status): '.$e->getMessage(), [
                'chat_id' => $chat->id,
            ]);
        }
    }

    private function settings(): array
    {
        $stored = SystemSetting::query()->where('key', 'like', 'webchat.%')->pluck('value', 'key');
        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        $flowSchedule = json_decode((string) ($stored['webchat.flow_schedule'] ?? ''), true);
        if (!is_array($flowSchedule)) {
            $legacyFlowId = !empty($stored['webchat.default_flow_id']) ? (int) $stored['webchat.default_flow_id'] : null;
            $flowSchedule = array_fill_keys($days, $legacyFlowId);
        } else {
            $flowSchedule = array_replace(array_fill_keys($days, null), array_intersect_key($flowSchedule, array_flip($days)));
        }

        return [
            'enabled' => ($stored['webchat.enabled'] ?? '1') === '1', 'availability_mode' => $stored['webchat.availability_mode'] ?? 'always',
            'schedule_start' => $stored['webchat.schedule_start'] ?? '08:00', 'schedule_end' => $stored['webchat.schedule_end'] ?? '20:00',
            'bot_available_outside_schedule' => ($stored['webchat.bot_available_outside_schedule'] ?? '0') === '1',
            'outside_schedule_flow_id' => filled($stored['webchat.outside_schedule_flow_id'] ?? null) ? (int) $stored['webchat.outside_schedule_flow_id'] : null,
            'offline_message' => $stored['webchat.offline_message'] ?? 'En este momento no estamos disponibles. Volvé a intentarlo dentro del horario de atención.',
            'title' => $stored['webchat.title'] ?? 'Asistente virtual', 'subtitle' => $stored['webchat.subtitle'] ?? 'Hospital Universitario',
            'logo_url' => $stored['webchat.logo_url'] ?? '',
            'flow_schedule' => $flowSchedule,
        ];
    }

    private function webchatFlow(array $settings): ?BotFlow
    {
        $flows = BotFlow::query()
            ->where('is_active', true)
            ->whereJsonContains('channels', 'webchat')
            ->orderByDesc('is_default')
            ->orderBy('id');

        $timezone = SystemSetting::query()->where('key', 'general.timezone')->value('value') ?: config('app.timezone');
        $day = strtolower(now($timezone)->format('l'));
        $outsideScheduleFlowId = ($settings['availability_mode'] ?? 'always') === 'schedule'
            && ! $this->availabilityService->isWithinSchedule($settings)
                ? ($settings['outside_schedule_flow_id'] ?? null)
                : null;
        $flowId = $outsideScheduleFlowId ?: ($settings['flow_schedule'][$day] ?? null);

        return $flowId
            ? (clone $flows)->whereKey($flowId)->first() ?? $flows->first()
            : $flows->first();
    }

}
