<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Message extends Model
{
    use HasFactory;

    protected $fillable = [
        'chat_id',
        'sender',
        'sender_subtype',
        'operator_name',
        'bot_node_type',
        'interactive_options',
        'message_type',
        'body',
        'media_url',
        'media_name',
        'template_name',
        'template_language',
        'status',
        'whatsapp_message_id',
    ];

    protected $casts = [
        'interactive_options' => 'array',
    ];

    public function chat()
    {
        return $this->belongsTo(Chat::class);
    }
}
