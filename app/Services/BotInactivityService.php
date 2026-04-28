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
use PhpMqtt\Client\Exceptions\MqttClientException;
use PhpMqtt\Client\MqttClient;

class BotInactivityService
{
    private ?array $runtimeSettingsCache = null;

    public function processExpiredChat(Chat $chat, ?BotFlow $flow = null): bool
    {
        $flow = $flow ?? $this->getDefaultFlow();

        if (!$flow || !$this->shouldResetByTimeout($chat, $flow)) {
            return false;
        }

        $reason = $chat->bot_enabled ? 'timeout_24h' : 'handoff_timeout_24h';
        $message = trim($this->inactivityTimeoutMessage());

        if ($message !== '') {
            $chat->loadMissing('contact');
            $this->sendWhatsAppText($chat, $message, 'user', 'bot', 'text');
        }

        $this->resetChatToStartFromFlow($chat, $flow, $reason);

        return true;
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

    public function getDefaultFlow(): ?BotFlow
    {
        return BotFlow::where('is_default', true)
            ->where('is_active', true)
            ->first()
            ?? BotFlow::where('is_active', true)->orderBy('id')->first();
    }

    public function shouldResetByTimeout(Chat $chat, ?BotFlow $flow = null): bool
    {
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
        } catch (MqttClientException $e) {
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
