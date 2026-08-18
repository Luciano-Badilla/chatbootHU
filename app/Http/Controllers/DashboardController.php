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
        $period = (int) $request->query('period', 7);

        if (! in_array($period, [1, 7, 30], true)) {
            $period = 7;
        }

        return Inertia::render('Dashboard', $this->metrics->build($request->user(), $period));
    }
}
