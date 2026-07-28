<?php

namespace App\Http\Controllers;


use App\Models\BotFlow;
use App\Models\BotNode;
use App\Models\Chat;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Inertia\Inertia;

class BotFlowController extends Controller
{
    public function __construct(private readonly AuditService $auditService)
    {
    }

    public function index(Request $request)
    {
        $flows = BotFlow::orderBy('id')->get();

        return Inertia::render('BotFlowBuilder', [
            'flows' => $flows,
            'readOnly' => !$request->user()?->hasPermission('can_manage_flows'),
        ]);
    }

    public function setStartNode(Request $request, BotFlow $flow)
    {
        $data = $request->validate([
            'start_node_id' => 'nullable|integer',
        ]);

        if (!empty($data['start_node_id'])) {
            $exists = BotNode::where('flow_id', $flow->id)
                ->where('id', $data['start_node_id'])
                ->exists();

            if (!$exists) {
                return response()->json([
                    'ok' => false,
                    'message' => 'El nodo no pertenece a este flujo.',
                ], 422);
            }
        }

        $before = $this->flowAuditSnapshot($flow);

        $flow->start_node_id = $data['start_node_id'] ?? null;
        $flow->save();

        $this->auditService->recordFlowChange(
            'start_node_updated',
            "Actualizo nodo inicial de {$flow->name}",
            $flow,
            $before,
            $this->flowAuditSnapshot($flow->fresh(['startNode'])),
            $request->user(),
        );

        return response()->json([
            'ok' => true,
            'flow' => $flow,
        ]);
    }

    public function apiIndex()
    {
        return response()->json([
            'flows' => BotFlow::orderBy('id')->get(),
        ]);
    }

    public function trash()
    {
        $trashedFlows = BotFlow::onlyTrashed()
            ->orderByDesc('deleted_at')
            ->get();

        $trashedNodes = BotNode::onlyTrashed()
            ->with(['flow' => function ($query) {
                $query->withTrashed();
            }])
            ->orderByDesc('deleted_at')
            ->get()
            ->map(function (BotNode $node) {
                return [
                    'id' => $node->id,
                    'flow_id' => $node->flow_id,
                    'flow_name' => $node->flow?->name,
                    'key' => $node->key,
                    'type' => $node->type,
                    'deleted_at' => $node->deleted_at,
                ];
            })
            ->values();

        return response()->json([
            'flows' => $trashedFlows,
            'nodes' => $trashedNodes,
        ]);
    }


    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => 'required|string',
        ]);

        $flow = BotFlow::create([
            'name' => $data['name'],
            'description' => null,
            'is_active' => true,
        ]);

        $this->auditService->recordFlowChange(
            'created',
            "Creo flujo {$flow->name}",
            $flow,
            [],
            $this->flowAuditSnapshot($flow),
            $request->user(),
        );

        return response()->json($flow, 201);
    }

    public function updateFlow(Request $request, BotFlow $flow)
    {
        $data = $request->validate([
            'name' => 'required|string',
            'description' => 'nullable|string',
        ]);

        $before = $this->flowAuditSnapshot($flow);

        $flow->update([
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
        ]);

        $this->auditService->recordFlowChange(
            'updated',
            "Actualizo flujo {$flow->name}",
            $flow,
            $before,
            $this->flowAuditSnapshot($flow->fresh(['startNode'])),
            $request->user(),
        );

        return response()->json([
            'ok' => true,
            'flow' => $flow->fresh(),
        ]);
    }

    public function nodes(BotFlow $flow)
    {
        return response()->json([
            'nodes' => $flow->nodes()->orderBy('id')->get(),
        ]);
    }

    public function storeNode(Request $request, BotFlow $flow)
    {
        $data = $request->validate([
            'key' => 'nullable|string',
            'type' => 'required|string',
            'body' => 'nullable|string',
            'settings' => 'nullable|array',
        ]);

        $node = BotNode::create([
            'flow_id' => $flow->id,
            'key' => $data['key'] ?? null,
            'type' => $data['type'],
            'body' => $data['body'] ?? null,
            'settings' => $data['settings'] ?? [],
        ]);

        $startNodeBefore = $flow->start_node_id;

        // Si el flujo no tiene start_node_id, lo ponemos
        if (!$flow->start_node_id) {
            $flow->start_node_id = $node->id;
            $flow->save();
        }

        $this->auditService->recordNodeChange(
            'node_created',
            "Creo nodo en {$flow->name}",
            $node,
            [],
            $this->nodeAuditSnapshot($node->fresh(['flow'])),
            $request->user(),
            [
                'meta' => [
                    'flow_start_node_before' => $startNodeBefore,
                    'flow_start_node_after' => $flow->start_node_id,
                ],
            ],
        );

        return response()->json($node, 201);
    }

    public function uploadMedia(Request $request)
    {
        $data = $request->validate([
            'file' => 'required|file|max:102400',
            'media_kind' => 'required|in:image,document,video,audio',
        ]);

        $file = $request->file('file');
        $kind = $data['media_kind'];
        $mime = strtolower((string) ($file->getMimeType() ?? ''));
        $extension = strtolower((string) ($file->getClientOriginalExtension() ?: pathinfo((string) $file->getClientOriginalName(), PATHINFO_EXTENSION)));
        $allowedMimes = match ($kind) {
            'image' => ['image/jpeg', 'image/png', 'image/webp'],
            'video' => ['video/mp4', 'video/3gpp'],
            'audio' => ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg', 'audio/opus'],
            'document' => [
                'text/plain',
                'application/pdf',
                'application/msword',
                'application/vnd.ms-excel',
                'application/vnd.ms-powerpoint',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            ],
            default => [],
        };
        $allowedExtensions = match ($kind) {
            'image' => ['jpg', 'jpeg', 'png', 'webp'],
            'video' => ['mp4', '3gp'],
            'audio' => ['aac', 'm4a', 'mp3', 'amr', 'ogg', 'opus'],
            'document' => ['txt', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
            default => [],
        };
        $maxBytes = match ($kind) {
            'image' => 5 * 1024 * 1024,
            'video', 'audio' => 16 * 1024 * 1024,
            'document' => 100 * 1024 * 1024,
            default => 0,
        };

        if ($maxBytes > 0 && (int) $file->getSize() > $maxBytes) {
            return response()->json([
                'message' => match ($kind) {
                    'image' => 'La imagen supera el limite de WhatsApp. Usá un archivo de hasta 5 MB.',
                    'video' => 'El video supera el limite de WhatsApp. Usá un archivo de hasta 16 MB.',
                    'audio' => 'El audio supera el limite de WhatsApp. Usá un archivo de hasta 16 MB.',
                    'document' => 'El documento supera el limite de WhatsApp. Usá un archivo de hasta 100 MB.',
                    default => 'El archivo supera el limite permitido por WhatsApp.',
                },
                'size' => $file->getSize(),
                'max_size' => $maxBytes,
            ], 422);
        }

        if (
            $allowedMimes
            && !in_array($mime, $allowedMimes, true)
            && !in_array($extension, $allowedExtensions, true)
        ) {
            return response()->json([
                'message' => match ($kind) {
                    'image' => 'Formato de imagen no compatible con WhatsApp. Usá JPG, PNG o WEBP.',
                    'video' => 'Formato de video no compatible con WhatsApp. Usá MP4 o 3GP.',
                    'audio' => 'Formato de audio no compatible con WhatsApp. Usá AAC, M4A, MP3, AMR, OGG u OPUS.',
                    'document' => 'Formato de documento no compatible con WhatsApp. Usá PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX o TXT.',
                    default => 'Formato no compatible con WhatsApp.',
                },
                'mime' => $mime,
                'extension' => $extension,
                'allowed_extensions' => $allowedExtensions,
            ], 422);
        }

        if ($allowedExtensions && $extension !== '' && !in_array($extension, $allowedExtensions, true)) {
            return response()->json([
                'message' => match ($kind) {
                    'image' => 'Formato de imagen no compatible con WhatsApp. Usá JPG, PNG o WEBP.',
                    'video' => 'Formato de video no compatible con WhatsApp. Usá MP4 o 3GP.',
                    'audio' => 'Formato de audio no compatible con WhatsApp. Usá AAC, M4A, MP3, AMR, OGG u OPUS.',
                    'document' => 'Formato de documento no compatible con WhatsApp. Usá PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX o TXT.',
                    default => 'Formato no compatible con WhatsApp.',
                },
                'mime' => $mime,
                'extension' => $extension,
                'allowed_extensions' => $allowedExtensions,
            ], 422);
        }

        $originalName = (string) ($file->getClientOriginalName() ?? ('media_' . uniqid()));
        $safeName = preg_replace('/[^A-Za-z0-9._-]/', '_', $originalName) ?: ('media_' . uniqid());
        $storedName = uniqid($kind . '_') . '_' . $safeName;
        $path = $file->storeAs("bot-media/{$kind}", $storedName, 'public');

        $this->auditService->record(
            'flows',
            'media_uploaded',
            "Subio un archivo {$kind} para flujos",
            $request->user(),
            null,
            [
                'meta' => [
                    'file_name' => $originalName,
                    'media_kind' => $kind,
                    'file_size' => $file->getSize(),
                    'mime' => $mime,
                    'stored_path' => $path,
                ],
            ],
        );

        return response()->json([
            'ok' => true,
            'url' => Storage::url($path),
            'absolute_url' => url(Storage::url($path)),
            'name' => $originalName,
            'media_kind' => $kind,
            'size' => $file->getSize(),
            'mime' => $mime,
        ]);
    }

    public function updateNode(Request $request, BotNode $node)
    {
        // Normalizar settings: si viene null o no viene, lo tratamos como []
        $payload = $request->all();

        if (!isset($payload['settings']) || !is_array($payload['settings'])) {
            $payload['settings'] = [];
        }

        // Normalizar next_node_id: si viene "" lo convertimos a null
        if (array_key_exists('next_node_id', $payload) && ($payload['next_node_id'] === '' || $payload['next_node_id'] === 'none')) {
            $payload['next_node_id'] = null;
        }

        $data = validator($payload, [
            'key' => 'nullable|string',
            'type' => 'required|string',
            'body' => 'nullable|string',
            'settings' => 'array',            // <- ya no nullable
            'next_node_id' => 'nullable|integer',
        ])->validate();

        $before = $this->nodeAuditSnapshot($node);

        $node->update($data);
        $after = $this->nodeAuditSnapshot($node->fresh(['flow', 'nextNode']));

        $this->auditService->recordNodeChange(
            'node_updated',
            $this->nodeUpdateAuditDescription($before, $after),
            $node,
            $before,
            $after,
            $request->user(),
        );

        return response()->json($node);
    }

    public function destroyFlow(Request $request, BotFlow $flow)
    {
        $deletedFlowId = $flow->id;
        $wasDefault = (bool) $flow->is_default;
        $replacementDefaultId = null;
        $deletedNodeIds = $flow->nodes()->pluck('id')->all();
        $before = $this->flowAuditSnapshot($flow);

        DB::transaction(function () use ($flow, $deletedFlowId, $deletedNodeIds, $wasDefault, &$replacementDefaultId) {
            $this->clearChatStatesForDeletedNodes($deletedFlowId, $deletedNodeIds);

            Chat::where('bot_flow_id', $deletedFlowId)->update([
                'bot_flow_id' => null,
                'bot_node_id' => null,
            ]);

            if ($wasDefault) {
                $flow->is_default = false;
                $flow->save();
            }

            $flow->nodes()->delete();
            $flow->delete();

            if ($wasDefault) {
                $replacement = BotFlow::query()
                    ->where('is_active', true)
                    ->orderByDesc('is_default')
                    ->orderBy('id')
                    ->first();

                if ($replacement) {
                    BotFlow::where('is_default', true)->update(['is_default' => false]);
                    $replacement->update(['is_default' => true]);
                    $replacementDefaultId = $replacement->id;
                }
            }
        });

        $this->auditService->recordFlowAction(
            'deleted',
            "Elimino flujo {$before['name']}",
            $flow,
            $request->user(),
            [
                'changed_keys' => ['deleted_nodes_count', 'replacement_default_flow_id'],
                'before' => $before,
                'after' => array_merge($before, [
                    'deleted_at' => optional($flow->deleted_at)->toDateTimeString(),
                    'deleted_nodes_count' => count($deletedNodeIds),
                    'replacement_default_flow_id' => $replacementDefaultId,
                ]),
                'meta' => [
                    'deleted_nodes_count' => count($deletedNodeIds),
                    'replacement_default_flow_id' => $replacementDefaultId,
                ],
            ],
        );

        return response()->json([
            'ok' => true,
            'deleted_flow_id' => $deletedFlowId,
            'replacement_default_flow_id' => $replacementDefaultId,
        ]);
    }

    public function restoreFlow(Request $request, int $flowId)
    {
        $flow = BotFlow::onlyTrashed()->findOrFail($flowId);
        $before = $this->flowAuditSnapshot($flow);

        DB::transaction(function () use ($flow) {
            $flow->restore();
            BotNode::onlyTrashed()
                ->where('flow_id', $flow->id)
                ->restore();
        });

        $this->auditService->recordFlowChange(
            'restored',
            "Restauro flujo {$flow->name}",
            $flow,
            $before,
            $this->flowAuditSnapshot($flow->fresh(['startNode'])),
            $request->user(),
        );

        return response()->json([
            'ok' => true,
            'flow' => $flow->fresh(),
        ]);
    }

    public function destroyNode(Request $request, BotNode $node)
    {
        $deletedNodeId = $node->id;
        $flow = BotFlow::findOrFail($node->flow_id);
        $before = $this->nodeAuditSnapshot($node);
        $replacementNodeId = BotNode::where('flow_id', $flow->id)
            ->where('id', '!=', $deletedNodeId)
            ->orderBy('id')
            ->value('id');

        DB::transaction(function () use ($node, $flow, $deletedNodeId, $replacementNodeId) {
            BotNode::where('flow_id', $flow->id)
                ->where('id', '!=', $deletedNodeId)
                ->where('next_node_id', $deletedNodeId)
                ->update(['next_node_id' => null]);

            BotNode::where('flow_id', $flow->id)
                ->where('id', '!=', $deletedNodeId)
                ->get()
                ->each(function (BotNode $relatedNode) use ($deletedNodeId) {
                    $cleanedSettings = $this->removeDeletedNodeReferencesFromSettings($relatedNode->settings, $deletedNodeId);

                    if ($cleanedSettings !== ($relatedNode->settings ?? [])) {
                        $relatedNode->settings = $cleanedSettings;
                        $relatedNode->save();
                    }
                });

            if ((int) $flow->start_node_id === $deletedNodeId) {
                $flow->start_node_id = $replacementNodeId;
                $flow->save();
            }

            Chat::where('bot_flow_id', $flow->id)
                ->where('bot_node_id', $deletedNodeId)
                ->update(['bot_node_id' => $replacementNodeId]);

            $this->clearChatStatesForDeletedNodes($flow->id, [$deletedNodeId]);

            $node->delete();
        });

        $this->auditService->recordNodeAction(
            'node_deleted',
            "Elimino nodo {$before['key']}",
            $node,
            $request->user(),
            [
                'changed_keys' => ['replacement_node_id'],
                'before' => $before,
                'after' => array_merge($before, [
                    'deleted_at' => optional($node->deleted_at)->toDateTimeString(),
                    'replacement_node_id' => $replacementNodeId,
                ]),
                'meta' => [
                    'replacement_node_id' => $replacementNodeId,
                ],
            ],
        );

        return response()->json([
            'ok' => true,
            'deleted_node_id' => $deletedNodeId,
            'replacement_node_id' => $replacementNodeId,
            'flow' => $flow->fresh(),
        ]);
    }

    public function restoreNode(Request $request, int $nodeId)
    {
        $node = BotNode::onlyTrashed()->findOrFail($nodeId);
        $flow = BotFlow::withTrashed()->findOrFail($node->flow_id);
        $before = $this->nodeAuditSnapshot($node);

        if ($flow->trashed()) {
            return response()->json([
                'ok' => false,
                'message' => 'Primero restaurá el flujo al que pertenece este nodo.',
            ], 422);
        }

        $node->restore();

        if (!$flow->start_node_id) {
            $flow->start_node_id = $node->id;
            $flow->save();
        }

        $this->auditService->recordNodeChange(
            'node_restored',
            "Restauro nodo {$node->key}",
            $node,
            $before,
            $this->nodeAuditSnapshot($node->fresh(['flow'])),
            $request->user(),
            [
                'meta' => [
                    'flow_start_node_id' => $flow->start_node_id,
                ],
            ],
        );

        return response()->json([
            'ok' => true,
            'node' => $node->fresh(),
            'flow' => $flow->fresh(),
        ]);
    }

    public function makeDefault(Request $request, BotFlow $flow)
    {
        if (!$flow->is_active) {
            return response()->json(['error' => 'No podés marcar como default un flow inactivo'], 422);
        }

        $beforeDefault = BotFlow::query()->where('is_default', true)->first();
        $before = [
            'default_flow_id' => $beforeDefault?->id,
            'default_flow_name' => $beforeDefault?->name,
        ];

        DB::transaction(function () use ($flow) {
            BotFlow::where('is_default', true)->update(['is_default' => false]);
            $flow->update(['is_default' => true]);
        });

        $this->auditService->recordFlowChange(
            'default_updated',
            "Marco flujo {$flow->name} como default",
            $flow,
            $before,
            [
                'default_flow_id' => $flow->id,
                'default_flow_name' => $flow->name,
            ],
            $request->user(),
        );

        return response()->json(['ok' => true, 'default_flow_id' => $flow->id]);
    }

    private function flowAuditSnapshot(BotFlow $flow): array
    {
        $flow->loadMissing('startNode');

        return [
            'id' => $flow->id,
            'name' => $flow->name,
            'description' => $flow->description,
            'is_active' => (bool) $flow->is_active,
            'is_default' => (bool) $flow->is_default,
            'start_node_id' => $flow->start_node_id,
            'start_node_key' => $flow->startNode?->key,
            'deleted_at' => optional($flow->deleted_at)->toDateTimeString(),
        ];
    }

    private function nodeAuditSnapshot(BotNode $node): array
    {
        $node->loadMissing(['flow', 'nextNode']);

        return [
            'id' => $node->id,
            'flow_id' => $node->flow_id,
            'flow_name' => $node->flow?->name,
            'key' => $node->key,
            'type' => $node->type,
            'body' => $node->body,
            'settings' => $node->settings ?? [],
            'next_node_id' => $node->next_node_id,
            'next_node_key' => $node->nextNode?->key,
            'deleted_at' => optional($node->deleted_at)->toDateTimeString(),
        ];
    }

    private function nodeUpdateAuditDescription(array $before, array $after): string
    {
        $nodeKey = $after['key'] ?? $before['key'] ?? ('#' . ($after['id'] ?? $before['id'] ?? ''));
        $connectionChanges = $this->nodeConnectionChanges($before, $after);

        if (count($connectionChanges) === 1) {
            $change = $connectionChanges[0];

            if ($change['after'] === null || $change['after'] === '') {
                return "Desconecto {$change['label']} de nodo {$nodeKey}";
            }

            return "Conecto {$change['label']} de nodo {$nodeKey} con " . $this->nodeReferenceLabel($change['after']);
        }

        if (count($connectionChanges) > 1) {
            return "Actualizo conexiones de nodo {$nodeKey}";
        }

        return "Actualizo nodo {$nodeKey}";
    }

    private function nodeConnectionChanges(array $before, array $after): array
    {
        $changes = [];
        $paths = [
            ['path' => 'next_node_id', 'label' => 'salida principal'],
            ['path' => 'settings.not_found_next_node_id', 'label' => 'rama No encontrado'],
            ['path' => 'settings.error_next_node_id', 'label' => 'rama Error'],
            ['path' => 'settings.unavailable_next_node_id', 'label' => 'rama No disponible'],
            ['path' => 'settings.empty_next_node_id', 'label' => 'rama Sin resultados'],
        ];

        $beforeButtons = Arr::get($before, 'settings.buttons', []);
        $afterButtons = Arr::get($after, 'settings.buttons', []);
        $buttonCount = max(is_array($beforeButtons) ? count($beforeButtons) : 0, is_array($afterButtons) ? count($afterButtons) : 0);

        for ($index = 0; $index < $buttonCount; $index++) {
            $title = Arr::get($after, "settings.buttons.{$index}.title")
                ?? Arr::get($before, "settings.buttons.{$index}.title")
                ?? 'Boton ' . ($index + 1);
            $paths[] = [
                'path' => "settings.buttons.{$index}.next_node_id",
                'label' => "boton {$title}",
            ];
        }

        $beforeRows = Arr::get($before, 'settings.rows', []);
        $afterRows = Arr::get($after, 'settings.rows', []);
        $rowCount = max(is_array($beforeRows) ? count($beforeRows) : 0, is_array($afterRows) ? count($afterRows) : 0);

        for ($index = 0; $index < $rowCount; $index++) {
            $title = Arr::get($after, "settings.rows.{$index}.title")
                ?? Arr::get($before, "settings.rows.{$index}.title")
                ?? 'Opcion ' . ($index + 1);
            $paths[] = [
                'path' => "settings.rows.{$index}.next_node_id",
                'label' => "opcion {$title}",
            ];
        }

        foreach ($paths as $path) {
            $beforeValue = Arr::get($before, $path['path']);
            $afterValue = Arr::get($after, $path['path']);

            if ($beforeValue !== $afterValue) {
                $changes[] = [
                    'label' => $path['label'],
                    'before' => $beforeValue,
                    'after' => $afterValue,
                ];
            }
        }

        return $changes;
    }

    private function nodeReferenceLabel(mixed $nodeId): string
    {
        if ($nodeId === null || $nodeId === '') {
            return 'Finalizar flujo';
        }

        $node = BotNode::withTrashed()->find((int) $nodeId);

        if ($node) {
            return $node->key ?: "node_{$node->id}";
        }

        return "Nodo #{$nodeId}";
    }

    private function removeDeletedNodeReferencesFromSettings($settings, int $deletedNodeId): array
    {
        $settings = is_array($settings) ? $settings : [];

        foreach (['not_found_next_node_id', 'error_next_node_id', 'unavailable_next_node_id', 'empty_next_node_id'] as $singleNextKey) {
            if ((int) ($settings[$singleNextKey] ?? 0) === $deletedNodeId) {
                $settings[$singleNextKey] = null;
            }
        }

        if (isset($settings['buttons']) && is_array($settings['buttons'])) {
            $settings['buttons'] = array_map(function ($button) use ($deletedNodeId) {
                if (!is_array($button)) {
                    return $button;
                }

                if ((int) ($button['next_node_id'] ?? 0) === $deletedNodeId) {
                    $button['next_node_id'] = null;
                }

                return $button;
            }, $settings['buttons']);
        }

        if (isset($settings['rows']) && is_array($settings['rows'])) {
            $settings['rows'] = array_map(function ($row) use ($deletedNodeId) {
                if (!is_array($row)) {
                    return $row;
                }

                if ((int) ($row['next_node_id'] ?? 0) === $deletedNodeId) {
                    $row['next_node_id'] = null;
                }

                return $row;
            }, $settings['rows']);
        }

        return $settings;
    }

    private function clearChatStatesForDeletedNodes(int $flowId, array $deletedNodeIds): void
    {
        if (empty($deletedNodeIds)) {
            return;
        }

        $deletedNodeIds = array_map('intval', $deletedNodeIds);

        Chat::where('bot_flow_id', $flowId)
            ->whereNotNull('bot_state')
            ->get()
            ->each(function (Chat $chat) use ($deletedNodeIds) {
                $state = is_array($chat->bot_state) ? $chat->bot_state : [];
                $pendingInput = $state['pending_input'] ?? null;

                if (!is_array($pendingInput)) {
                    return;
                }

                $pendingNodeId = (int) ($pendingInput['node_id'] ?? 0);
                $pendingNextNodeId = (int) ($pendingInput['next_node_id'] ?? 0);

                if (in_array($pendingNodeId, $deletedNodeIds, true) || in_array($pendingNextNodeId, $deletedNodeIds, true)) {
                    unset($state['pending_input']);
                    $chat->bot_state = $state;
                    $chat->save();
                }
            });
    }
}
