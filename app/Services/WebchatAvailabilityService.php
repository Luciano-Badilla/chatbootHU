<?php

namespace App\Services;

use App\Models\Chat;
use App\Models\SystemSetting;

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

    private function isWithinSchedule(array $settings): bool
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
