<?php

namespace App\Services;

use App\Models\Chat;
use App\Models\SystemSetting;
use App\Models\User;
use Illuminate\Support\Facades\Cache;

class WebchatAvailabilityService
{
    /** The public channel can remain available for the bot outside service hours. */
    public function isBotAvailable(array $settings): bool
    {
        if (! ($settings['enabled'] ?? false)) {
            return false;
        }

        return ($settings['availability_mode'] ?? 'always') !== 'schedule'
            || $this->isWithinSchedule($settings)
            || (bool) ($settings['bot_available_outside_schedule'] ?? false);
    }

    /** Operator assignment always follows the configured service hours. */
    public function canAssignOperator(Chat $chat): bool
    {
        if ($chat->channel !== 'webchat') {
            return true;
        }

        $settings = SystemSetting::query()
            ->whereIn('key', [
                'webchat.enabled',
                'webchat.availability_mode',
                'webchat.schedule_start',
                'webchat.schedule_end',
            ])
            ->pluck('value', 'key');

        return $this->areOperatorsAvailable([
            'enabled' => ($settings['webchat.enabled'] ?? '1') === '1',
            'availability_mode' => $settings['webchat.availability_mode'] ?? 'always',
            'schedule_start' => $settings['webchat.schedule_start'] ?? '08:00',
            'schedule_end' => $settings['webchat.schedule_end'] ?? '20:00',
        ]);
    }

    public function areOperatorsAvailable(array $settings): bool
    {
        return (bool) ($settings['enabled'] ?? false)
            && (($settings['availability_mode'] ?? 'always') !== 'schedule' || $this->isWithinSchedule($settings));
    }

    /** Whether at least one online operator has room for another chat. */
    public function hasAvailableOperators(): bool
    {
        return Cache::remember('webchat.has_available_operators', now()->addSeconds(5), function (): bool {
            $maxAssignedChats = max(1, min(100, (int) (SystemSetting::query()
                ->where('key', 'operators.max_assigned_chats')
                ->value('value') ?? 5)));

            $operators = User::query()
                ->where('is_active', true)
                ->where('operator_availability', 'available')
                ->where('last_operator_activity_at', '>=', now()->subSeconds(90))
                ->with('role')
                ->get()
                ->filter(fn (User $user) => $user->canHandleChats())
                ->values();

            if ($operators->isEmpty()) {
                return false;
            }

            $activeChatsByOperator = Chat::query()
                ->selectRaw('operator_id, COUNT(*) as active_chat_count')
                ->where('status', 'open')
                ->where('attention_status', 'assigned')
                ->whereIn('operator_id', $operators->pluck('id'))
                ->groupBy('operator_id')
                ->pluck('active_chat_count', 'operator_id');

            return $operators->contains(fn (User $operator) => (int) ($activeChatsByOperator[$operator->id] ?? 0) < $maxAssignedChats);
        });
    }

    public function isWithinSchedule(array $settings): bool
    {
        $now = now(SystemSetting::query()
            ->where('key', 'general.timezone')
            ->value('value') ?: config('app.timezone'))
            ->format('H:i');
        $start = $settings['schedule_start'] ?? '08:00';
        $end = $settings['schedule_end'] ?? '20:00';

        if ($start <= $end) {
            return $start <= $now && $now <= $end;
        }

        return $now >= $start || $now <= $end;
    }
}
