<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WebchatReferral extends Model
{
    protected $fillable = [
        'token',
        'source_chat_id',
        'source_message_id',
        'sent_at',
        'entered_at',
    ];

    protected $casts = [
        'sent_at' => 'datetime',
        'entered_at' => 'datetime',
    ];

    public function sourceChat()
    {
        return $this->belongsTo(Chat::class, 'source_chat_id');
    }

    public function sourceMessage()
    {
        return $this->belongsTo(Message::class, 'source_message_id');
    }
}
