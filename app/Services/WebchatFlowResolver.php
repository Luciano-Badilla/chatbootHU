<?php

namespace App\Services;

use App\Models\BotFlow;
use App\Models\SystemSetting;

/**
 * Elige el flujo de Webchat que corresponde ahora.
 *
 * Prioridad: fuera de horario de operadores > feriado > día de la semana.
 * Es la única fuente de esta regla: la usan el inicio de conversación y el motor de mensajes.
 * Si devuelve null, quien llama usa el flujo por defecto.
 */
class WebchatFlowResolver
{
    private const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    public function __construct(
        private readonly WebchatAvailabilityService $availabilityService,
        private readonly HolidayService $holidayService,
    ) {
    }

    /** Configuración de Webchat leída de system_settings, con la forma que usa resolve(). */
    public function loadSettings(): array
    {
        $stored = SystemSetting::query()
            ->whereIn('key', [
                'webchat.availability_mode',
                'webchat.schedule_start',
                'webchat.schedule_end',
                'webchat.outside_schedule_flow_id',
                'webchat.holiday_flow_id',
                'webchat.flow_schedule',
                'webchat.default_flow_id',
            ])
            ->pluck('value', 'key');

        $schedule = json_decode((string) ($stored['webchat.flow_schedule'] ?? ''), true);
        $flowSchedule = is_array($schedule)
            ? array_replace(array_fill_keys(self::DAYS, null), array_intersect_key($schedule, array_flip(self::DAYS)))
            : array_fill_keys(self::DAYS, filled($stored['webchat.default_flow_id'] ?? null) ? (int) $stored['webchat.default_flow_id'] : null);

        return [
            'availability_mode' => $stored['webchat.availability_mode'] ?? 'always',
            'schedule_start' => $stored['webchat.schedule_start'] ?? '08:00',
            'schedule_end' => $stored['webchat.schedule_end'] ?? '20:00',
            'outside_schedule_flow_id' => $stored['webchat.outside_schedule_flow_id'] ?? null,
            'holiday_flow_id' => $stored['webchat.holiday_flow_id'] ?? null,
            'flow_schedule' => $flowSchedule,
        ];
    }

    /** Flujo de Webchat que corresponde ahora, o null si no hay uno elegible. */
    public function resolve(array $settings): ?BotFlow
    {
        $now = now($this->timezone());

        $outsideApplies = ($settings['availability_mode'] ?? 'always') === 'schedule'
            && ! $this->availabilityService->isWithinSchedule($settings);

        if ($outsideApplies && filled($settings['outside_schedule_flow_id'] ?? null)) {
            return $this->eligibleFlow($settings['outside_schedule_flow_id']);
        }

        if ($this->holidayService->isHoliday($now)) {
            $holidayFlow = $this->eligibleFlow($settings['holiday_flow_id'] ?? null);
            if ($holidayFlow) {
                return $holidayFlow;
            }
        }

        return $this->eligibleFlow($settings['flow_schedule'][strtolower($now->format('l'))] ?? null);
    }

    private function eligibleFlow(mixed $flowId): ?BotFlow
    {
        if (! filled($flowId)) {
            return null;
        }

        return BotFlow::query()
            ->where('is_active', true)
            ->whereJsonContains('channels', 'webchat')
            ->whereKey((int) $flowId)
            ->first();
    }

    private function timezone(): string
    {
        return SystemSetting::query()->where('key', 'general.timezone')->value('value') ?: config('app.timezone');
    }
}
