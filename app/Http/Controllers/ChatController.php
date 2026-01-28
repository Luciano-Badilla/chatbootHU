<?php

namespace App\Http\Controllers;

use App\Models\Contact;
use App\Models\Message;
use Inertia\Inertia;

class ChatController extends Controller
{
    public function index()
    {
        $chats = Contact::with(['chats.messages' => function ($q) {
            $q->latest();
        }])
            ->get()
            ->map(function ($contact) {
                $chat = $contact->chats->last();
                $lastMessage = $chat?->messages->first();

                return [
                    'id' => (int) ($chat?->id ?? 0),
                    'name' => $contact->name ?? $contact->whatsapp_id,
                    'number' => '+' . $contact->whatsapp_id,
                    'lastMessage' => $lastMessage?->body ?? '',
                    'timestamp' => $lastMessage?->created_at,
                    'unread' => $chat
                        ? $chat->messages()
                        ->where('status', 'received')
                        ->where('status', '!=', 'read')
                        ->count()
                        : 0,
                    'online' => false,
                    'avatar' => $contact->profile_pic,
                    'bot_enabled' => (bool) ($chat?->bot_enabled ?? true),

                    // ✅ CLAVE: acá van las variables
                    'bot_state' => $chat?->bot_state ?? [],
                ];
            });

        return Inertia::render('MessagePanel', [
            'chats' => $chats,
        ]);
    }


    public function markAsReadMessages($chatId)
    {
        Message::where('chat_id', $chatId)->where('status', 'received')->update(['status' => 'read']);
    }

    public function getMessages($chatId)
    {
        $messages = Message::where('chat_id', $chatId)->get();
        return $messages;
    }
}
