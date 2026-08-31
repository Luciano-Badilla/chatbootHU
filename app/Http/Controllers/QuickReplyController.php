<?php

namespace App\Http\Controllers;

use App\Models\QuickReply;
use Illuminate\Http\Request;
use Inertia\Inertia;

class QuickReplyController extends Controller
{
    public function index()
    {
        return Inertia::render('QuickRepliesPanel');
    }

    public function apiIndex(Request $request)
    {
        $search = trim((string) $request->query('q', ''));
        $replies = QuickReply::query()
            ->when($search !== '', fn ($query) => $query->where(
                fn ($nested) => $nested->where('title', 'like', "%{$search}%")
                    ->orWhere('body', 'like', "%{$search}%")
            ))
            ->orderBy('sort_order')
            ->orderBy('title')
            ->get();

        return response()->json(['quick_replies' => $replies]);
    }

    public function store(Request $request)
    {
        $data = $this->validatedData($request);
        $data['sort_order'] = ((int) QuickReply::max('sort_order')) + 10;
        $reply = QuickReply::create($data);

        return response()->json(['quick_reply' => $reply], 201);
    }

    public function update(Request $request, QuickReply $quickReply)
    {
        $quickReply->update($this->validatedData($request));

        return response()->json(['quick_reply' => $quickReply->refresh()]);
    }

    public function destroy(QuickReply $quickReply)
    {
        $quickReply->delete();

        return response()->json(['ok' => true]);
    }

    private function validatedData(Request $request): array
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:100'],
            'body' => ['required', 'string', 'max:2000'],
        ]);

        return [
            'title' => trim($data['title']),
            'body' => trim($data['body']),
        ];
    }
}
