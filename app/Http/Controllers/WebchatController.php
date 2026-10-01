<?php

namespace App\Http\Controllers;

use App\Models\BotFlow;
use App\Models\Chat;
use App\Models\Contact;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;

class WebchatController extends Controller
{
    public function index()
    {
        return Inertia::render('Webchat');
    }

    public function session(Request $request)
    {
        $token = (string) $request->input('resume_token', '');
        $chat = $this->chatForToken($token);

        if (! $chat) {
            return response()->json(['requires_profile' => true]);
        }

        $chat->update(['webchat_last_seen_at' => now()]);

        return response()->json([
            'requires_profile' => false,
            'resume_token' => $chat->webchat_token,
            'chat' => $this->payload($chat),
        ]);
    }

    public function start(Request $request)
    {
        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
        ]);

        $flow = BotFlow::query()
            ->where('is_active', true)
            ->whereJsonContains('channels', 'webchat')
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->first();

        if (! $flow) {
            return response()->json([
                'message' => 'No hay un flujo activo habilitado para webchat.',
            ], 422);
        }

        $token = Str::random(64);
        $name = trim($data['first_name'].' '.$data['last_name']);
        $contact = Contact::create([
            // La columna actual es obligatoria y única. Este valor nunca se muestra ni se usa como teléfono.
            'whatsapp_id' => 'webchat:'.$token,
            'name' => $name,
            'last_interaction_at' => now(),
        ]);
        $chat = Chat::create([
            'contact_id' => $contact->id,
            'channel' => 'webchat',
            'webchat_token' => $token,
            'webchat_last_seen_at' => now(),
            'bot_flow_id' => $flow->id,
            'bot_node_id' => $flow->start_node_id,
            'status' => 'open',
            'attention_status' => 'bot',
            'bot_enabled' => true,
            'bot_state' => [],
            'last_user_message_at' => now(),
        ]);
        app(WhatsAppController::class)->startWebchatConversation($chat);
        $chat->refresh();

        return response()->json([
            'resume_token' => $token,
            'chat' => $this->payload($chat),
        ], 201);
    }

    public function messages(Request $request)
    {
        $chat = $this->requireChat($request);

        return response()->json([
            'messages' => $chat->messages()->orderBy('id')->get(),
        ]);
    }

    public function send(Request $request)
    {
        $data = $request->validate([
            'resume_token' => ['required', 'string', 'max:80'],
            'message' => ['nullable', 'string', 'max:4000', 'required_without:option_id'],
            'option_id' => ['nullable', 'string', 'max:255'],
        ]);
        $chat = $this->requireChat($request, $data['resume_token']);
        $chat->update(['webchat_last_seen_at' => now(), 'last_user_message_at' => now()]);
        $chat->contact->update(['last_interaction_at' => now()]);

        $message = app(WhatsAppController::class)->processWebchatMessage(
            $chat,
            trim((string) ($data['message'] ?? '')),
            $data['option_id'] ?? null,
        );

        return response()->json(['ok' => true, 'message' => $message]);
    }

    private function requireChat(Request $request, ?string $token = null): Chat
    {
        $chat = $this->chatForToken($token ?? (string) $request->input('resume_token', ''));
        abort_unless($chat, 404);

        return $chat;
    }

    private function chatForToken(string $token): ?Chat
    {
        return $token === '' ? null : Chat::with('contact')->where('channel', 'webchat')->where('webchat_token', $token)->first();
    }

    private function payload(Chat $chat): array
    {
        return [
            'id' => $chat->id,
            'name' => $chat->contact?->name,
            'status' => $chat->status,
            'messages' => $chat->messages()->orderBy('id')->get(),
        ];
    }
}
