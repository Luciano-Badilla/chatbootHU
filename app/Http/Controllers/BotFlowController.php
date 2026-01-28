<?php

namespace App\Http\Controllers;


use App\Models\BotFlow;
use App\Models\BotNode;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

class BotFlowController extends Controller
{
    public function index()
    {
        $flows = BotFlow::all();

        return Inertia::render('BotFlowBuilder', [
            'flows' => $flows
        ]);
    }

    public function setStartNode(Request $request, BotFlow $flow)
    {
        $data = $request->validate([
            'start_node_id' => 'required|integer',
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
        $flows = BotFlow::all();

        return response()->json([
            'flows' => $flows
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
}
