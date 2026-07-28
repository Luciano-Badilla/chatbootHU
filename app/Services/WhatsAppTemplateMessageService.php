<?php

namespace App\Services;

use App\Models\SystemSetting;
use App\Models\WhatsAppTemplate;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;

class WhatsAppTemplateMessageService
{
    public function send(WhatsAppTemplate $template, string $phone, array $variables): Response
    {
        $token = $this->setting('integrations.whatsapp.token', env('WHATSAPP_ACCESS_TOKEN', ''));
        $phoneId = $this->setting('integrations.whatsapp.phone_number_id', env('WHATSAPP_PHONE_ID', ''));

        if ($token === '' || $phoneId === '') {
            throw new \RuntimeException('La integracion de WhatsApp no tiene token o Phone number ID configurado.');
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'recipient_type' => 'individual',
            'to' => $phone,
            'type' => 'template',
            'template' => [
                'name' => $template->name,
                'language' => [
                    'code' => $template->language,
                ],
            ],
        ];

        $parameters = collect($template->variable_keys ?? [])
            ->map(fn (string $key) => [
                'type' => 'text',
                'text' => (string) ($variables[$key] ?? ''),
            ])
            ->values()
            ->all();

        if ($parameters !== []) {
            $payload['template']['components'] = [[
                'type' => 'body',
                'parameters' => $parameters,
            ]];
        }

        $graphVersion = trim($this->setting(
            'integrations.whatsapp.graph_version',
            env('WHATSAPP_GRAPH_VERSION', 'v22.0')
        ), '/');

        return Http::withToken($token)
            ->acceptJson()
            ->timeout(30)
            ->post("https://graph.facebook.com/{$graphVersion}/{$phoneId}/messages", $payload);
    }

    private function setting(string $key, string $fallback): string
    {
        if (! Schema::hasTable('system_settings')) {
            return $fallback;
        }

        $value = SystemSetting::query()->where('key', $key)->value('value');

        return is_string($value) && trim($value) !== '' ? trim($value) : $fallback;
    }
}
