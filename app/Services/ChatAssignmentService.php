<?php

namespace App\Services;

use App\Models\Chat;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class ChatAssignmentService
{
    /** Assigns a pending handoff to the operator with the smallest active workload. */
    public function assignPending(Chat $chat): Chat
    {
        return DB::transaction(function () use ($chat) {
            $chat = Chat::query()->lockForUpdate()->findOrFail($chat->id);

            if ($chat->status !== 'open' || $chat->attention_status !== 'pending_assignment') {
                return $chat;
            }

            $operators = User::query()->where('is_active', true)->with('role')->get()
                ->filter(fn (User $user) => $user->roleName() === 'operator')
                ->map(function (User $user) {
                    $user->active_chat_count = Chat::query()
                        ->where('status', 'open')
                        ->where('attention_status', 'assigned')
                        ->where('operator_id', $user->id)
                        ->count();

                    return $user;
                })
                ->sortBy(fn (User $user) => [$user->active_chat_count, $user->id])
                ->values();

            $operator = $operators->first();
            if (! $operator) {
                return $chat;
            }

            $chat->operator_id = $operator->id;
            $chat->last_operator_id = $operator->id;
            $chat->assigned_at = now();
            $chat->attention_status = 'assigned';
            $chat->save();

            return $chat->load('operator');
        });
    }
}
