<?php

namespace App\Http\Controllers;

use App\Models\Chat;
use App\Models\Message;
use Illuminate\Http\Request;

class ChatMediaController extends Controller
{
    public function index(Request $request, Chat $chat)
    {
        $limit = (int) $request->query('limit', 80);
        $limit = max(1, min($limit, 200));

        $media = Message::query()
            ->where('chat_id', $chat->id)
            ->whereNotNull('media_url')
            ->whereIn('message_type', ['image','video','audio','document'])
            ->orderByDesc('id')
            ->limit($limit)
            ->get([
                'id',
                'sender',
                'message_type',
                'body',
                'media_url',
                'media_name',
                'created_at',
            ]);

        return response()->json([
            'ok' => true,
            'chat_id' => $chat->id,
            'media' => $media,
        ]);
    }
}
