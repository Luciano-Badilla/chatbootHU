<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Contact extends Model
{
    use HasFactory;

    protected $fillable = [
        'whatsapp_id',
        'name',
        'profile_pic',
        'last_interaction_at',
    ];

    public function chats()
    {
        return $this->hasMany(Chat::class);
    }
}
