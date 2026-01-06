<?php
// app/Models/BotNode.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BotNode extends Model
{
    protected $fillable = ['flow_id', 'key', 'type', 'body', 'settings', 'next_node_id'];

    protected $casts = [
        'settings' => 'array',
    ];

    public function flow()
    {
        return $this->belongsTo(BotFlow::class, 'flow_id');
    }

    public function nextNode()
    {
        return $this->belongsTo(BotNode::class, 'next_node_id');
    }
}
