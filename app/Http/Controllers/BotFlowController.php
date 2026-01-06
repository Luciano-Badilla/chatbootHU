<?php

namespace App\Http\Controllers;


use App\Models\BotFlow;
use App\Models\BotNode;
use Illuminate\Http\Request;
use Inertia\Inertia;

class BotFlowController extends Controller
{
    public function index()
    {
        $flows = BotFlow::select('id', 'name', 'is_active')->get();

        return Inertia::render('BotFlowBuilder', [
            'flows' => $flows
        ]);
    }

    public function apiIndex()
    {
        $flows = BotFlow::select('id', 'name', 'is_active')->get();

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
            'flow_id'  => $flow->id,
            'key'      => $data['key'] ?? null,
            'type'     => $data['type'],
            'body'     => $data['body'] ?? null,
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
            'key'          => 'nullable|string',
            'type'         => 'required|string',
            'body'         => 'nullable|string',
            'settings'     => 'array',            // <- ya no nullable
            'next_node_id' => 'nullable|integer',
        ])->validate();

        $node->update($data);

        return response()->json($node);
    }
}
