<?php

namespace App\Services;

use App\Models\SystemSetting;
use App\Models\WhatsAppTemplate;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;

class WhatsAppTemplateSyncService
{
    public function sync(): array
    {
        $token = $this->setting('integrations.whatsapp.token', env('WHATSAPP_ACCESS_TOKEN', ''));
        $wabaId = $this->setting('integrations.whatsapp.waba_id', env('WHATSAPP_WABA_ID', ''));

        if ($token === '' || $wabaId === '') {
            throw new \RuntimeException('La integracion de WhatsApp no tiene token o WABA ID configurado.');
        }

        $version = trim($this->setting(
            'integrations.whatsapp.graph_version',
            env('WHATSAPP_GRAPH_VERSION', 'v22.0')
        ), '/');
        $endpoint = "https://graph.facebook.com/{$version}/{$wabaId}/message_templates";
        $templates = [];
        $after = null;
        $page = 0;

        do {
            $response = Http::withToken($token)
                ->acceptJson()
                ->timeout(30)
                ->get($endpoint, array_filter([
                    'fields' => 'id,name,language,status,category,components',
                    'limit' => 100,
                    'after' => $after,
                ]));

            if (! $response->successful()) {
                $message = (string) ($response->json('error.message') ?? $response->body());
                throw new \RuntimeException('Meta no pudo devolver las plantillas: '.$message);
            }

            $data = $response->json('data', []);
            if (is_array($data)) {
                $templates = array_merge($templates, $data);
            }

            $after = $response->json('paging.cursors.after');
            $hasNextPage = is_string($response->json('paging.next'))
                && is_string($after)
                && $after !== '';
            $page++;
        } while ($hasNextPage && $page < 100);

        return $this->persist($templates);
    }

    public function persist(array $remoteTemplates): array
    {
        return DB::transaction(function () use ($remoteTemplates) {
            $syncedIds = [];
            $created = 0;
            $updated = 0;

            foreach ($remoteTemplates as $remoteTemplate) {
                if (! is_array($remoteTemplate)) {
                    continue;
                }

                $name = trim((string) ($remoteTemplate['name'] ?? ''));
                $language = trim((string) ($remoteTemplate['language'] ?? ''));
                $metaTemplateId = trim((string) ($remoteTemplate['id'] ?? ''));

                if ($name === '' || $language === '' || $metaTemplateId === '') {
                    continue;
                }

                $template = WhatsAppTemplate::query()
                    ->where('name', $name)
                    ->where('language', $language)
                    ->first();
                $attributes = $this->attributesFromMeta($remoteTemplate, $template);

                if ($template) {
                    $template->update($attributes);
                    $updated++;
                } else {
                    $template = WhatsAppTemplate::create([
                        'name' => $name,
                        'language' => $language,
                        'created_by' => null,
                        ...$attributes,
                    ]);
                    $created++;
                }

                $syncedIds[] = $template->id;
            }

            $staleQuery = WhatsAppTemplate::query();
            if ($syncedIds !== []) {
                $staleQuery->whereNotIn('id', $syncedIds);
            }

            $disabled = $staleQuery
                ->where('status', '!=', 'DISABLED')
                ->update([
                    'status' => 'DISABLED',
                    'is_supported' => false,
                    'synced_at' => now(),
                ]);

            return [
                'received' => count($remoteTemplates),
                'created' => $created,
                'updated' => $updated,
                'disabled' => $disabled,
            ];
        });
    }

    public function attributesFromMeta(array $template, ?WhatsAppTemplate $existing = null): array
    {
        $components = is_array($template['components'] ?? null) ? $template['components'] : [];
        $bodyComponent = collect($components)->first(
            fn ($component) => is_array($component)
                && strtoupper((string) ($component['type'] ?? '')) === 'BODY'
        );
        $body = trim((string) ($bodyComponent['text'] ?? ''));

        preg_match_all('/\{\{\s*(\d+)\s*\}\}/', $body, $matches);
        $positions = collect($matches[1] ?? [])
            ->map(fn ($position) => (int) $position)
            ->unique()
            ->sort()
            ->values()
            ->all();
        $expectedPositions = $positions === [] ? [] : range(1, max($positions));
        $existingKeys = $existing?->variable_keys ?? [];
        $variableKeys = count($existingKeys) === count($expectedPositions)
            ? array_values($existingKeys)
            : array_map(fn (int $position) => "variable_{$position}", $expectedPositions);

        return [
            'meta_template_id' => (string) $template['id'],
            'category' => strtoupper((string) ($template['category'] ?? 'UTILITY')),
            'status' => strtoupper((string) ($template['status'] ?? 'PENDING')),
            'body' => $body,
            'meta_components' => $components,
            'is_supported' => $this->isSupported($components, $body, $positions, $expectedPositions),
            'variable_keys' => $variableKeys,
            'synced_at' => now(),
        ];
    }

    private function isSupported(
        array $components,
        string $body,
        array $positions,
        array $expectedPositions
    ): bool {
        if ($body === '' || $positions !== $expectedPositions) {
            return false;
        }

        foreach ($components as $component) {
            if (! is_array($component)) {
                continue;
            }

            $type = strtoupper((string) ($component['type'] ?? ''));

            if (! in_array($type, ['HEADER', 'BODY', 'FOOTER', 'BUTTONS'], true)) {
                return false;
            }

            if ($type !== 'BODY' && preg_match('/\{\{.+?\}\}/', json_encode($component) ?: '') === 1) {
                return false;
            }

            if ($type === 'HEADER' && in_array(
                strtoupper((string) ($component['format'] ?? 'TEXT')),
                ['IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'],
                true
            )) {
                return false;
            }
        }

        return true;
    }

    private function setting(string $key, string $fallback): string
    {
        if (! Schema::hasTable('system_settings')) {
            return trim($fallback);
        }

        $value = SystemSetting::query()->where('key', $key)->value('value');

        return is_string($value) && trim($value) !== '' ? trim($value) : trim($fallback);
    }
}
