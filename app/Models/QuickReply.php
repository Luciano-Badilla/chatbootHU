<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class QuickReply extends Model
{
    protected $fillable = ['title', 'body', 'sort_order', 'active'];

    protected $casts = [
        'sort_order' => 'integer',
        'active' => 'boolean',
    ];
}
