<?php

namespace App\Http\Controllers;

use App\Services\DashboardMetricsService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function __construct(private readonly DashboardMetricsService $metrics) {}

    public function index(Request $request): Response
    {
        $validated = $request->validate([
            'from' => ['nullable', 'required_with:to', 'date_format:Y-m-d'],
            'to' => ['nullable', 'required_with:from', 'date_format:Y-m-d', 'after_or_equal:from', 'before_or_equal:today'],
        ]);

        $period = (int) $request->query('period', 7);

        if (! in_array($period, [1, 7, 30], true)) {
            $period = 7;
        }

        return Inertia::render('Dashboard', $this->metrics->build(
            $request->user(),
            $period,
            $validated['from'] ?? null,
            $validated['to'] ?? null,
        ));
    }
}
