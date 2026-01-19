<?php

// app/Models/BotFlow.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BotFlow extends Model
{
    protected $fillable = ['name', 'description', 'start_node_id', 'is_active', 'is_default'];

    public function nodes()
    {
        return $this->hasMany(BotNode::class, 'flow_id');
    }

    public function startNode()
    {
        return $this->belongsTo(BotNode::class, 'start_node_id');
    }

    public function scopeDefault($query)
    {
        return $query->where('is_default', true);
    }

}
