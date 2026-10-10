<?php

namespace App\Services;

use App\Models\BotFlow;
use App\Models\Chat;
use App\Models\Message;
use App\Models\SystemSetting;
use Carbon\Carbon;
use Illuminate\Support\Env;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use PhpMqtt\Client\ConnectionSettings;
use PhpMqtt\Client\MqttClient;

class BotInactivityService
{
    private ?array $runtimeSettingsCache = null;

    public function __construct(
        private readonly AuditService $auditService,
        private readonly ChatAssignmentService $chatAssignmentService,
    ) {}

    public function processExpiredChat(Chat $chat, ?BotFlow $flow = null): bool
    {
        if ($chat->status !== 'open'
            || $chat->attention_status === 'archived'
            || $chat->operator_id !== null
            || ! $chat->bot_enabled
            || ! in_array($chat->attention_status, [null, 'bot'], true)) {
            return false;
        }

        $flow = $flow ?? ($chat->bot_flow_id ? BotFlow::find($chat->bot_flow_id) : null) ?? $this->getDefaultFlow();

        if (!$flow || !$this->shouldResetByTimeout($chat, $flow)) {
            return false;
        }

        $reason = 'inactivity_timeout';
        $before = [
            'bot_enabled' => (bool) $chat->bot_enabled,
            'operator_id' => $chat->operator_id ? (int) $chat->operator_id : null,
            'operator_name' => $chat->operator?->name,
            'status' => $chat->status,
            'attention_status' => $chat->attention_status,
            'bot_node_id' => $chat->bot_node_id,
        ];
        $chat->loadMissing('operator');
        $before['operator_name'] = $chat->operator?->name;
        $message = trim($this->inactivityTimeoutMessage());
        $sentMessage = null;

        if ($message !== '') {
            try {
                if ($chat->channel === 'webchat') {
                    $sentMessage = app(\App\Http\Controllers\WhatsAppController::class)->sendWebchatSystemMessage($chat, $message);
                } else {
                    $chat->loadMissing('contact');
                    $sentMessage = $this->sendWhatsAppText($chat, $message, 'user', 'bot', 'text');
                }
            } catch (\Throwable $e) {
                Log::warning('No se pudo enviar el mensaje de inactividad.', [
                    'chat_id' => $chat->id,
                    'channel' => $chat->channel,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $previousOperatorId = $chat->operator_id;
        $this->resetChatToStartFromFlow($chat, $flow, $reason);
        $chat->last_operator_id = $previousOperatorId ?? $chat->last_operator_id;
        $chat->operator_id = null;
        $chat->assigned_at = null;
        $chat->status = 'closed';
        $chat->attention_status = 'archived';
        $chat->closed_at = now();
        $chat->closed_by = 'system';
        $chat->closed_by_user_id = null;
        $chat->save();
        $chat->loadMissing('contact', 'operator', 'lastOperator');

        $this->chatAssignmentService->assignAllPending();

        $this->auditService->recordChatAction(
            'bot_inactivity_archived',
            'Finalizo la atencion y archivo el chat por inactividad',
            $chat,
            null,
            [
                'before' => [
                    'operator_id' => $previousOperatorId ? (int) $previousOperatorId : null,
                    'bot_enabled' => $before['bot_enabled'],
                    'operator_name' => $before['operator_name'],
                    'status' => $before['status'],
                    'attention_status' => $before['attention_status'],
                    'bot_node_id' => $before['bot_node_id'],
                ],
                'after' => [
                    'operator_id' => null,
                    'status' => 'closed',
                    'attention_status' => 'archived',
                    'bot_enabled' => (bool) $chat->bot_enabled,
                    'bot_node_id' => $chat->bot_node_id,
                ],
                'meta' => [
                    'reason' => $reason,
                    'flow_id' => $flow->id,
                    'start_node_id' => $flow->start_node_id,
                    'closed_by' => 'system',
                    'closed_by_user_id' => null,
                    'last_operator_id' => $chat->last_operator_id ? (int) $chat->last_operator_id : null,
                    'timeout_message_id' => $sentMessage?->id,
                ],
            ],
        );
        $this->publishArchivedChatStatus($chat);

        return true;
    }

    private function publishArchivedChatStatus(Chat $chat): void
    {
        $host = env('MQTT_HOST') ?: env('VITE_MOSQUITTO_HOST');
        if (!$host) {
            Log::warning('MQTT host not configured for inactivity archive.', ['chat_id' => $chat->id]);
            return;
        }

        try {
            $mqtt = new MqttClient((string) $host, 1883, 'laravel_inactivity_archive_'.uniqid());
            $settings = (new ConnectionSettings())->setConnectTimeout(2)->setSocketTimeout(2);
            $mqtt->connect($settings);
            $chatId = (int) $chat->id;

            $mqtt->publish('operator/chat/'.$chatId, json_encode([
                'chat_id' => $chatId,
                'active' => false,
                'operator_id' => null,
                'operator_name' => null,
                'status' => 'closed',
                'attention_status' => 'archived',
                'bot_enabled' => true,
                'assigned_at' => null,
                'closed_at' => $chat->closed_at?->toIso8601String(),
                'closed_by' => 'system',
                'last_operator_id' => $chat->last_operator_id ? (int) $chat->last_operator_id : null,
                'last_operator_name' => $chat->lastOperator?->name,
            ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE), 0);
            $mqtt->publish('status_bot/chat/'.$chatId, json_encode([
                'chat_id' => $chatId,
                'status' => 'enabled',
                'reset' => true,
            ]), 0);
            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::warning('MQTT error al archivar chat por inactividad.', [
                'chat_id' => $chat->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    public function inactivityTimeoutMinutes(): int
    {
        return max(1, min(10080, (int) $this->runtimeSetting('bot.inactivity_timeout_minutes', '1440')));
    }

    public function inactivityTimeoutMessage(): string
    {
        return (string) $this->runtimeSetting(
            'bot.inactivity_timeout_message',
            'La conversacion se cerro por inactividad. Si queres continuar, escribinos nuevamente y retomamos desde el inicio.'
        );
    }

    public function getDefaultFlow(?string $channel = null): ?BotFlow
    {
        $flows = BotFlow::query()
            ->where('is_active', true)
            ->when($channel, fn ($query) => $query->whereJsonContains('channels', $channel));
        $configuredFlowId = null;

        if ($channel === 'whatsapp') {
            $configuredFlowId = SystemSetting::query()->where('key', 'whatsapp.default_flow_id')->value('value');
        } elseif ($channel === 'webchat') {
            $settings = SystemSetting::query()->whereIn('key', [
                'webchat.flow_schedule',
                'webchat.default_flow_id',
                'general.timezone',
            ])->pluck('value', 'key');
            $schedule = json_decode((string) ($settings['webchat.flow_schedule'] ?? ''), true);
            $timezone = ($settings['general.timezone'] ?? null) ?: config('app.timezone');
            $day = strtolower(now($timezone)->format('l'));
            $configuredFlowId = is_array($schedule)
                ? ($schedule[$day] ?? null)
                : ($settings['webchat.default_flow_id'] ?? null);
        }

        if ($configuredFlowId) {
            $configuredFlow = (clone $flows)->whereKey($configuredFlowId)->first();
            if ($configuredFlow) return $configuredFlow;
        }

        return (clone $flows)->where('is_default', true)->first()
            ?? $flows->orderBy('id')->first();
    }

    public function shouldResetByTimeout(Chat $chat, ?BotFlow $flow = null): bool
    {
        if ($chat->status !== 'open'
            || $chat->operator_id !== null
            || ! $chat->bot_enabled
            || ! in_array($chat->attention_status, [null, 'bot'], true)) {
            return false;
        }

        $flow = $flow ?? $this->getDefaultFlow();
        if (!$flow || !$flow->start_node_id) {
            return false;
        }

        if (!$chat->last_user_message_at) {
            return false;
        }

        if (!$this->chatHasPendingFlowProgress($chat, $flow)) {
            return false;
        }

        return Carbon::parse($chat->last_user_message_at)->diffInMinutes(now()) >= $this->inactivityTimeoutMinutes();
    }

    public function chatHasPendingFlowProgress(Chat $chat, BotFlow $flow): bool
    {
        if ((int) ($chat->bot_node_id ?? 0) !== (int) $flow->start_node_id) {
            return true;
        }

        $state = $this->getState($chat);

        if (!empty($state['pending_input'])) {
            return true;
        }

        if (!$chat->bot_enabled && !empty($state['handoff'])) {
            return true;
        }

        return false;
    }

    public function resetChatToStartFromFlow(Chat $chat, BotFlow $flow, ?string $reason = null): void
    {
        if (!$flow->start_node_id) {
            return;
        }

        $state = $this->getState($chat);
        $vars = is_array($state['vars'] ?? null) ? $state['vars'] : [];
        $varsByDate = is_array($state['vars_by_date'] ?? null) ? $state['vars_by_date'] : [];

        $chat->bot_flow_id = $flow->id;
        $chat->bot_node_id = $flow->start_node_id;
        $chat->bot_state = [
            'vars' => $vars,
            'vars_by_date' => $varsByDate,
        ];
        $chat->bot_step = null;
        $chat->bot_enabled = true;
        $chat->save();

        Log::info("Chat {$chat->id} reset to start_node_id={$flow->start_node_id}. reason={$reason}");
    }

    private function getState(Chat $chat): array
    {
        return is_array($chat->bot_state) ? $chat->bot_state : [];
    }

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
        $phoneNumber = $this->formatPhoneNumber($contact->whatsapp_id);

        $data = [
            'messaging_product' => 'whatsapp',
            'to' => $phoneNumber,
            'text' => ['body' => $messageBody],
        ];

        $response = Http::withToken($accessToken)->post($url, $data);

        if ($response->failed()) {
            Log::error('API Error (sendWhatsAppText inactivity): ' . $response->body());
            throw new \RuntimeException('Error enviando mensaje de inactividad a WhatsApp');
        }

        $message = Message::create([
            'chat_id' => $chat->id,
            'sender' => $sender,
            'sender_subtype' => $sender === 'contact' ? 'contact' : $senderSubtype,
            'bot_node_type' => $botNodeType,
            'interactive_options' => $interactiveOptions,
            'message_type' => 'text',
            'body' => $messageBody,
            'status' => 'sent',
            'whatsapp_message_id' => $response->json()['messages'][0]['id'] ?? null,
        ]);

        try {
            $mqtt = new MqttClient(Env('VITE_MOSQUITTO_HOST'), 1883, 'laravel_send_inactivity_' . uniqid());
            $mqtt->connect();

            $mqtt->publish('sidebar/chat', json_encode([
                'chat_id' => $chat->id,
                'name' => $contact->name ?? 'Desconocido',
                'lastMessage' => $messageBody,
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
                'timestamp' => $message->created_at->toIso8601String(),
            ]), 0);

            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::error('MQTT Error (sendWhatsAppText inactivity): ' . $e->getMessage());
        }

        return $message;
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

    private function formatPhoneNumber(string $whatsappId): string
    {
        $digits = preg_replace('/\D+/', '', $whatsappId) ?? '';

        if (str_starts_with($digits, '54911')) {
            $digits = '5411' . substr($digits, 5);
        } elseif (str_starts_with($digits, '549')) {
            $digits = '54' . substr($digits, 3);
        }

        return $digits;
    }
}
