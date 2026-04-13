<?php

namespace App\Http\Controllers;

use App\Models\SystemSetting;
use Illuminate\Http\Request;
use Inertia\Inertia;

class SettingsController extends Controller
{
    public function index()
    {
        $settings = SystemSetting::query()
            ->whereIn('key', [
                'general.timezone',
                'general.language',
                'integrations.whatsapp.token',
                'integrations.whatsapp.phone_number_id',
                'integrations.whatsapp.webhook_verify_token',
                'integrations.alephoo.base_url',
                'integrations.alephoo.api_key',
                'integrations.alephoo.timeout',
                'integrations.alephoo.enabled_endpoints',
            ])
            ->pluck('value', 'key');

        return Inertia::render('SettingsPanel', [
            'settings' => [
                'general' => [
                    'timezone' => $settings['general.timezone'] ?? 'America/Argentina/Buenos_Aires',
                    'language' => $settings['general.language'] ?? 'es',
                ],
                'integrations' => [
                    'whatsapp' => [
                        'token' => $settings['integrations.whatsapp.token'] ?? '',
                        'phone_number_id' => $settings['integrations.whatsapp.phone_number_id'] ?? '',
                        'webhook_verify_token' => $settings['integrations.whatsapp.webhook_verify_token'] ?? '',
                    ],
                    'alephoo' => [
                        'base_url' => $settings['integrations.alephoo.base_url'] ?? '',
                        'api_key' => $settings['integrations.alephoo.api_key'] ?? '',
                        'timeout' => $settings['integrations.alephoo.timeout'] ?? '30',
                        'enabled_endpoints' => $settings['integrations.alephoo.enabled_endpoints'] ?? '',
                    ],
                ],
            ],
            'timezoneOptions' => collect(\DateTimeZone::listIdentifiers())
                ->map(fn ($timezone) => [
                    'value' => $timezone,
                    'label' => str_replace('_', ' ', $timezone),
                ])
                ->values(),
        ]);
    }

    public function saveGeneral(Request $request)
    {
        $data = $request->validate([
            'timezone' => ['required', 'timezone'],
            'language' => ['required', 'in:es,en'],
        ]);

        SystemSetting::updateOrCreate(
            ['key' => 'general.timezone'],
            ['value' => $data['timezone']],
        );

        SystemSetting::updateOrCreate(
            ['key' => 'general.language'],
            ['value' => $data['language']],
        );

        return response()->json([
            'ok' => true,
            'settings' => [
                'general' => [
                    'timezone' => $data['timezone'],
                    'language' => $data['language'],
                ],
            ],
        ]);
    }

    public function saveIntegrations(Request $request)
    {
        $data = $request->validate([
            'whatsapp.token' => ['nullable', 'string'],
            'whatsapp.phone_number_id' => ['nullable', 'string'],
            'whatsapp.webhook_verify_token' => ['nullable', 'string'],
            'alephoo.base_url' => ['nullable', 'url'],
            'alephoo.api_key' => ['nullable', 'string'],
            'alephoo.timeout' => ['required', 'integer', 'min:1', 'max:300'],
            'alephoo.enabled_endpoints' => ['nullable', 'string'],
        ]);

        SystemSetting::updateOrCreate(
            ['key' => 'integrations.whatsapp.token'],
            ['value' => $data['whatsapp']['token'] ?? ''],
        );
        SystemSetting::updateOrCreate(
            ['key' => 'integrations.whatsapp.phone_number_id'],
            ['value' => $data['whatsapp']['phone_number_id'] ?? ''],
        );
        SystemSetting::updateOrCreate(
            ['key' => 'integrations.whatsapp.webhook_verify_token'],
            ['value' => $data['whatsapp']['webhook_verify_token'] ?? ''],
        );
        SystemSetting::updateOrCreate(
            ['key' => 'integrations.alephoo.base_url'],
            ['value' => $data['alephoo']['base_url'] ?? ''],
        );
        SystemSetting::updateOrCreate(
            ['key' => 'integrations.alephoo.api_key'],
            ['value' => $data['alephoo']['api_key'] ?? ''],
        );
        SystemSetting::updateOrCreate(
            ['key' => 'integrations.alephoo.timeout'],
            ['value' => (string) ($data['alephoo']['timeout'] ?? 30)],
        );
        SystemSetting::updateOrCreate(
            ['key' => 'integrations.alephoo.enabled_endpoints'],
            ['value' => $data['alephoo']['enabled_endpoints'] ?? ''],
        );

        return response()->json([
            'ok' => true,
            'settings' => [
                'integrations' => [
                    'whatsapp' => [
                        'token' => $data['whatsapp']['token'] ?? '',
                        'phone_number_id' => $data['whatsapp']['phone_number_id'] ?? '',
                        'webhook_verify_token' => $data['whatsapp']['webhook_verify_token'] ?? '',
                    ],
                    'alephoo' => [
                        'base_url' => $data['alephoo']['base_url'] ?? '',
                        'api_key' => $data['alephoo']['api_key'] ?? '',
                        'timeout' => (string) ($data['alephoo']['timeout'] ?? 30),
                        'enabled_endpoints' => $data['alephoo']['enabled_endpoints'] ?? '',
                    ],
                ],
            ],
        ]);
    }
}
