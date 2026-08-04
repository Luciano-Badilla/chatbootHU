<?php

namespace App\Http\Controllers;

use App\Models\BotFlow;
use App\Models\BotNode;
use App\Models\Role;
use App\Models\SystemSetting;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

class SettingsController extends Controller
{
    public function __construct(private readonly AuditService $auditService)
    {
    }

    public function index(Request $request)
    {
        $settings = SystemSetting::query()
            ->whereIn('key', [
                'general.timezone',
                'general.language',
                'integrations.whatsapp.token',
                'integrations.whatsapp.waba_id',
                'integrations.whatsapp.phone_number_id',
                'integrations.whatsapp.webhook_verify_token',
                'integrations.alephoo.base_url',
                'integrations.alephoo.api_key',
                'integrations.alephoo.timeout',
                'integrations.alephoo.enabled_endpoints',
                'integrations.alephoo_v3.base_url',
                'integrations.alephoo_v3.username',
                'integrations.alephoo_v3.password',
                'integrations.alephoo_v3.timeout',
                'integrations.autogestion.base_url',
                'integrations.autogestion.token',
                'integrations.autogestion.timeout',
                'bot.inactivity_timeout_minutes',
                'bot.inactivity_timeout_message',
            ])
            ->pluck('value', 'key');
        $storedWhatsappToken = trim((string) ($settings['integrations.whatsapp.token'] ?? ''));
        $storedWhatsappWabaId = trim((string) ($settings['integrations.whatsapp.waba_id'] ?? ''));
        $storedWhatsappPhoneNumberId = trim((string) ($settings['integrations.whatsapp.phone_number_id'] ?? ''));
        $storedWhatsappVerifyToken = trim((string) ($settings['integrations.whatsapp.webhook_verify_token'] ?? ''));

        $activeFlows = BotFlow::query()
            ->where('is_active', true)
            ->orderBy('name')
            ->get(['id', 'name', 'is_default']);

        $defaultFlow = $activeFlows->firstWhere('is_default', true);

        return Inertia::render('SettingsPanel', [
            'settings' => [
                'general' => [
                    'timezone' => $settings['general.timezone'] ?? 'America/Argentina/Buenos_Aires',
                    'language' => $settings['general.language'] ?? 'es',
                ],
                'integrations' => [
                    'whatsapp' => [
                        'token' => $settings['integrations.whatsapp.token'] ?? '',
                        'token_configured' => $storedWhatsappToken !== '' || trim((string) env('WHATSAPP_ACCESS_TOKEN', '')) !== '',
                        'waba_id' => $storedWhatsappWabaId !== '' ? $storedWhatsappWabaId : env('WHATSAPP_WABA_ID', ''),
                        'phone_number_id' => $storedWhatsappPhoneNumberId !== '' ? $storedWhatsappPhoneNumberId : env('WHATSAPP_PHONE_ID', ''),
                        'webhook_verify_token' => $settings['integrations.whatsapp.webhook_verify_token'] ?? '',
                        'webhook_verify_token_configured' => $storedWhatsappVerifyToken !== '' || trim((string) env('WHATSAPP_VERIFY_TOKEN', '')) !== '',
                    ],
                    'alephoo' => [
                        'base_url' => ($settings['integrations.alephoo.base_url'] ?? '') ?: (string) env('HOSPITAL_PERSON_API_BASE', ''),
                        'api_key' => $settings['integrations.alephoo.api_key'] ?? '',
                        'timeout' => ($settings['integrations.alephoo.timeout'] ?? '') ?: '30',
                        'enabled_endpoints' => $settings['integrations.alephoo.enabled_endpoints'] ?? '',
                    ],
                    'alephoo_v3' => [
                        'base_url' => ($settings['integrations.alephoo_v3.base_url'] ?? '') ?: (string) config('services.alephoo_v3.base_url', ''),
                        'username' => $settings['integrations.alephoo_v3.username'] ?? '',
                        'password' => $settings['integrations.alephoo_v3.password'] ?? '',
                        'timeout' => ($settings['integrations.alephoo_v3.timeout'] ?? '') ?: (string) config('services.alephoo_v3.timeout', 30),
                    ],
                    'autogestion' => [
                        'base_url' => ($settings['integrations.autogestion.base_url'] ?? '') ?: (string) config('services.turnos_configuration.url', ''),
                        'token' => $settings['integrations.autogestion.token'] ?? '',
                        'timeout' => ($settings['integrations.autogestion.timeout'] ?? '') ?: (string) config('services.turnos_configuration.timeout', 15),
                    ],
                ],
                'bot' => [
                    'default_flow_id' => $defaultFlow?->id,
                    'inactivity_timeout_minutes' => $settings['bot.inactivity_timeout_minutes'] ?? '1440',
                    'inactivity_timeout_message' => $settings['bot.inactivity_timeout_message']
                        ?? 'La conversacion se cerro por inactividad. Si queres continuar, escribinos nuevamente y retomamos desde el inicio.',
                ],
            ],
            'botFlows' => $activeFlows->map(fn (BotFlow $flow) => [
                'id' => $flow->id,
                'name' => $flow->name,
                'is_default' => (bool) $flow->is_default,
            ])->values(),
            'roles' => Role::query()
                ->orderBy('id')
                ->get(['id', 'name'])
                ->map(fn (Role $role) => [
                    'id' => $role->id,
                    'name' => $role->displayName(),
                ])
                ->values(),
            'users' => User::query()
                ->with('role')
                ->orderBy('name')
                ->get(['id', 'name', 'email', 'validated', 'requestsPassword', 'role_id'])
                ->map(fn (User $user) => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'validated' => (bool) $user->validated,
                    'requests_password' => (bool) $user->requestsPassword,
                    'role_id' => (int) $user->role_id,
                    'role_name' => $user->roleName(),
                    'role_label' => $user->roleLabel(),
                ])
                ->values(),
            'currentUserId' => $this->resolveCurrentUserId(request()),
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

        $before = [
            'timezone' => $this->settingValue('general.timezone', 'America/Argentina/Buenos_Aires'),
            'language' => $this->settingValue('general.language', 'es'),
        ];

        SystemSetting::updateOrCreate(
            ['key' => 'general.timezone'],
            ['value' => $data['timezone']],
        );

        SystemSetting::updateOrCreate(
            ['key' => 'general.language'],
            ['value' => $data['language']],
        );

        $after = [
            'timezone' => $data['timezone'],
            'language' => $data['language'],
        ];

        $this->auditService->recordSettingsChange('general', $before, $after, $request->user());

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
            'whatsapp.waba_id' => ['nullable', 'regex:/^\d+$/', 'max:40'],
            'whatsapp.phone_number_id' => ['nullable', 'regex:/^\d+$/', 'max:40'],
            'whatsapp.webhook_verify_token' => ['nullable', 'string', 'max:255'],
            'alephoo.base_url' => ['nullable', 'url'],
            'alephoo.api_key' => ['nullable', 'string'],
            'alephoo.timeout' => ['required', 'integer', 'min:1', 'max:300'],
            'alephoo.enabled_endpoints' => ['nullable', 'string'],
            'alephoo_v3.base_url' => ['nullable', 'url'],
            'alephoo_v3.username' => ['nullable', 'string'],
            'alephoo_v3.password' => ['nullable', 'string'],
            'alephoo_v3.timeout' => ['required', 'integer', 'min:1', 'max:300'],
            'autogestion.base_url' => ['nullable', 'url'],
            'autogestion.token' => ['nullable', 'string'],
            'autogestion.timeout' => ['required', 'integer', 'min:1', 'max:300'],
        ]);

        $before = [
            'whatsapp' => [
                'token' => $this->settingValue('integrations.whatsapp.token', ''),
                'waba_id' => $this->settingValue('integrations.whatsapp.waba_id', ''),
                'phone_number_id' => $this->settingValue('integrations.whatsapp.phone_number_id', ''),
                'webhook_verify_token' => $this->settingValue('integrations.whatsapp.webhook_verify_token', ''),
            ],
            'alephoo' => [
                'base_url' => $this->settingValue('integrations.alephoo.base_url', ''),
                'api_key' => $this->settingValue('integrations.alephoo.api_key', ''),
                'timeout' => $this->settingValue('integrations.alephoo.timeout', '30'),
                'enabled_endpoints' => $this->settingValue('integrations.alephoo.enabled_endpoints', ''),
            ],
            'alephoo_v3' => [
                'base_url' => $this->settingValue('integrations.alephoo_v3.base_url', ''),
                'username' => $this->settingValue('integrations.alephoo_v3.username', ''),
                'password' => $this->settingValue('integrations.alephoo_v3.password', ''),
                'timeout' => $this->settingValue('integrations.alephoo_v3.timeout', '30'),
            ],
            'autogestion' => [
                'base_url' => $this->settingValue('integrations.autogestion.base_url', ''),
                'token' => $this->settingValue('integrations.autogestion.token', ''),
                'timeout' => $this->settingValue('integrations.autogestion.timeout', '15'),
            ],
        ];

        SystemSetting::updateOrCreate(
            ['key' => 'integrations.whatsapp.token'],
            ['value' => $data['whatsapp']['token'] ?? ''],
        );
        SystemSetting::updateOrCreate(
            ['key' => 'integrations.whatsapp.waba_id'],
            ['value' => $data['whatsapp']['waba_id'] ?? ''],
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
        foreach ([
            'integrations.alephoo_v3.base_url' => $data['alephoo_v3']['base_url'] ?? '',
            'integrations.alephoo_v3.username' => $data['alephoo_v3']['username'] ?? '',
            'integrations.alephoo_v3.password' => $data['alephoo_v3']['password'] ?? '',
            'integrations.alephoo_v3.timeout' => (string) ($data['alephoo_v3']['timeout'] ?? 30),
            'integrations.autogestion.base_url' => $data['autogestion']['base_url'] ?? '',
            'integrations.autogestion.token' => $data['autogestion']['token'] ?? '',
            'integrations.autogestion.timeout' => (string) ($data['autogestion']['timeout'] ?? 15),
        ] as $settingKey => $settingValue) {
            SystemSetting::updateOrCreate(['key' => $settingKey], ['value' => $settingValue]);
        }

        $after = [
            'whatsapp' => [
                'token' => $data['whatsapp']['token'] ?? '',
                'waba_id' => $data['whatsapp']['waba_id'] ?? '',
                'phone_number_id' => $data['whatsapp']['phone_number_id'] ?? '',
                'webhook_verify_token' => $data['whatsapp']['webhook_verify_token'] ?? '',
            ],
            'alephoo' => [
                'base_url' => $data['alephoo']['base_url'] ?? '',
                'api_key' => $data['alephoo']['api_key'] ?? '',
                'timeout' => (string) ($data['alephoo']['timeout'] ?? 30),
                'enabled_endpoints' => $data['alephoo']['enabled_endpoints'] ?? '',
            ],
            'alephoo_v3' => [
                'base_url' => $data['alephoo_v3']['base_url'] ?? '',
                'username' => $data['alephoo_v3']['username'] ?? '',
                'password' => $data['alephoo_v3']['password'] ?? '',
                'timeout' => (string) ($data['alephoo_v3']['timeout'] ?? 30),
            ],
            'autogestion' => [
                'base_url' => $data['autogestion']['base_url'] ?? '',
                'token' => $data['autogestion']['token'] ?? '',
                'timeout' => (string) ($data['autogestion']['timeout'] ?? 15),
            ],
        ];

        $this->auditService->recordSettingsChange('integrations', $before, $after, $request->user());

        return response()->json([
            'ok' => true,
            'settings' => [
                'integrations' => [
                    'whatsapp' => [
                        'token' => $data['whatsapp']['token'] ?? '',
                        'waba_id' => $data['whatsapp']['waba_id'] ?? '',
                        'phone_number_id' => $data['whatsapp']['phone_number_id'] ?? '',
                        'webhook_verify_token' => $data['whatsapp']['webhook_verify_token'] ?? '',
                    ],
                    'alephoo' => [
                        'base_url' => $data['alephoo']['base_url'] ?? '',
                        'api_key' => $data['alephoo']['api_key'] ?? '',
                        'timeout' => (string) ($data['alephoo']['timeout'] ?? 30),
                        'enabled_endpoints' => $data['alephoo']['enabled_endpoints'] ?? '',
                    ],
                    'alephoo_v3' => $after['alephoo_v3'],
                    'autogestion' => $after['autogestion'],
                ],
            ],
        ]);
    }

    public function testAlephoo(Request $request)
    {
        $data = $request->validate([
            'base_url' => ['nullable', 'url'],
            'api_key' => ['nullable', 'string'],
            'timeout' => ['required', 'integer', 'min:1', 'max:300'],
            'enabled_endpoints' => ['nullable', 'string'],
            'only_alephoo' => ['nullable', 'boolean'],
            'integration' => ['nullable', 'in:alephoo,api_turnos,autogestion'],
            'alephoo_v3.base_url' => ['nullable', 'url'],
            'alephoo_v3.username' => ['nullable', 'string'],
            'alephoo_v3.password' => ['nullable', 'string'],
            'alephoo_v3.timeout' => ['nullable', 'integer', 'min:1', 'max:300'],
            'autogestion.base_url' => ['nullable', 'url'],
            'autogestion.token' => ['nullable', 'string'],
            'autogestion.timeout' => ['nullable', 'integer', 'min:1', 'max:300'],
        ]);

        if (($data['integration'] ?? null) === 'autogestion') {
            $configuration = $data['autogestion'] ?? [];
            $url = trim((string) (($configuration['base_url'] ?? '') ?: $this->settingValue('integrations.autogestion.base_url', '') ?: config('services.turnos_configuration.url', '')));
            $token = trim((string) (($configuration['token'] ?? '') ?: $this->settingValue('integrations.autogestion.token', '') ?: config('services.turnos_configuration.token', '')));
            $timeout = max(1, min(300, (int) (($configuration['timeout'] ?? null) ?: $this->settingValue('integrations.autogestion.timeout', '') ?: config('services.turnos_configuration.timeout', 15))));
            $startedAt = microtime(true);
            try {
                $response = Http::timeout($timeout)->acceptJson()->withToken($token)->get($url);
                $status = $response->status();
                $payload = $response->json();
                $validStructure = is_array($payload)
                    && is_array($payload['specialties'] ?? null)
                    && is_array($payload['doctors_by_specialty'] ?? null)
                    && is_array($payload['health_insurances'] ?? null);
                $ok = $response->successful() && $validStructure;
                $message = $ok
                    ? 'Configuracion de autogestion valida.'
                    : ($response->successful() ? 'La respuesta no tiene la estructura esperada.' : 'Autogestion rechazo la solicitud.');
            } catch (\Throwable $e) {
                $status = null;
                $ok = false;
                $message = $e->getMessage();
            }
            $result = [
                'integration' => 'autogestion',
                'endpoint' => '/api/configuration',
                'method' => 'GET',
                'ok' => $ok,
                'status' => $status,
                'duration_ms' => (int) round((microtime(true) - $startedAt) * 1000),
                'message' => $message,
            ];
            $this->auditService->record('settings', 'autogestion_integration_tested', 'Probo la integracion de autogestion', $request->user(), null, ['meta' => ['passed' => $ok ? 1 : 0, 'total' => 1]]);

            return response()->json([
                'ok' => $ok,
                'summary' => ['passed' => $ok ? 1 : 0, 'failed' => $ok ? 0 : 1, 'total' => 1],
                'results' => [$result],
            ]);
        }

        if (!empty($data['only_alephoo']) || ($data['integration'] ?? null) === 'alephoo') {
            $startedAt = microtime(true);
            try {
                $testV3 = $data['alephoo_v3'] ?? [];
                $response = Http::timeout(max(1, min(300, (int) (
                    ($testV3['timeout'] ?? null)
                    ?: $this->settingValue('integrations.alephoo_v3.timeout', '')
                    ?: config('services.alephoo_v3.timeout', 30)
                ))))
                    ->accept('application/vnd.api+json')
                    ->withBasicAuth(
                        ($testV3['username'] ?? '') ?: $this->settingValue('integrations.alephoo_v3.username', '') ?: (string) config('services.alephoo_v3.username'),
                        ($testV3['password'] ?? '') ?: $this->settingValue('integrations.alephoo_v3.password', '') ?: (string) config('services.alephoo_v3.password'),
                    )
                    ->get(rtrim(
                        ($testV3['base_url'] ?? '') ?: $this->settingValue('integrations.alephoo_v3.base_url', '') ?: (string) config('services.alephoo_v3.base_url'),
                        '/'
                    ) . '/admision/turnos', [
                        'filter[persona]' => 0,
                        'filter[incluirAdHoc]' => 'false',
                        'filter[nocancelado]' => 'true',
                        'offset' => 0,
                        'sort' => '-fecha,-hora',
                        'limit' => 1,
                    ]);
                $status = $response->status();
                $ok = $response->successful();
                $message = $ok
                    ? 'Alephoo respondio correctamente.'
                    : (in_array($status, [401, 403], true) ? 'Alephoo rechazo las credenciales.' : 'Alephoo devolvio un error.');
            } catch (\Throwable $e) {
                $status = null;
                $ok = false;
                $message = $e->getMessage();
            }

            $result = [
                'integration' => 'alephoo',
                'endpoint' => '/admision/turnos',
                'method' => 'GET',
                'ok' => $ok,
                'status' => $status,
                'duration_ms' => (int) round((microtime(true) - $startedAt) * 1000),
                'message' => $message,
            ];
            $this->auditService->record(
                'settings',
                'alephoo_integration_tested',
                'Probo el endpoint de Alephoo',
                $request->user(),
                null,
                ['meta' => ['passed' => $ok ? 1 : 0, 'total' => 1]],
            );

            return response()->json([
                'ok' => $ok,
                'summary' => ['passed' => $ok ? 1 : 0, 'failed' => $ok ? 0 : 1, 'total' => 1],
                'results' => [$result],
            ]);
        }

        $baseUrl = rtrim((string) ($data['base_url']
            ?: $this->settingValue('integrations.alephoo.base_url', '')
            ?: env('HOSPITAL_PERSON_API_BASE', '')), '/');
        $apiKey = (string) ($data['api_key']
            ?: $this->settingValue('integrations.alephoo.api_key', '')
            ?: env('HOSPITAL_PERSON_API_KEY', ''));
        $rawEndpoints = trim((string) ($data['enabled_endpoints'] ?? ''));
        $endpoints = array_values(array_unique(array_filter(array_map(
            fn ($line) => '/' . ltrim(trim(str_replace('\\', '/', $line)), '/'),
            preg_split('/\r\n|\r|\n/', $rawEndpoints) ?: [],
        ))));

        if ($endpoints === []) {
            $endpoints = [
                '/personas/{dni}',
                '/especialidades',
                '/profesionales/{especialidad}',
                '/turnos/{profesional}/{especialidad}/{dias}',
                '/obrasocial',
                '/planes/{id}',
                '/crear/persona',
                '/crear/turno',
                '/cancelarTurnos/{turno}',
            ];
        }

        $rootUrl = str_ends_with($baseUrl, '/personas') ? substr($baseUrl, 0, -9) : $baseUrl;
        $results = [];
        $sampleSpecialtyId = '0';
        $sampleDoctorId = '0';
        $sampleInsuranceId = '0';

        try {
            $probeClient = Http::timeout((int) $data['timeout'])
                ->acceptJson()
                ->withHeaders(['X-API-KEY' => $apiKey]);
            $specialties = $probeClient->get($rootUrl . '/especialidades');
            $specialtyItems = $specialties->successful() && is_array($specialties->json())
                ? $specialties->json()
                : [];
            $sampleSpecialtyId = (string) data_get($specialtyItems, '0.id', '0');

            $insurances = $probeClient->get($rootUrl . '/obrasocial');
            $insuranceItems = $insurances->successful() && is_array($insurances->json())
                ? $insurances->json()
                : [];
            $sampleInsuranceId = (string) data_get($insuranceItems, '0.id', '0');

            if ($sampleSpecialtyId !== '0') {
                $doctors = $probeClient->get($rootUrl . '/profesionales/' . rawurlencode($sampleSpecialtyId));
                $doctorItems = $doctors->successful() && is_array($doctors->json())
                    ? $doctors->json()
                    : [];
                $sampleDoctorId = (string) data_get($doctorItems, '0.id', '0');
            }
        } catch (\Throwable) {
            // Las pruebas individuales mostraran el problema de conexion o autenticacion.
        }

        foreach ($endpoints as $endpoint) {
            $path = str_replace(
                ['{dni}', '{id}', '{obra_social}', '{especialidad}', '{profesional}', '{dias}', '{turno}'],
                ['0', $sampleInsuranceId, $sampleInsuranceId, $sampleSpecialtyId, $sampleDoctorId, '1', '__integration_test__'],
                $endpoint,
            );
            $isMutation = str_starts_with($endpoint, '/crear/')
                || str_starts_with($endpoint, '/cancelarTurnos/');
            $method = $isMutation ? 'OPTIONS' : 'GET';
            $startedAt = microtime(true);

            try {
                $client = Http::timeout((int) $data['timeout'])
                    ->acceptJson()
                    ->withHeaders(['X-API-KEY' => $apiKey]);
                $response = $isMutation
                    ? $client->send('OPTIONS', $rootUrl . $path)
                    : $client->get($rootUrl . $path);
                $status = $response->status();
                $ok = $status < 500 && !in_array($status, [401, 403], true);
                $message = $isMutation
                    ? 'Ruta verificada sin ejecutar la operacion destructiva.'
                    : ($ok ? 'Endpoint accesible.' : 'El endpoint rechazo la solicitud.');
            } catch (\Throwable $e) {
                $status = null;
                $ok = false;
                $message = $e->getMessage();
            }

            $results[] = [
                'integration' => 'api_turnos',
                'endpoint' => $endpoint,
                'method' => $method,
                'ok' => $ok,
                'status' => $status,
                'duration_ms' => (int) round((microtime(true) - $startedAt) * 1000),
                'message' => $message,
            ];
        }

        $passed = count(array_filter($results, fn ($result) => $result['ok']));
        $this->auditService->record(
            'settings',
            'api_turnos_integration_tested',
            'Probo los endpoints de API Turnos',
            $request->user(),
            null,
            ['meta' => ['passed' => $passed, 'total' => count($results)]],
        );

        return response()->json([
            'ok' => $passed === count($results),
            'summary' => [
                'passed' => $passed,
                'failed' => count($results) - $passed,
                'total' => count($results),
            ],
            'results' => $results,
        ]);
    }

    public function saveBot(Request $request)
    {
        $data = $request->validate([
            'default_flow_id' => ['required', 'integer', 'exists:bot_flows,id'],
            'inactivity_timeout_minutes' => ['required', 'integer', 'min:1', 'max:10080'],
            'inactivity_timeout_message' => ['required', 'string', 'max:2000'],
        ]);

        $beforeDefaultFlow = BotFlow::query()->where('is_default', true)->first();
        $before = [
            'default_flow_id' => $beforeDefaultFlow?->id,
            'default_flow_name' => $beforeDefaultFlow?->name,
            'inactivity_timeout_minutes' => $this->settingValue('bot.inactivity_timeout_minutes', '1440'),
            'inactivity_timeout_message' => $this->settingValue(
                'bot.inactivity_timeout_message',
                'La conversacion se cerro por inactividad. Si queres continuar, escribinos nuevamente y retomamos desde el inicio.'
            ),
        ];

        $flow = BotFlow::query()->findOrFail($data['default_flow_id']);

        if (!$flow->is_active) {
            return response()->json([
                'ok' => false,
                'message' => 'Solo podes seleccionar un flujo activo como flujo por defecto.',
            ], 422);
        }

        \DB::transaction(function () use ($flow, $data) {
            BotFlow::query()->where('is_default', true)->update(['is_default' => false]);
            $flow->update(['is_default' => true]);

            SystemSetting::updateOrCreate(
                ['key' => 'bot.inactivity_timeout_minutes'],
                ['value' => (string) $data['inactivity_timeout_minutes']],
            );

            SystemSetting::updateOrCreate(
                ['key' => 'bot.inactivity_timeout_message'],
                ['value' => trim($data['inactivity_timeout_message'])],
            );
        });

        $after = [
            'default_flow_id' => $flow->id,
            'default_flow_name' => $flow->name,
            'inactivity_timeout_minutes' => (string) $data['inactivity_timeout_minutes'],
            'inactivity_timeout_message' => trim($data['inactivity_timeout_message']),
        ];

        $this->auditService->recordSettingsChange('bot', $before, $after, $request->user());

        return response()->json([
            'ok' => true,
            'settings' => [
                'bot' => [
                    'default_flow_id' => $flow->id,
                    'inactivity_timeout_minutes' => (string) $data['inactivity_timeout_minutes'],
                    'inactivity_timeout_message' => trim($data['inactivity_timeout_message']),
                ],
            ],
        ]);
    }

    public function updateUserRole(Request $request, User $user)
    {
        $data = $request->validate([
            'role_id' => ['required', 'integer', 'exists:roles,id'],
        ]);

        $actor = $request->user();
        $targetRole = Role::query()->findOrFail($data['role_id']);

        if ($actor && (int) $actor->id === (int) $user->id) {
            return response()->json([
                'ok' => false,
                'message' => 'No podes cambiar tu propio rol desde este modulo.',
            ], 422);
        }

        $currentRoleName = $user->roleName();
        $currentRoleLabel = $user->roleLabel();
        $targetRoleName = $targetRole->normalizedName();
        $targetRoleLabel = $targetRole->displayName();

        if ($currentRoleName === 'admin' && $targetRoleName !== 'admin') {
            $adminCount = User::query()
                ->with('role')
                ->get(['id', 'role_id'])
                ->filter(fn (User $candidate) => $candidate->roleName() === 'admin')
                ->count();

            if ($adminCount <= 1) {
                return response()->json([
                    'ok' => false,
                    'message' => 'No podes quitar el ultimo administrador del sistema.',
                ], 422);
            }
        }

        $user->update([
            'role_id' => $targetRole->id,
        ]);

        $user->load('role');

        $this->auditService->recordUserRoleChange(
            $user,
            $currentRoleLabel,
            $targetRoleLabel,
            $actor,
        );

        return response()->json([
            'ok' => true,
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'validated' => (bool) $user->validated,
                'requests_password' => (bool) $user->requestsPassword,
                'role_id' => (int) $user->role_id,
                'role_name' => $user->roleName(),
                'role_label' => $user->roleLabel(),
            ],
        ]);
    }

    public function exportConfiguration(Request $request)
    {
        $payload = $this->configurationExportPayload($request);
        $filename = 'config-export-' . now()->format('Y-m-d_His') . '.json';

        $this->auditService->recordConfigurationExport($request->user(), [
            'filename' => $filename,
            'flows_count' => count($payload['bot_flows'] ?? []),
        ]);

        return response()->streamDownload(function () use ($payload) {
            echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }, $filename, [
            'Content-Type' => 'application/json; charset=UTF-8',
        ]);
    }

    public function importConfiguration(Request $request)
    {
        $data = $request->validate([
            'file' => ['required', 'file', 'mimetypes:application/json,text/plain', 'max:5120'],
        ]);

        $contents = File::get($data['file']->getRealPath());

        try {
            $payload = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw ValidationException::withMessages([
                'file' => 'El archivo seleccionado no contiene un JSON valido.',
            ]);
        }

        if (!is_array($payload) || !isset($payload['settings']) || !isset($payload['bot_flows'])) {
            throw ValidationException::withMessages([
                'file' => 'El archivo no tiene el formato esperado para una exportacion de configuracion.',
            ]);
        }

        $summary = DB::transaction(function () use ($payload) {
            return [
                'settings' => $this->importSettings($payload['settings'] ?? []),
                'flows' => $this->importFlows($payload['bot_flows'] ?? []),
            ];
        });

        $this->auditService->recordConfigurationImport($request->user(), [
            'settings_imported' => $summary['settings']['imported'] ?? 0,
            'flows_processed' => $summary['flows']['processed'] ?? 0,
        ]);

        return response()->json([
            'ok' => true,
            'message' => 'La configuracion se importo correctamente. Se recomienda recargar la pantalla.',
            'summary' => $summary,
        ]);
    }

    protected function resolveCurrentUserId(Request $request): ?int
    {
        return $request->user()?->id ? (int) $request->user()->id : null;
    }

    protected function configurationExportPayload(Request $request): array
    {
        $settings = SystemSetting::query()
            ->orderBy('key')
            ->pluck('value', 'key');

        $flows = BotFlow::query()
            ->with(['nodes' => fn ($query) => $query->orderBy('id')])
            ->orderBy('id')
            ->get();

        return [
            'exported_at' => now()->toIso8601String(),
            'exported_by' => [
                'id' => $request->user()?->id,
                'name' => $request->user()?->name,
                'email' => $request->user()?->email,
            ],
            'settings' => $settings,
            'bot_flows' => $flows->map(fn (BotFlow $flow) => [
                'id' => $flow->id,
                'name' => $flow->name,
                'description' => $flow->description,
                'is_active' => (bool) $flow->is_active,
                'is_default' => (bool) $flow->is_default,
                'start_node_id' => $flow->start_node_id,
                'nodes' => $flow->nodes->map(fn (BotNode $node) => [
                    'id' => $node->id,
                    'key' => $node->key,
                    'type' => $node->type,
                    'body' => $node->body,
                    'settings' => $node->settings ?? [],
                    'next_node_id' => $node->next_node_id,
                ])->values()->all(),
            ])->values()->all(),
        ];
    }

    protected function importSettings(array $settings): array
    {
        $allowedPrefixes = ['general.', 'integrations.', 'bot.'];
        $imported = 0;

        foreach ($settings as $key => $value) {
            $key = trim((string) $key);

            if ($key === '') {
                continue;
            }

            $allowed = collect($allowedPrefixes)->contains(fn (string $prefix) => str_starts_with($key, $prefix));

            if (!$allowed) {
                continue;
            }

            SystemSetting::updateOrCreate(
                ['key' => $key],
                ['value' => is_scalar($value) || $value === null ? (string) ($value ?? '') : json_encode($value)],
            );

            $imported++;
        }

        return [
            'imported' => $imported,
        ];
    }

    protected function importFlows(array $flows): array
    {
        $processed = 0;
        $importedDefaultFlowName = null;

        foreach ($flows as $candidateFlow) {
            if (!empty($candidateFlow['is_default'])) {
                $importedDefaultFlowName = trim((string) ($candidateFlow['name'] ?? ''));
                break;
            }
        }

        foreach ($flows as $flowData) {
            $name = trim((string) ($flowData['name'] ?? ''));

            if ($name === '') {
                continue;
            }

            $flow = BotFlow::query()->withTrashed()->where('name', $name)->first();

            if ($flow) {
                if ($flow->trashed()) {
                    $flow->restore();
                }

                $flow->update([
                    'description' => $flowData['description'] ?? null,
                    'start_node_id' => null,
                    'is_active' => (bool) ($flowData['is_active'] ?? true),
                    'is_default' => false,
                ]);
            } else {
                $flow = BotFlow::query()->create([
                    'name' => $name,
                    'description' => $flowData['description'] ?? null,
                    'start_node_id' => null,
                    'is_active' => (bool) ($flowData['is_active'] ?? true),
                    'is_default' => false,
                ]);
            }

            BotNode::query()->withTrashed()->where('flow_id', $flow->id)->forceDelete();

            $idMap = [];
            $nodes = is_array($flowData['nodes'] ?? null) ? $flowData['nodes'] : [];

            foreach ($nodes as $nodeData) {
                $originalNodeId = isset($nodeData['id']) ? (int) $nodeData['id'] : null;

                $node = BotNode::query()->create([
                    'flow_id' => $flow->id,
                    'key' => $nodeData['key'] ?? null,
                    'type' => $nodeData['type'] ?? 'text',
                    'body' => $nodeData['body'] ?? null,
                    'settings' => [],
                    'next_node_id' => null,
                ]);

                if ($originalNodeId) {
                    $idMap[$originalNodeId] = $node->id;
                }
            }

            $newNodes = BotNode::query()->where('flow_id', $flow->id)->orderBy('id')->get()->values();

            foreach ($nodes as $index => $nodeData) {
                $node = $newNodes[$index] ?? null;

                if (!$node) {
                    continue;
                }

                $node->update([
                    'settings' => $this->remapNodeReferences($nodeData['settings'] ?? [], $idMap),
                    'next_node_id' => $this->mappedNodeId($nodeData['next_node_id'] ?? null, $idMap),
                ]);
            }

            $flow->update([
                'start_node_id' => $this->mappedNodeId($flowData['start_node_id'] ?? null, $idMap),
                'is_default' => $importedDefaultFlowName !== null && $name === $importedDefaultFlowName,
            ]);

            $processed++;
        }

        if ($importedDefaultFlowName !== null) {
            BotFlow::query()
                ->where('name', '!=', $importedDefaultFlowName)
                ->update(['is_default' => false]);
        }

        return [
            'processed' => $processed,
        ];
    }

    protected function remapNodeReferences(mixed $value, array $idMap): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        $keysToMap = ['next_node_id', 'error_next_node_id', 'not_found_next_node_id'];
        $result = [];

        foreach ($value as $key => $item) {
            if (in_array((string) $key, $keysToMap, true)) {
                $result[$key] = $this->mappedNodeId($item, $idMap);
                continue;
            }

            $result[$key] = is_array($item) ? $this->remapNodeReferences($item, $idMap) : $item;
        }

        return $result;
    }

    protected function mappedNodeId(mixed $originalId, array $idMap): ?int
    {
        $originalId = (int) ($originalId ?? 0);

        if ($originalId <= 0) {
            return null;
        }

        return $idMap[$originalId] ?? null;
    }

    protected function settingValue(string $key, string $default = ''): string
    {
        return (string) (SystemSetting::query()->where('key', $key)->value('value') ?? $default);
    }
}
