<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\File;
use Inertia\Inertia;
use Spatie\Activitylog\Models\Activity;

class AuditController extends Controller
{
    public function index(Request $request)
    {
        return Inertia::render('AuditPanel', [
            'configurationAuditLogs' => $this->auditLogsForScope('configuration'),
            'messageAuditLogs' => $this->auditLogsForScope('messages'),
            'flowAuditLogs' => $this->auditLogsForScope('flows'),
            'logTail' => $this->readApplicationLogTail(),
        ]);
    }

    public function logs(Request $request)
    {
        $scope = (string) $request->query('scope', 'configuration');
        $limit = max(10, min(100, (int) $request->integer('limit', 50)));

        return response()->json([
            'logs' => $this->auditLogsForScope($scope, $limit),
        ]);
    }

    public function applicationLogs(Request $request)
    {
        $lines = max(20, min(400, (int) $request->integer('lines', 120)));

        return response()->json([
            'tail' => $this->readApplicationLogTail($lines),
        ]);
    }

    protected function auditLogsForScope(string $scope, int $limit = 50): array
    {
        $query = Activity::query()->with('causer')->latest('id');

        match ($scope) {
            'messages' => $query->whereIn('log_name', ['messages', 'chat']),
            'flows' => $query->whereIn('log_name', ['flows', 'bot_flows']),
            default => $query->whereIn('log_name', ['settings', 'users', 'security']),
        };

        return $query
            ->limit($limit)
            ->get()
            ->map(fn (Activity $activity) => [
                'id' => $activity->id,
                'log_name' => $activity->log_name,
                'event' => $activity->event,
                'description' => $activity->description,
                'created_at' => optional($activity->created_at)?->toDateTimeString(),
                'created_at_human' => optional($activity->created_at)?->diffForHumans(),
                'causer_name' => $activity->causer?->name,
                'causer_email' => $activity->causer?->email,
                'properties' => $activity->properties?->toArray() ?? [],
            ])
            ->values()
            ->all();
    }

    protected function readApplicationLogTail(int $lines = 120): array
    {
        $path = storage_path('logs/laravel.log');

        if (!File::exists($path)) {
            return [
                'path' => $path,
                'updated_at' => null,
                'lines' => ['No existe el archivo de log principal.'],
            ];
        }

        $contents = File::get($path);
        $allLines = preg_split('/\r\n|\r|\n/', $contents) ?: [];
        $tailLines = array_slice($allLines, -1 * $lines);

        return [
            'path' => $path,
            'updated_at' => Carbon::createFromTimestamp((int) File::lastModified($path))->toDateTimeString(),
            'lines' => array_values(array_filter($tailLines, fn ($line) => $line !== null)),
        ];
    }
}
