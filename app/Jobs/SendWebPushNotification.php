<?php

namespace App\Jobs;

use App\Models\Chat;
use App\Models\Message;
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

class SendWebPushNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public function __construct(public int $messageId)
    {
    }

    public function handle(): void
    {
        $publicKey = trim((string) config('services.webpush.public_key'));
        $privateKey = trim((string) config('services.webpush.private_key'));
        if ($publicKey === '' || $privateKey === '') {
            return;
        }

        $message = Message::query()->with('chat.contact')->find($this->messageId);
        if (! $message || ! $message->chat) {
            return;
        }

        $chat = $message->chat;
        $isWebchatVisitor = $chat->channel === 'webchat' && $message->sender === 'user';
        $subscriptions = $this->recipientSubscriptions($message, $chat);
        if ($isWebchatVisitor) {
            $activeSince = now()->subSeconds(15);
            if ($chat->webchat_last_seen_at?->greaterThanOrEqualTo($activeSince)) {
                return;
            }
            $subscriptions = $subscriptions->reject(
                fn (WebPushSubscription $subscription) => $subscription->updated_at?->greaterThanOrEqualTo($activeSince) ?? false,
            );
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
            'title' => $isWebchatVisitor ? 'Nueva respuesta' : 'Nuevo mensaje',
            'body' => $isWebchatVisitor
                ? 'Tenés una respuesta nueva. Abrí el chat para verla.'
                : 'Llegó un mensaje nuevo. Abrí la conversación para responder.',
            'icon' => $notificationIcon,
            'url' => $isWebchatVisitor
                ? '/webchat'
                : '/chat-panel?chat='.(int) $chat->id,
            'tag' => 'chat-'.$chat->id,
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
                    Log::warning('Web Push delivery failed.', [
                        'message_id' => $message->id,
                        'subscription_id' => $storedSubscription->id,
                    ]);
                }
            } catch (\Throwable $exception) {
                Log::warning('Web Push delivery could not be completed.', [
                    'message_id' => $message->id,
                    'subscription_id' => $storedSubscription->id,
                    'error_type' => get_class($exception),
                ]);
            }
        }
    }

    private function recipientSubscriptions(Message $message, Chat $chat)
    {
        if ($chat->channel === 'webchat' && $message->sender === 'user') {
            return WebPushSubscription::query()->where('chat_id', $chat->id)->get();
        }

        if ($message->sender !== 'contact') {
            return collect();
        }

        if (
            ! $chat->operator_id
            || $chat->status !== 'open'
            || $chat->attention_status !== 'assigned'
        ) {
            return collect();
        }

        $recipientIds = User::query()
            ->whereKey($chat->operator_id)
            ->where('is_active', true)
            ->pluck('id');

        if ($recipientIds->isEmpty()) {
            return collect();
        }

        return WebPushSubscription::query()
            ->whereIn('user_id', $recipientIds)
            ->whereNull('chat_id')
            ->get();
    }
}
