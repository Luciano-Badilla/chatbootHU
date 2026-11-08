<?php

namespace App\Http\Controllers;

use App\Exceptions\HolidayCalendarException;
use App\Models\Holiday;
use App\Services\AuditService;
use App\Services\HolidayService;
use Illuminate\Http\Request;

class HolidayController extends Controller
{
    public function __construct(
        private readonly HolidayService $holidayService,
        private readonly AuditService $auditService,
    ) {
    }

    public function index(Request $request)
    {
        $data = $request->validate([
            'year' => ['required', 'integer', 'between:2000,2100'],
        ]);
        $year = (int) $data['year'];

        $holidays = Holiday::query()
            ->whereYear('date', $year)
            ->orderBy('date')
            ->get();

        return response()->json([
            'year' => $year,
            'holidays' => $holidays->map(fn (Holiday $holiday) => $this->payload($holiday))->values(),
        ]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'date' => ['required', 'date_format:Y-m-d'],
            'name' => ['required', 'string', 'max:150'],
        ]);

        $holiday = $this->holidayService->addManual($data['date'], $data['name']);

        $this->auditService->record(
            'holidays',
            'holiday_added',
            "Agregó el feriado {$holiday->name} ({$holiday->date->format('d/m/Y')})",
            $request->user(),
            $holiday,
            ['holiday' => $this->payload($holiday)],
        );

        return response()->json(['ok' => true, 'holiday' => $this->payload($holiday)], 201);
    }

    public function destroy(Request $request, Holiday $holiday)
    {
        $payload = $this->payload($holiday);
        $holiday->delete();

        $this->auditService->record(
            'holidays',
            'holiday_removed',
            "Quitó el feriado {$holiday->name} ({$holiday->date->format('d/m/Y')})",
            $request->user(),
            $holiday,
            ['holiday' => $payload],
        );

        return response()->json(['ok' => true]);
    }

    public function import(Request $request)
    {
        $data = $request->validate([
            'year' => ['required', 'integer', 'between:2000,2100'],
        ]);
        $year = (int) $data['year'];

        try {
            $result = $this->holidayService->importYear($year);
        } catch (HolidayCalendarException $e) {
            return response()->json([
                'ok' => false,
                'message' => 'No se pudo consultar el calendario de feriados. Probá más tarde o cargalos a mano.',
            ], 502);
        }

        $this->auditService->record(
            'holidays',
            'holidays_imported',
            "Cargó los feriados de {$year} desde el calendario ({$result['created']} nuevos, {$result['removed']} quitados)",
            $request->user(),
            null,
            ['year' => $year, ...$result],
        );

        return response()->json(['ok' => true, 'year' => $year, ...$result]);
    }

    /** @return array{id: int, date: string, name: string, source: string} */
    private function payload(Holiday $holiday): array
    {
        return [
            'id' => $holiday->id,
            'date' => $holiday->date->toDateString(),
            'name' => $holiday->name,
            'source' => $holiday->source,
        ];
    }
}
