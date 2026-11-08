<?php

namespace App\Console\Commands;

use App\Exceptions\HolidayCalendarException;
use App\Services\HolidayService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class SyncHolidays extends Command
{
    protected $signature = 'holidays:sync {year? : Año a sincronizar (por defecto, el actual y el siguiente)}';

    protected $description = 'Carga desde el calendario público los feriados nacionales de Argentina';

    public function handle(HolidayService $holidays): int
    {
        $currentYear = (int) now(config('app.timezone'))->year;
        $years = $this->argument('year')
            ? [(int) $this->argument('year')]
            : [$currentYear, $currentYear + 1];

        $failed = false;

        foreach ($years as $year) {
            try {
                $result = $holidays->importYear($year);
                $this->info("Feriados {$year}: {$result['created']} nuevos, {$result['updated']} actualizados, {$result['removed']} quitados.");
            } catch (HolidayCalendarException $e) {
                $failed = true;
                $this->error("Feriados {$year}: {$e->getMessage()}");
                Log::warning('No se pudieron sincronizar los feriados.', ['year' => $year, 'error' => $e->getMessage()]);
            }
        }

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
