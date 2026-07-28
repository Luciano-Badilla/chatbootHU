<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class WhatsAppTemplate extends Model
{
    protected $table = 'whatsapp_templates';

    protected $fillable = [
        'meta_template_id',
        'name',
        'language',
        'category',
        'status',
        'body',
        'meta_components',
        'is_supported',
        'variable_keys',
        'created_by',
        'synced_at',
    ];

    protected $casts = [
        'meta_components' => 'array',
        'is_supported' => 'boolean',
        'variable_keys' => 'array',
        'synced_at' => 'datetime',
    ];

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function campaigns(): HasMany
    {
        return $this->hasMany(Campaign::class);
    }

    public function render(array $variables): string
    {
        $body = $this->body;

        foreach ($this->variable_keys ?? [] as $index => $key) {
            $body = str_replace('{{'.($index + 1).'}}', (string) ($variables[$key] ?? ''), $body);
        }

        return $body;
    }
}
