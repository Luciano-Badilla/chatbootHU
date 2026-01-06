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
                // Tomamos el último chat del contacto (puede haber varios)
                $chat = $contact->chats->last();
                $lastMessage = $chat?->messages->first();

                return [
                    'id' => (string) $chat?->id ?? '',
                    'name' => $contact->name ?? $contact->whatsapp_id,
                    'lastMessage' => $lastMessage?->body ?? '',
                    'timestamp' => $lastMessage->created_at,
                    'unread' => $chat
                        ? $chat->messages()
                        ->where('status', 'received')
                        ->where('status', '!=', 'read')
                        ->count()
                        : 0,
                    'online' => false, // placeholder
                    'avatar' => $contact->profile_pic,
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
