<?php

namespace App\Http\Controllers;


use App\Models\BotFlow;
use App\Models\BotNode;
use App\Models\Chat;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

class BotFlowController extends Controller
{
    public function index()
    {
        $flows = BotFlow::orderBy('id')->get();

        return Inertia::render('BotFlowBuilder', [
            'flows' => $flows
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

        $flow->start_node_id = $data['start_node_id'] ?? null;
        $flow->save();

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

        return response()->json($flow, 201);
    }

    public function updateFlow(Request $request, BotFlow $flow)
    {
        $data = $request->validate([
            'name' => 'required|string',
            'description' => 'nullable|string',
        ]);

        $flow->update([
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
        ]);

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

        // Si el flujo no tiene start_node_id, lo ponemos
        if (!$flow->start_node_id) {
            $flow->start_node_id = $node->id;
            $flow->save();
        }

        return response()->json($node, 201);
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

        $node->update($data);

        return response()->json($node);
    }

    public function destroyFlow(BotFlow $flow)
    {
        $deletedFlowId = $flow->id;
        $wasDefault = (bool) $flow->is_default;
        $replacementDefaultId = null;
        $deletedNodeIds = $flow->nodes()->pluck('id')->all();

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

        return response()->json([
            'ok' => true,
            'deleted_flow_id' => $deletedFlowId,
            'replacement_default_flow_id' => $replacementDefaultId,
        ]);
    }

    public function restoreFlow(int $flowId)
    {
        $flow = BotFlow::onlyTrashed()->findOrFail($flowId);

        DB::transaction(function () use ($flow) {
            $flow->restore();
            BotNode::onlyTrashed()
                ->where('flow_id', $flow->id)
                ->restore();
        });

        return response()->json([
            'ok' => true,
            'flow' => $flow->fresh(),
        ]);
    }

    public function destroyNode(BotNode $node)
    {
        $deletedNodeId = $node->id;
        $flow = BotFlow::findOrFail($node->flow_id);
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

        return response()->json([
            'ok' => true,
            'deleted_node_id' => $deletedNodeId,
            'replacement_node_id' => $replacementNodeId,
            'flow' => $flow->fresh(),
        ]);
    }

    public function restoreNode(int $nodeId)
    {
        $node = BotNode::onlyTrashed()->findOrFail($nodeId);
        $flow = BotFlow::withTrashed()->findOrFail($node->flow_id);

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

        return response()->json([
            'ok' => true,
            'node' => $node->fresh(),
            'flow' => $flow->fresh(),
        ]);
    }

    public function makeDefault(BotFlow $flow)
    {
        if (!$flow->is_active) {
            return response()->json(['error' => 'No podés marcar como default un flow inactivo'], 422);
        }

        DB::transaction(function () use ($flow) {
            BotFlow::where('is_default', true)->update(['is_default' => false]);
            $flow->update(['is_default' => true]);
        });

        return response()->json(['ok' => true, 'default_flow_id' => $flow->id]);
    }

    private function removeDeletedNodeReferencesFromSettings($settings, int $deletedNodeId): array
    {
        $settings = is_array($settings) ? $settings : [];

        foreach (['not_found_next_node_id', 'error_next_node_id'] as $singleNextKey) {
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
