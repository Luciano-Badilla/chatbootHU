<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CampaignRecipient extends Model
{
    protected $fillable = [
        'campaign_id',
        'row_number',
        'phone',
        'name',
        'variables',
        'rendered_body',
        'status',
        'whatsapp_message_id',
        'attempts',
        'error_code',
        'error_message',
        'queued_at',
        'sent_at',
        'delivered_at',
        'read_at',
        'failed_at',
    ];

    protected $casts = [
        'variables' => 'array',
        'queued_at' => 'datetime',
        'sent_at' => 'datetime',
        'delivered_at' => 'datetime',
        'read_at' => 'datetime',
        'failed_at' => 'datetime',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }
}
