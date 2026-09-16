<?php

namespace App\Services;

use App\Models\Chat;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class OperatorAvailabilityService
{
    public function __construct(private readonly ChatAssignmentService $chatAssignmentService)
    {
    }

    /** Releases open work and immediately offers it to other available operators. */
    public function releaseOpenChats(User $operator): Collection
    {
        $chats = DB::transaction(function () use ($operator) {
            $chats = Chat::query()
                ->where('operator_id', $operator->id)
                ->where('status', 'open')
                ->where('attention_status', 'assigned')
                ->lockForUpdate()
                ->get();

            foreach ($chats as $chat) {
                $chat->update([
                    'operator_id' => null,
                    'assigned_at' => null,
                    'attention_status' => 'pending_assignment',
                    'bot_enabled' => false,
                ]);
            }

            return $chats;
        });

        return $chats->map(fn (Chat $chat) => $this->chatAssignmentService->assignPending($chat));
    }

    /**
     * Releases work held by users whose presence heartbeat expired.
     * The availability preference is preserved, so reconnecting restores the
     * previous available/paused choice without treating a network drop as a
     * manual status change.
     */
    public function releaseDisconnectedOperators(): Collection
    {
        return User::query()
            ->where('is_active', true)
            ->with('role')
            ->get()
            ->filter(fn (User $user) => $user->canHandleChats())
            ->filter(fn (User $user) => ! $user->last_operator_activity_at || $user->last_operator_activity_at->lt(now()->subSeconds(90)))
            ->map(function (User $operator) {
                $releasedChats = $this->releaseOpenChats($operator);

                if ($operator->current_chat_id) {
                    $operator->update(['current_chat_id' => null]);
                }

                return [
                    'operator' => $operator,
                    'chats' => $releasedChats,
                ];
            })
            ->filter(fn (array $result) => $result['chats']->isNotEmpty() || $result['operator']->wasChanged('current_chat_id'))
            ->values();
    }
}
