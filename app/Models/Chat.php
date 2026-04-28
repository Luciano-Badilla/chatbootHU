<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use App\Models\User;

class Chat extends Model
{
    use HasFactory;

    protected $fillable = [
        'contact_id',
        'bot_flow_id',
        'bot_node_id',
        'title',
        'status',
        'bot_enabled',
        'operator_id',
        'bot_step',
        'bot_state',
        'last_user_message_at',
    ];


    protected $casts = [
        'bot_enabled' => 'boolean',
        'bot_state' => 'array',
        'last_user_message_at' => 'datetime',
    ];

    public function contact()
    {
        return $this->belongsTo(Contact::class);
    }

    public function messages()
    {
        return $this->hasMany(Message::class);
    }

    public function botFlow()
    {
        return $this->belongsTo(\App\Models\BotFlow::class, 'bot_flow_id');
    }

    public function botNode()
    {
        return $this->belongsTo(\App\Models\BotNode::class, 'bot_node_id');
    }

    public function operator()
    {
        return $this->belongsTo(User::class, 'operator_id');
    }
}
