<?php

namespace App\Jobs;

use App\Models\Chat;
use App\Models\SystemSetting;
use App\Models\User;
use App\Models\WebPushSubscription;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

class SendChatEventWebPushNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public function __construct(
        public int $chatId,
        public string $eventType,
        public ?int $operatorId = null,
    ) {
    }

    public function handle(): void
    {
        $publicKey = trim((string) config('services.webpush.public_key'));
        $privateKey = trim((string) config('services.webpush.private_key'));
        if ($publicKey === '' || $privateKey === '') {
            return;
        }

        $chat = Chat::query()->with(['contact', 'operator'])->find($this->chatId);
        if (! $chat) {
            return;
        }

        $activeSince = now()->subSeconds(15);
        if ($this->eventType === 'operator_assigned') {
            if (
                ! $this->operatorId
                || $chat->status !== 'open'
                || $chat->attention_status !== 'assigned'
                || (int) $chat->operator_id !== $this->operatorId
            ) {
                return;
            }

            $subscriptions = WebPushSubscription::query()
                ->where('user_id', $this->operatorId)
                ->whereNull('chat_id')
                ->get();
            $title = 'Nuevo chat asignado';
            $contactName = trim((string) ($chat->contact?->name ?: $chat->contact?->whatsapp_id ?: ''));
            $body = $contactName !== ''
                ? "Se te asignó el chat con {$contactName}. Abrí Chat Panel para responder."
                : 'Se te asignó un chat. Abrí Chat Panel para responder.';
            $targetUrl = '/chat-panel?chat='.(int) $chat->id;
            $tag = 'chat-assigned-'.$chat->id;
        } elseif ($this->eventType === 'webchat_operator_joined' && $chat->channel === 'webchat') {
            if (
                ! $this->operatorId
                || $chat->status !== 'open'
                || $chat->attention_status !== 'assigned'
                || (int) $chat->operator_id !== $this->operatorId
            ) {
                return;
            }

            if ($chat->webchat_last_seen_at?->greaterThanOrEqualTo($activeSince)) {
                return;
            }

            $subscriptions = WebPushSubscription::query()
                ->where('chat_id', $chat->id)
                ->whereNull('user_id')
                ->get()
                ->reject(fn (WebPushSubscription $subscription) => $subscription->updated_at?->greaterThanOrEqualTo($activeSince) ?? false);

            $operatorName = trim((string) ($this->operatorId
                ? User::query()->whereKey($this->operatorId)->value('name')
                : $chat->operator?->name));
            $title = 'Un operador tomó tu chat';
            $body = $operatorName !== ''
                ? "{$operatorName} ya está atendiendo tu consulta. Abrí el chat para responderle."
                : 'Un operador ya está atendiendo tu consulta. Abrí el chat para responderle.';
            $targetUrl = '/webchat';
            $tag = 'chat-operator-joined-'.$chat->id;
        } else {
            return;
        }

        if ($subscriptions->isEmpty()) {
            return;
        }

        $configuredLogo = trim((string) SystemSetting::query()
            ->where('key', 'webchat.logo_url')
            ->value('value'));
        $notificationIcon = $configuredLogo !== ''
            ? (preg_match('#^https?://#i', $configuredLogo)
                ? $configuredLogo
                : url('/'.ltrim($configuredLogo, '/')))
            : url('/images/hu_icon_new.png');

        $payload = json_encode([
            'title' => $title,
            'body' => $body,
            'icon' => $notificationIcon,
            'url' => $targetUrl,
            'tag' => $tag,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if (! $payload) {
            return;
        }

        $webPush = new WebPush([
            'VAPID' => [
                'subject' => (string) config('services.webpush.subject'),
                'publicKey' => $publicKey,
                'privateKey' => $privateKey,
            ],
        ]);

        foreach ($subscriptions as $storedSubscription) {
            try {
                $subscription = Subscription::create([
                    'endpoint' => $storedSubscription->endpoint,
                    'publicKey' => $storedSubscription->public_key,
                    'authToken' => $storedSubscription->auth_token,
                    'contentEncoding' => $storedSubscription->content_encoding ?: 'aes128gcm',
                ]);
                $report = $webPush->sendOneNotification($subscription, $payload, [
                    'TTL' => 300,
                    'urgency' => 'normal',
                ]);

                if ($report->isSubscriptionExpired()) {
                    $storedSubscription->delete();
                } elseif (! $report->isSuccess()) {
                    Log::warning('Chat event web push delivery failed.', [
                        'chat_id' => $chat->id,
                        'event_type' => $this->eventType,
                        'subscription_id' => $storedSubscription->id,
                    ]);
                }
            } catch (\Throwable $exception) {
                Log::warning('Chat event web push could not be completed.', [
                    'chat_id' => $chat->id,
                    'event_type' => $this->eventType,
                    'subscription_id' => $storedSubscription->id,
                    'error_type' => get_class($exception),
                ]);
            }
        }
    }
}
