<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Chat extends Model
{
    use HasFactory;

    protected $fillable = [
        'contact_id',
        'title',
        'status',

    ];

    protected $casts = [
        'bot_enabled' => 'boolean',
        'bot_state'   => 'array',
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
}
