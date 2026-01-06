<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Queue\SerializesModels;

class NewMessage implements ShouldBroadcast
{
    use SerializesModels;

    public $chat;
    public $message;
    public $timestamp;

    public function __construct($chat, $message)
    {
        $this->chat = [
            'id' => $chat->id,
            'name' => $chat->contact->name ?? 'Desconocido',
        ];

        $this->message = $message->body;
        $this->timestamp = $message->created_at->format('H:i'); // o format que uses
    }

    public function broadcastOn()
    {
        return new Channel('chat'); // público, puedes usar 'chat.{id}' si querés privado
    }

    public function broadcastAs()
    {
        return 'NewMessage';
    }
}
