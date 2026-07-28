<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Campaign extends Model
{
    protected $fillable = [
        'name',
        'whatsapp_template_id',
        'status',
        'source_filename',
        'total_count',
        'valid_count',
        'invalid_count',
        'duplicate_count',
        'sent_count',
        'delivered_count',
        'read_count',
        'failed_count',
        'import_errors',
        'created_by',
        'started_at',
        'finished_at',
    ];

    protected $casts = [
        'import_errors' => 'array',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    public function template(): BelongsTo
    {
        return $this->belongsTo(WhatsAppTemplate::class, 'whatsapp_template_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function recipients(): HasMany
    {
        return $this->hasMany(CampaignRecipient::class);
    }
}
