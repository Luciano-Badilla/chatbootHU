<?php

namespace App\Services;

use App\Exceptions\HolidayCalendarException;
use App\Models\Holiday;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class HolidayService
{
    public function isHoliday(CarbonInterface $date): bool
    {
        return Holiday::query()->whereDate('date', $date->toDateString())->exists();
    }

    /**
     * Carga los feriados nacionales del año desde la API pública.
     *
     * - Un día ya cargado (de la API o a mano) no se modifica, salvo el nombre de los de la API.
     * - Un día que el usuario quitó (soft delete) no se vuelve a cargar.
     * - Si la API trae datos, los feriados de la API que ya no aparecen (p. ej. un traslado) se quitan.
     *
     * @return array{created: int, updated: int, removed: int, total: int}
     */
    public function importYear(int $year): array
    {
        $items = $this->fetchNationalHolidays($year);

        $created = 0;
        $updated = 0;
        $removed = 0;
        $dates = [];

        DB::transaction(function () use ($items, $year, &$created, &$updated, &$removed, &$dates) {
            foreach ($items as $item) {
                $dates[] = $item['date'];

                $existing = Holiday::withTrashed()->whereDate('date', $item['date'])->first();

                if (! $existing) {
                    Holiday::create([
                        'date' => $item['date'],
                        'name' => $item['name'],
                        'source' => Holiday::SOURCE_API,
                    ]);
                    $created++;
                    continue;
                }

                if ($existing->trashed()) {
                    continue; // lo quitó el usuario: se respeta
                }

                if ($existing->source === Holiday::SOURCE_API && $existing->name !== $item['name']) {
                    $existing->update(['name' => $item['name']]);
                    $updated++;
                }
            }

            if ($dates !== []) {
                $staleIds = Holiday::query()
                    ->where('source', Holiday::SOURCE_API)
                    ->whereYear('date', $year)
                    ->get()
                    ->reject(fn (Holiday $holiday) => in_array($holiday->date->toDateString(), $dates, true))
                    ->pluck('id')
                    ->all();

                if ($staleIds !== []) {
                    $removed = Holiday::query()->whereIn('id', $staleIds)->forceDelete();
                }
            }
        });

        return ['created' => $created, 'updated' => $updated, 'removed' => $removed, 'total' => count($items)];
    }

    /** Alta manual. Si el día estaba quitado, lo vuelve a cargar con el nombre nuevo. */
    public function addManual(string $date, string $name): Holiday
    {
        $day = Carbon::parse($date)->toDateString();
        $name = Str::limit(trim($name), 150, '');

        $existing = Holiday::withTrashed()->whereDate('date', $day)->first();

        if ($existing && ! $existing->trashed()) {
            throw ValidationException::withMessages([
                'date' => ['Ese día ya está cargado como feriado.'],
            ]);
        }

        if ($existing) {
            $existing->restore();
            $existing->update(['name' => $name, 'source' => Holiday::SOURCE_MANUAL]);

            return $existing->fresh();
        }

        return Holiday::create([
            'date' => $day,
            'name' => $name,
            'source' => Holiday::SOURCE_MANUAL,
        ]);
    }

    /** @return array<int, array{date: string, name: string}> */
    private function fetchNationalHolidays(int $year): array
    {
        $baseUrl = rtrim((string) config('services.holidays.base_url'), '/');
        $countryCode = strtoupper((string) config('services.holidays.country_code', 'AR'));

        try {
            $response = Http::acceptJson()
                ->timeout((int) config('services.holidays.timeout', 10))
                ->get("{$baseUrl}/PublicHolidays/{$year}/{$countryCode}");
        } catch (\Throwable $e) {
            throw new HolidayCalendarException('No se pudo consultar el calendario de feriados.', 0, $e);
        }

        $payload = $response->successful() ? $response->json() : null;

        if (! is_array($payload)) {
            throw new HolidayCalendarException('El calendario de feriados no devolvió datos válidos para '.$year.'.');
        }

        return collect($payload)
            ->filter(fn ($item) => is_array($item) && ! empty($item['date']) && ($item['global'] ?? true) === true)
            ->map(fn (array $item) => [
                'date' => Carbon::parse($item['date'])->toDateString(),
                'name' => Str::limit(trim((string) ($item['localName'] ?? $item['name'] ?? 'Feriado')), 150, ''),
            ])
            ->unique('date')
            ->values()
            ->all();
    }
}
