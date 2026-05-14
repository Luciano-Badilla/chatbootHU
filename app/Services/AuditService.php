<?php

namespace App\Services;

use App\Models\Chat;
use App\Models\BotFlow;
use App\Models\BotNode;
use App\Models\Message;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;

class AuditService
{
    protected const FIELD_LABELS = [
        'timezone' => 'Zona horaria',
        'language' => 'Idioma',
        'whatsapp.token' => 'Token de WhatsApp',
        'whatsapp.phone_number_id' => 'Phone number ID',
        'whatsapp.webhook_verify_token' => 'Webhook verify token',
        'alephoo.base_url' => 'Base URL de Alephoo',
        'alephoo.api_key' => 'API key de Alephoo',
        'alephoo.timeout' => 'Timeout de Alephoo',
        'alephoo.enabled_endpoints' => 'Endpoints habilitados',
        'default_flow_id' => 'Flujo por defecto',
        'default_flow_name' => 'Nombre del flujo por defecto',
        'inactivity_timeout_minutes' => 'Tiempo de inactividad',
        'inactivity_timeout_message' => 'Mensaje de inactividad',
        'role' => 'Rol',
        'bot_enabled' => 'Bot activo',
        'operator_name' => 'Operador asignado',
        'mode' => 'Modo de apertura',
        'read_messages_count' => 'Mensajes marcados como leidos',
        'message_type' => 'Tipo de mensaje',
        'body_preview' => 'Mensaje',
        'file_name' => 'Archivo',
        'file_size' => 'Tamano del archivo',
        'caption_preview' => 'Descripcion',
        'error' => 'Error',
        'flow_id' => 'ID del flujo',
        'flow_name' => 'Flujo',
        'name' => 'Nombre',
        'description' => 'Descripcion',
        'is_active' => 'Activo',
        'is_default' => 'Flujo por defecto',
        'start_node_id' => 'Nodo inicial',
        'start_node_key' => 'Clave del nodo inicial',
        'node_id' => 'ID del nodo',
        'node_key' => 'Clave del nodo',
        'key' => 'Clave',
        'type' => 'Tipo',
        'body' => 'Contenido',
        'settings' => 'Configuracion del nodo',
        'settings.auto_advance' => 'Auto-disparar siguiente mensaje',
        'settings.auto_advance_delay_ms' => 'Demora del auto-disparo',
        'settings.auto_advance_max_hops' => 'Maximo de saltos automaticos',
        'settings.canvas_position' => 'Posicion en canvas',
        'settings.variable' => 'Variable capturada',
        'settings.validation_regex' => 'Regex de validacion',
        'settings.error_message' => 'Mensaje de error',
        'settings.button_text' => 'Texto del boton de lista',
        'settings.section_title' => 'Titulo de la seccion',
        'settings.dni_variable' => 'Variable con DNI',
        'settings.not_found_message' => 'Mensaje si no se encuentra',
        'settings.not_found_next_node_id' => 'Siguiente nodo si no se encuentra',
        'settings.error_next_node_id' => 'Siguiente nodo si hay error',
        'next_node_id' => 'Siguiente nodo',
        'next_node_key' => 'Siguiente nodo',
        'deleted_nodes_count' => 'Nodos eliminados',
        'replacement_default_flow_id' => 'Flujo por defecto reemplazante',
        'replacement_node_id' => 'Nodo reemplazante',
        'deleted_at' => 'Fecha de eliminacion',
    ];

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

        $properties = $this->presentProperties($logName, $event, $properties);

        $entry
            ->event($event)
            ->withProperties($properties)
            ->log($description);
    }

    public function presentProperties(string $logName, ?string $event, array $properties): array
    {
        if (in_array($logName, ['flows', 'bot_flows'], true) || !array_key_exists('changes_human', $properties)) {
            $properties['changes_human'] = $this->buildHumanChanges($logName, $event, $properties);
        }

        return $properties;
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
                'changed_keys' => $this->changedKeysForAudit($before, $after),
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

    public function recordChatAction(
        string $event,
        string $description,
        Chat $chat,
        ?User $actor = null,
        array $properties = []
    ): void {
        $this->record(
            'chat',
            $event,
            $description,
            $actor,
            $chat,
            array_merge([
                'chat' => $this->chatContext($chat),
            ], $properties),
        );
    }

    public function recordMessageAction(
        string $event,
        string $description,
        Chat $chat,
        ?User $actor = null,
        ?Message $message = null,
        array $properties = []
    ): void {
        $subject = $message ?? $chat;

        $this->record(
            'messages',
            $event,
            $description,
            $actor,
            $subject,
            array_merge([
                'chat' => $this->chatContext($chat),
            ], $properties),
        );
    }

    public function recordFlowAction(
        string $event,
        string $description,
        BotFlow $flow,
        ?User $actor = null,
        array $properties = []
    ): void {
        $this->record(
            'flows',
            $event,
            $description,
            $actor,
            $flow,
            array_merge([
                'flow' => $this->flowContext($flow),
            ], $properties),
        );
    }

    public function recordFlowChange(
        string $event,
        string $description,
        BotFlow $flow,
        array $before,
        array $after,
        ?User $actor = null,
        array $properties = []
    ): void {
        $changedKeys = $this->changedKeysForAudit($before, $after);

        if (empty($changedKeys) && empty($properties['meta'] ?? [])) {
            return;
        }

        $this->recordFlowAction(
            $event,
            $description,
            $flow,
            $actor,
            array_merge([
                'changed_keys' => $changedKeys,
                'before' => $this->sanitizeForAudit($before),
                'after' => $this->sanitizeForAudit($after),
            ], $properties),
        );
    }

    public function recordNodeAction(
        string $event,
        string $description,
        BotNode $node,
        ?User $actor = null,
        array $properties = []
    ): void {
        $node->loadMissing(['flow', 'nextNode']);

        $this->record(
            'flows',
            $event,
            $description,
            $actor,
            $node,
            array_merge([
                'flow' => $node->flow ? $this->flowContext($node->flow) : null,
                'node' => $this->nodeContext($node),
            ], $properties),
        );
    }

    public function recordNodeChange(
        string $event,
        string $description,
        BotNode $node,
        array $before,
        array $after,
        ?User $actor = null,
        array $properties = []
    ): void {
        $changedKeys = $this->changedKeysForAudit($before, $after);

        if (empty($changedKeys) && empty($properties['meta'] ?? [])) {
            return;
        }

        $this->recordNodeAction(
            $event,
            $description,
            $node,
            $actor,
            array_merge([
                'changed_keys' => $changedKeys,
                'before' => $this->sanitizeForAudit($before),
                'after' => $this->sanitizeForAudit($after),
            ], $properties),
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

    protected function changedKeysForAudit(array $before, array $after): array
    {
        $keys = [];

        foreach ($this->changedKeys($before, $after) as $key) {
            if (in_array($key, ['start_node_key', 'next_node_key'], true)) {
                continue;
            }

            if ($key === 'settings.canvas_position'
                || str_starts_with($key, 'settings.canvas_position.')
            ) {
                continue;
            }

            $keys[] = $key;
        }

        return array_values(array_unique($keys));
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

    protected function chatContext(Chat $chat): array
    {
        $chat->loadMissing(['contact:id,name,whatsapp_id', 'operator:id,name,email']);

        return [
            'id' => $chat->id,
            'contact_name' => $chat->contact?->name,
            'contact_number' => $chat->contact?->whatsapp_id,
            'bot_enabled' => (bool) $chat->bot_enabled,
            'operator_id' => $chat->operator_id,
            'operator_name' => $chat->operator?->name,
        ];
    }

    protected function flowContext(BotFlow $flow): array
    {
        return [
            'id' => $flow->id,
            'name' => $flow->name,
            'is_active' => (bool) $flow->is_active,
            'is_default' => (bool) $flow->is_default,
            'start_node_id' => $flow->start_node_id,
        ];
    }

    protected function nodeContext(BotNode $node): array
    {
        return [
            'id' => $node->id,
            'flow_id' => $node->flow_id,
            'flow_name' => $node->flow?->name,
            'key' => $node->key,
            'type' => $node->type,
            'next_node_id' => $node->next_node_id,
            'next_node_key' => $node->nextNode?->key,
        ];
    }

    protected function buildHumanChanges(string $logName, ?string $event, array $properties): array
    {
        return match ($logName) {
            'settings', 'users' => $this->buildGenericHumanChanges($properties),
            'chat', 'messages' => $this->buildChatHumanChanges($event, $properties),
            'flows', 'bot_flows' => $this->buildFlowHumanChanges($properties),
            default => [],
        };
    }

    protected function buildFlowHumanChanges(array $properties): array
    {
        $before = $this->flattenForAudit(is_array($properties['before'] ?? null) ? $properties['before'] : []);
        $after = $this->flattenForAudit(is_array($properties['after'] ?? null) ? $properties['after'] : []);
        $keys = $properties['changed_keys'] ?? array_values(array_unique(array_merge(array_keys($before), array_keys($after))));
        $changes = [];

        foreach ($keys as $key) {
            $key = (string) $key;

            if (in_array($key, ['start_node_key', 'next_node_key'], true)) {
                continue;
            }

            if ($key === 'start_node_id') {
                $changes[] = [
                    'key' => $key,
                    'label' => $this->fieldLabel($key),
                    'before' => $this->formatNodeReference($before['start_node_key'] ?? null, $before['start_node_id'] ?? null, 'Sin nodo inicial'),
                    'after' => $this->formatNodeReference($after['start_node_key'] ?? null, $after['start_node_id'] ?? null, 'Sin nodo inicial'),
                ];
                continue;
            }

            if ($key === 'next_node_id') {
                $changes[] = [
                    'key' => $key,
                    'label' => $this->fieldLabel($key),
                    'before' => $this->formatNodeReference($before['next_node_key'] ?? null, $before['next_node_id'] ?? null, 'Sin conexion'),
                    'after' => $this->formatNodeReference($after['next_node_key'] ?? null, $after['next_node_id'] ?? null, 'Sin conexion'),
                ];
                continue;
            }

            if ($key === 'settings.canvas_position') {
                $changes[] = [
                    'key' => $key,
                    'label' => $this->fieldLabel($key),
                    'before' => $this->formatCanvasPosition($before),
                    'after' => $this->formatCanvasPosition($after),
                ];
                continue;
            }

            if ($this->isNodeReferenceKey($key)) {
                $changes[] = [
                    'key' => $key,
                    'label' => $this->fieldLabel($key),
                    'before' => $this->formatNodeReference(null, $before[$key] ?? null, 'Finalizar flujo'),
                    'after' => $this->formatNodeReference(null, $after[$key] ?? null, 'Finalizar flujo'),
                ];
                continue;
            }

            $changes[] = [
                'key' => $key,
                'label' => $this->fieldLabel($key),
                'before' => $this->formatAuditValue($before[$key] ?? null, $key),
                'after' => $this->formatAuditValue($after[$key] ?? null, $key),
            ];
        }

        return array_values(array_filter($changes, fn (array $change) => $change['before'] !== $change['after']));
    }

    protected function buildGenericHumanChanges(array $properties): array
    {
        $before = $this->flattenForAudit(is_array($properties['before'] ?? null) ? $properties['before'] : []);
        $after = $this->flattenForAudit(is_array($properties['after'] ?? null) ? $properties['after'] : []);
        $keys = $properties['changed_keys'] ?? array_values(array_unique(array_merge(array_keys($before), array_keys($after))));
        $changes = [];

        foreach ($keys as $key) {
            $key = (string) $key;
            $changes[] = [
                'key' => $key,
                'label' => $this->fieldLabel($key),
                'before' => $this->formatAuditValue($before[$key] ?? null, $key),
                'after' => $this->formatAuditValue($after[$key] ?? null, $key),
            ];
        }

        return array_values(array_filter($changes, fn (array $change) => $change['before'] !== $change['after']));
    }

    protected function buildChatHumanChanges(?string $event, array $properties): array
    {
        $before = is_array($properties['before'] ?? null) ? $properties['before'] : [];
        $after = is_array($properties['after'] ?? null) ? $properties['after'] : [];
        $meta = is_array($properties['meta'] ?? null) ? $properties['meta'] : [];

        return match ($event) {
            'opened' => [
                $this->valueChange('mode', $this->formatOpenMode($meta['mode'] ?? null)),
            ],
            'marked_read' => [
                $this->valueChange('read_messages_count', $meta['read_messages_count'] ?? null),
            ],
            'operator_assigned', 'operator_released', 'operator_assignment_conflict' => array_values(array_filter([
                $this->beforeAfterChange(
                    'operator_name',
                    $before['operator_name'] ?? null,
                    $after['operator_name'] ?? null,
                ),
                $event === 'operator_assignment_conflict'
                    ? $this->valueChange('mode', 'Chat ocupado por otro operador')
                    : null,
            ])),
            'bot_enabled', 'bot_disabled' => [
                $this->beforeAfterChange(
                    'bot_enabled',
                    $before['bot_enabled'] ?? null,
                    $after['bot_enabled'] ?? null,
                ),
            ],
            'message_sent' => array_values(array_filter([
                $this->valueChange('message_type', $meta['message_type'] ?? null),
                $this->valueChange('body_preview', $meta['body_preview'] ?? null),
            ])),
            'media_sent' => array_values(array_filter([
                $this->valueChange('message_type', $meta['message_type'] ?? null),
                $this->valueChange('file_name', $meta['file_name'] ?? null),
                $this->valueChange('file_size', $meta['file_size'] ?? null),
                $this->valueChange('caption_preview', $meta['caption_preview'] ?? null),
            ])),
            'message_send_failed', 'media_send_failed' => array_values(array_filter([
                $this->valueChange('message_type', $meta['message_type'] ?? null),
                $this->valueChange('body_preview', $meta['body_preview'] ?? null),
                $this->valueChange('file_name', $meta['file_name'] ?? null),
                $this->valueChange('error', $meta['error'] ?? null),
            ])),
            default => $this->buildGenericHumanChanges($properties),
        };
    }

    protected function beforeAfterChange(string $key, mixed $before, mixed $after): ?array
    {
        $formattedBefore = $this->formatAuditValue($before, $key);
        $formattedAfter = $this->formatAuditValue($after, $key);

        if ($formattedBefore === $formattedAfter) {
            return null;
        }

        return [
            'key' => $key,
            'label' => $this->fieldLabel($key),
            'before' => $formattedBefore,
            'after' => $formattedAfter,
        ];
    }

    protected function valueChange(string $key, mixed $value): ?array
    {
        $formatted = $this->formatAuditValue($value, $key);

        if ($formatted === null || $formatted === '') {
            return null;
        }

        return [
            'key' => $key,
            'label' => $this->fieldLabel($key),
            'value' => $formatted,
        ];
    }

    protected function flattenForAudit(array $data, string $prefix = ''): array
    {
        $flat = [];

        foreach ($data as $key => $value) {
            $dotKey = $prefix !== '' ? "{$prefix}.{$key}" : (string) $key;

            if (is_array($value)) {
                foreach ($this->flattenForAudit($value, $dotKey) as $nestedKey => $nestedValue) {
                    $flat[$nestedKey] = $nestedValue;
                }
                continue;
            }

            $flat[$dotKey] = $value;
        }

        return $flat;
    }

    protected function fieldLabel(string $key): string
    {
        if (isset(self::FIELD_LABELS[$key])) {
            return self::FIELD_LABELS[$key];
        }

        if (preg_match('/^settings\.buttons\.(\d+)\.(.+)$/', $key, $matches)) {
            return 'Boton ' . ((int) $matches[1] + 1) . ' - ' . $this->fieldLabel($matches[2]);
        }

        if (preg_match('/^settings\.rows\.(\d+)\.(.+)$/', $key, $matches)) {
            return 'Opcion ' . ((int) $matches[1] + 1) . ' - ' . $this->fieldLabel($matches[2]);
        }

        $labels = [
            'id' => 'ID interno',
            'title' => 'Texto',
            'description' => 'Descripcion',
            'next_node_id' => 'Siguiente nodo',
            'x' => 'X',
            'y' => 'Y',
        ];

        return $labels[$key] ?? str_replace('_', ' ', str_replace('.', ' - ', $key));
    }

    protected function formatAuditValue(mixed $value, string $key = ''): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_bool($value)) {
            return $value ? 'Si' : 'No';
        }

        if ($key === 'message_type') {
            return match ((string) $value) {
                'text' => 'Texto',
                'image' => 'Imagen',
                'video' => 'Video',
                'audio' => 'Audio',
                'document' => 'Documento',
                default => (string) $value,
            };
        }

        if ($key === 'mode') {
            return $this->formatOpenMode($value);
        }

        if ($this->isNodeIdKey($key)) {
            return $this->formatNodeReference(null, $value, 'Sin nodo');
        }

        if ($this->isFlowIdKey($key)) {
            return $this->formatFlowReference($value);
        }

        if ($key === 'file_size' && is_numeric($value)) {
            $bytes = (int) $value;
            if ($bytes < 1024) {
                return "{$bytes} B";
            }
            if ($bytes < 1048576) {
                return round($bytes / 1024, 1) . ' KB';
            }

            return round($bytes / 1048576, 1) . ' MB';
        }

        if ($key === 'type') {
            return match ((string) $value) {
                'text' => 'Texto',
                'buttons' => 'Botones',
                'list' => 'Lista',
                'input' => 'Captura de dato',
                'handoff' => 'Derivar a operador',
                'person_lookup' => 'Consulta de persona',
                default => (string) $value,
            };
        }

        if (is_array($value)) {
            return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }

        return (string) $value;
    }

    protected function formatOpenMode(mixed $mode): ?string
    {
        return match ((string) $mode) {
            'editable' => 'Edicion habilitada',
            'bot_enabled' => 'Solo lectura por bot activo',
            'operator_locked' => 'Solo lectura por otro operador',
            default => $mode !== null ? (string) $mode : null,
        };
    }

    protected function formatNodeReference(mixed $key, mixed $id, string $emptyLabel): string
    {
        $key = trim((string) ($key ?? ''));

        if ($key !== '') {
            return $key;
        }

        if ($id !== null && $id !== '') {
            $node = BotNode::withTrashed()->find((int) $id);

            if ($node) {
                return $node->key ?: "node_{$node->id}";
            }

            return "Nodo #{$id}";
        }

        return $emptyLabel;
    }

    protected function isNodeReferenceKey(string $key): bool
    {
        return str_ends_with($key, 'next_node_id') || $key === 'start_node_id';
    }

    protected function isNodeIdKey(string $key): bool
    {
        return $key === 'node_id'
            || $key === 'start_node_id'
            || $key === 'next_node_id'
            || str_ends_with($key, '_node_id');
    }

    protected function isFlowIdKey(string $key): bool
    {
        return $key === 'flow_id'
            || $key === 'default_flow_id'
            || $key === 'replacement_default_flow_id'
            || str_ends_with($key, '_flow_id');
    }

    protected function formatFlowReference(mixed $id): ?string
    {
        if ($id === null || $id === '') {
            return null;
        }

        $flow = BotFlow::withTrashed()->find((int) $id);

        if ($flow) {
            return $flow->name ?: "Flujo #{$flow->id}";
        }

        return "Flujo #{$id}";
    }

    protected function formatCanvasPosition(array $flat): ?string
    {
        $x = $flat['settings.canvas_position.x'] ?? null;
        $y = $flat['settings.canvas_position.y'] ?? null;

        if ($x === null && $y === null) {
            return null;
        }

        return 'X: ' . ($x ?? '-') . ', Y: ' . ($y ?? '-');
    }
}
