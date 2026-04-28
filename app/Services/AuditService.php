<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

class AuditService
{
    public function record(
        string $logName,
        string $event,
        string $description,
        ?User $actor = null,
        ?Model $subject = null,
        array $properties = []
    ): void {
        $entry = activity($logName);

        if ($actor) {
            $entry->causedBy($actor);
        }

        if ($subject) {
            $entry->performedOn($subject);
        }

        $entry
            ->event($event)
            ->withProperties($properties)
            ->log($description);
    }

    public function recordSettingsChange(
        string $context,
        array $before,
        array $after,
        ?User $actor = null
    ): void {
        if ($before === $after) {
            return;
        }

        $this->record(
            'settings',
            'updated',
            "Actualizo configuracion de {$context}",
            $actor,
            null,
            [
                'context' => $context,
                'changed_keys' => $this->changedKeys($before, $after),
                'before' => $this->sanitizeForAudit($before),
                'after' => $this->sanitizeForAudit($after),
            ],
        );
    }

    public function recordUserRoleChange(
        User $targetUser,
        string $beforeRole,
        string $afterRole,
        ?User $actor = null
    ): void {
        if ($beforeRole === $afterRole) {
            return;
        }

        $this->record(
            'users',
            'updated',
            "Actualizo rol de {$targetUser->name}",
            $actor,
            $targetUser,
            [
                'target_user' => [
                    'id' => $targetUser->id,
                    'name' => $targetUser->name,
                    'email' => $targetUser->email,
                ],
                'changed_keys' => ['role'],
                'before' => ['role' => $beforeRole],
                'after' => ['role' => $afterRole],
            ],
        );
    }

    public function recordConfigurationExport(?User $actor = null, array $meta = []): void
    {
        $this->record(
            'security',
            'exported',
            'Exporto configuracion del sistema',
            $actor,
            null,
            [
                'meta' => $meta,
            ],
        );
    }

    public function recordConfigurationImport(?User $actor = null, array $meta = []): void
    {
        $this->record(
            'security',
            'imported',
            'Importo configuracion del sistema',
            $actor,
            null,
            [
                'meta' => $meta,
            ],
        );
    }

    public function changedKeys(array $before, array $after, string $prefix = ''): array
    {
        $keys = array_unique(array_merge(array_keys($before), array_keys($after)));
        $changes = [];

        foreach ($keys as $key) {
            $beforeValue = $before[$key] ?? null;
            $afterValue = $after[$key] ?? null;
            $dotKey = $prefix !== '' ? "{$prefix}.{$key}" : (string) $key;

            if (is_array($beforeValue) || is_array($afterValue)) {
                $nested = $this->changedKeys(
                    is_array($beforeValue) ? $beforeValue : [],
                    is_array($afterValue) ? $afterValue : [],
                    $dotKey,
                );

                foreach ($nested as $nestedKey) {
                    $changes[] = $nestedKey;
                }

                continue;
            }

            if ($beforeValue !== $afterValue) {
                $changes[] = $dotKey;
            }
        }

        return array_values(array_unique($changes));
    }

    public function sanitizeForAudit(array $data): array
    {
        $sanitized = [];

        foreach ($data as $key => $value) {
            $normalizedKey = strtolower((string) $key);

            if (is_array($value)) {
                $sanitized[$key] = $this->sanitizeForAudit($value);
                continue;
            }

            if ($this->isSensitiveKey($normalizedKey)) {
                $sanitized[$key] = $this->maskValue($value);
                continue;
            }

            $sanitized[$key] = $value;
        }

        return $sanitized;
    }

    protected function isSensitiveKey(string $key): bool
    {
        return str_contains($key, 'token')
            || str_contains($key, 'api_key')
            || str_contains($key, 'secret')
            || str_contains($key, 'password');
    }

    protected function maskValue(mixed $value): string
    {
        $string = trim((string) $value);

        if ($string === '') {
            return '';
        }

        if (strlen($string) <= 6) {
            return str_repeat('*', strlen($string));
        }

        return substr($string, 0, 2) . str_repeat('*', max(strlen($string) - 4, 2)) . substr($string, -2);
    }
}
