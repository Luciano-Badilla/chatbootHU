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
                'integrations.whatsapp.phone_number_id',
                'integrations.whatsapp.webhook_verify_token',
                'integrations.alephoo.base_url',
                'integrations.alephoo.api_key',
                'integrations.alephoo.timeout',
                'integrations.alephoo.enabled_endpoints',
                'bot.inactivity_timeout_minutes',
                'bot.inactivity_timeout_message',
            ])
            ->pluck('value', 'key');

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
            'whatsapp.phone_number_id' => ['nullable', 'string'],
            'whatsapp.webhook_verify_token' => ['nullable', 'string'],
            'alephoo.base_url' => ['nullable', 'url'],
            'alephoo.api_key' => ['nullable', 'string'],
            'alephoo.timeout' => ['required', 'integer', 'min:1', 'max:300'],
            'alephoo.enabled_endpoints' => ['nullable', 'string'],
        ]);

        $before = [
            'whatsapp' => [
                'token' => $this->settingValue('integrations.whatsapp.token', ''),
                'phone_number_id' => $this->settingValue('integrations.whatsapp.phone_number_id', ''),
                'webhook_verify_token' => $this->settingValue('integrations.whatsapp.webhook_verify_token', ''),
            ],
            'alephoo' => [
                'base_url' => $this->settingValue('integrations.alephoo.base_url', ''),
                'api_key' => $this->settingValue('integrations.alephoo.api_key', ''),
                'timeout' => $this->settingValue('integrations.alephoo.timeout', '30'),
                'enabled_endpoints' => $this->settingValue('integrations.alephoo.enabled_endpoints', ''),
            ],
        ];

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

        $after = [
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
        ];

        $this->auditService->recordSettingsChange('integrations', $before, $after, $request->user());

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
