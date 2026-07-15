<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class AgendaContact extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'first_name',
        'last_name',
        'formatted_name',
        'phone',
        'organization',
        'title',
    ];
}
