<?php

namespace App\Http\Controllers;

use App\Models\Chat;
use App\Models\WebPushSubscription;
use Illuminate\Http\Request;

class WebPushSubscriptionController extends Controller
{
    public function publicKey()
    {
        $key = trim((string) config('services.webpush.public_key'));

        return response()->json([
            'enabled' => $key !== '' && trim((string) config('services.webpush.private_key')) !== '',
            'public_key' => $key !== '' ? $key : null,
        ]);
    }

    public function subscribeOperator(Request $request)
    {
        return $this->store($request, (int) $request->user()->id, null);
    }

    public function unsubscribeOperator(Request $request)
    {
        $data = $request->validate(['endpoint' => ['required', 'string', 'max:4096']]);
        WebPushSubscription::query()
            ->where('user_id', $request->user()->id)
            ->where('endpoint_hash', hash('sha256', $data['endpoint']))
            ->delete();

        return response()->json(['ok' => true]);
    }

    public function operatorStatus(Request $request)
    {
        $data = $request->validate(['endpoint' => ['required', 'string', 'max:4096']]);
        $enabled = WebPushSubscription::query()
            ->where('user_id', $request->user()->id)
            ->whereNull('chat_id')
            ->where('endpoint_hash', hash('sha256', $data['endpoint']))
            ->exists();

        return response()->json(['enabled' => $enabled]);
    }

    public function subscribeWebchat(Request $request)
    {
        $data = $request->validate(['resume_token' => ['required', 'string', 'max:80']]);
        $chat = Chat::query()->where('channel', 'webchat')->where('webchat_token', $data['resume_token'])->first();

        if (! $chat) {
            return response()->json(['message' => 'La conversación ya no está disponible.'], 404);
        }

        return $this->store($request, null, (int) $chat->id);
    }

    public function unsubscribeWebchat(Request $request)
    {
        $data = $request->validate([
            'resume_token' => ['required', 'string', 'max:80'],
            'endpoint' => ['required', 'string', 'max:4096'],
        ]);
        $chat = Chat::query()->where('channel', 'webchat')->where('webchat_token', $data['resume_token'])->first();

        if ($chat) {
            WebPushSubscription::query()
                ->where('chat_id', $chat->id)
                ->where('endpoint_hash', hash('sha256', $data['endpoint']))
                ->delete();
        }

        return response()->json(['ok' => true]);
    }

    public function webchatStatus(Request $request)
    {
        $data = $request->validate([
            'resume_token' => ['required', 'string', 'max:80'],
            'endpoint' => ['required', 'string', 'max:4096'],
        ]);
        $chat = Chat::query()->where('channel', 'webchat')->where('webchat_token', $data['resume_token'])->first();
        $enabled = $chat && WebPushSubscription::query()
            ->where('chat_id', $chat->id)
            ->whereNull('user_id')
            ->where('endpoint_hash', hash('sha256', $data['endpoint']))
            ->exists();

        return response()->json(['enabled' => (bool) $enabled]);
    }

    private function store(Request $request, ?int $userId, ?int $chatId)
    {
        $data = $request->validate([
            'subscription.endpoint' => ['required', 'url', 'max:4096'],
            'subscription.keys.p256dh' => ['required', 'string', 'max:512'],
            'subscription.keys.auth' => ['required', 'string', 'max:512'],
            'subscription.contentEncoding' => ['nullable', 'string', 'max:40'],
        ]);
        $subscription = $data['subscription'];
        $endpoint = $subscription['endpoint'];
        $endpointParts = parse_url($endpoint);
        $host = strtolower((string) ($endpointParts['host'] ?? ''));
        $allowedPushHosts = [
            'fcm.googleapis.com',
            'push.services.mozilla.com',
            'updates.push.services.mozilla.com',
            'web.push.apple.com',
        ];

        if (
            ($endpointParts['scheme'] ?? null) !== 'https'
            || (isset($endpointParts['port']) && (int) $endpointParts['port'] !== 443)
            || ! in_array($host, $allowedPushHosts, true)
        ) {
            return response()->json(['message' => 'El endpoint de notificaciones no es válido.'], 422);
        }

        $existingQuery = WebPushSubscription::query()->where('endpoint_hash', hash('sha256', $endpoint));
        if ($userId !== null) {
            $existingQuery->where('user_id', $userId)->whereNull('chat_id');
        } else {
            $existingQuery->where('chat_id', $chatId)->whereNull('user_id');
        }

        $storedSubscription = $existingQuery->first() ?? new WebPushSubscription([
            'user_id' => $userId,
            'chat_id' => $chatId,
            'endpoint_hash' => hash('sha256', $endpoint),
        ]);
        $storedSubscription->fill([
            'endpoint' => $endpoint,
            'public_key' => $subscription['keys']['p256dh'],
            'auth_token' => $subscription['keys']['auth'],
            'content_encoding' => $subscription['contentEncoding'] ?? 'aes128gcm',
        ])->save();

        return response()->json(['ok' => true]);
    }
}
