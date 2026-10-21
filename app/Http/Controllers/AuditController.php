<?php

namespace App\Http\Controllers;

use App\Services\AuditService;
use App\Models\Chat;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\File;
use Inertia\Inertia;
use Spatie\Activitylog\Models\Activity;

class AuditController extends Controller
{
    public function __construct(private readonly AuditService $auditService)
    {
    }

    public function index(Request $request)
    {
        return Inertia::render('AuditPanel', [
            'configurationAuditLogs' => $this->auditLogsForScope('configuration'),
            'messageAuditLogs' => $this->auditLogsForScope('messages'),
            'flowAuditLogs' => $this->auditLogsForScope('flows'),
            'campaignAuditLogs' => $this->auditLogsForScope('campaigns'),
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

    public function chatLogs(Chat $chat, Request $request)
    {
        $limit = max(10, min(500, (int) $request->integer('limit', 100)));

        return response()->json([
            'logs' => Activity::query()
                ->with('causer')
                ->whereIn('log_name', ['chat', 'messages'])
                ->where(function ($query) use ($chat) {
                    $query->where(function ($subject) use ($chat) {
                        $subject->where('subject_type', Chat::class)->where('subject_id', $chat->id);
                    })->orWhere('properties->chat_id', $chat->id)
                      ->orWhere('properties->chat->id', $chat->id);
                })
                ->latest('id')
                ->limit($limit)
                ->get()
                ->map(fn (Activity $activity) => [
                    'id' => $activity->id,
                    'event' => $activity->event,
                    'description' => $activity->description,
                    'created_at' => optional($activity->created_at)?->toIso8601String(),
                    'causer_name' => $activity->causer?->name,
                    'properties' => $this->auditService->presentProperties(
                        (string) $activity->log_name,
                        $activity->event,
                        $activity->properties?->toArray() ?? [],
                    ),
                ])->values(),
        ]);
    }

    protected function auditLogsForScope(string $scope, int $limit = 50): array
    {
        $query = Activity::query()->with('causer')->latest('id');

        match ($scope) {
            'messages' => $query->whereIn('log_name', ['messages', 'chat']),
            'flows' => $query->whereIn('log_name', ['flows', 'bot_flows']),
            'campaigns' => $query->where('log_name', 'campaigns'),
            default => $query->whereIn('log_name', ['settings', 'users', 'security', 'agenda', 'operator_control']),
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
                'properties' => $this->auditService->presentProperties(
                    (string) $activity->log_name,
                    $activity->event,
                    $activity->properties?->toArray() ?? [],
                ),
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

        $handle = @fopen($path, 'rb');

        if ($handle === false) {
            return [
                'path' => $path,
                'updated_at' => null,
                'lines' => ['No se pudo leer el archivo de log principal.'],
            ];
        }

        $fileSize = (int) (fstat($handle)['size'] ?? 0);
        $position = $fileSize;
        $bytesRead = 0;
        $maxBytes = 4 * 1024 * 1024;
        $buffer = '';
        $tailLines = [];

        while ($position > 0 && count($tailLines) < $lines && $bytesRead < $maxBytes) {
            $chunkSize = min(8192, $position, $maxBytes - $bytesRead);
            $position -= $chunkSize;

            if (fseek($handle, $position) !== 0) {
                break;
            }

            $chunk = fread($handle, $chunkSize);

            if ($chunk === false || $chunk === '') {
                break;
            }

            $bytesRead += strlen($chunk);
            $parts = preg_split('/\r\n|\r|\n/', $chunk.$buffer) ?: [];

            if ($position > 0) {
                $buffer = array_shift($parts) ?? '';
            } else {
                $buffer = '';
            }

            $tailLines = array_slice(array_merge($parts, $tailLines), -1 * $lines);
        }

        fclose($handle);

        if ($position > 0 && $bytesRead >= $maxBytes && count($tailLines) < $lines) {
            if ($tailLines === [] && $buffer !== '') {
                $tailLines[] = '[Línea truncada] '.mb_substr($buffer, -10000);
            }

            array_unshift($tailLines, '[Se omitieron líneas anteriores por tamaño del archivo.]');
            $tailLines = array_slice($tailLines, -1 * $lines);
        }

        return [
            'path' => $path,
            'updated_at' => Carbon::createFromTimestamp((int) File::lastModified($path))->toDateTimeString(),
            'lines' => array_values(array_filter($tailLines, fn ($line) => $line !== null)),
        ];
    }
}
