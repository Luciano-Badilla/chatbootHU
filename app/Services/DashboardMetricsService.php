<?php

namespace App\Services;

use App\Models\BotFlow;
use App\Models\Campaign;
use App\Models\Chat;
use App\Models\Message;
use App\Models\SystemSetting;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Spatie\Activitylog\Models\Activity;

class DashboardMetricsService
{
    public function build(User $user, int $days): array
    {
        $end = now()->endOfDay();
        $start = now()->subDays($days - 1)->startOfDay();
        $previousEnd = $start->copy()->subSecond();
        $previousStart = $previousEnd->copy()->subDays($days - 1)->startOfDay();

        $current = $this->summaryForRange($user, $start, $end);
        $previous = $this->summaryForRange($user, $previousStart, $previousEnd);

        return [
            'period' => [
                'days' => $days,
                'label' => $days === 1 ? 'Hoy' : "Ultimos {$days} dias",
                'start' => $start->toDateString(),
                'end' => $end->toDateString(),
            ],
            'summary' => [
                $this->summaryCard('active_chats', 'Conversaciones activas', $current['active_chats'], $previous['active_chats'], 'Conversaciones con actividad en el periodo'),
                $this->summaryCard('incoming_messages', 'Mensajes recibidos', $current['incoming_messages'], $previous['incoming_messages'], 'Mensajes enviados por contactos'),
                $this->summaryCard('pending_chats', 'Esperando respuesta', $current['pending_chats'], $previous['pending_chats'], 'El ultimo mensaje es del contacto'),
                [
                    'key' => 'response_time',
                    'label' => 'Primera respuesta',
                    'value' => $this->formatDuration($current['response_seconds']),
                    'raw_value' => $current['response_seconds'],
                    'delta' => $this->percentageChange($current['response_seconds'], $previous['response_seconds']),
                    'delta_direction' => $this->deltaDirection($current['response_seconds'], $previous['response_seconds'], true),
                    'description' => 'Promedio de bot u operador',
                ],
            ],
            'message_activity' => $this->messageActivity($user, $start, $end),
            'work_queue' => $this->workQueue($user),
            'bot' => $this->botStatus($user, $start, $end),
            'campaigns' => $user->hasPermission('can_manage_campaigns') ? $this->campaigns() : null,
            'recent_activity' => $this->recentActivity($user),
            'system_health' => $user->hasPermission('can_view_audit') ? $this->systemHealth() : null,
        ];
    }

    private function summaryForRange(User $user, CarbonInterface $start, CarbonInterface $end): array
    {
        $messages = $this->messagesQuery($user)
            ->whereBetween('messages.created_at', [$start, $end]);

        $activeChats = (clone $messages)->distinct('messages.chat_id')->count('messages.chat_id');
        $incoming = (clone $messages)->where('messages.sender', 'contact')->count();
        $pending = $this->pendingCountForRange($user, $start, $end);

        return [
            'active_chats' => $activeChats,
            'incoming_messages' => $incoming,
            'pending_chats' => $pending,
            'response_seconds' => $this->averageResponseSeconds($user, $start, $end),
        ];
    }

    private function summaryCard(string $key, string $label, int $value, int $previous, string $description): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'value' => number_format($value, 0, ',', '.'),
            'raw_value' => $value,
            'delta' => $this->percentageChange($value, $previous),
            'delta_direction' => $this->deltaDirection($value, $previous, false),
            'description' => $description,
        ];
    }

    private function percentageChange(int|float|null $current, int|float|null $previous): ?float
    {
        if ($current === null || $previous === null) {
            return null;
        }

        if ((float) $previous === 0.0) {
            return (float) $current === 0.0 ? 0.0 : null;
        }

        return round((($current - $previous) / abs($previous)) * 100, 1);
    }

    private function deltaDirection(int|float|null $current, int|float|null $previous, bool $lowerIsBetter): string
    {
        if ($current === null || $previous === null || $current === $previous) {
            return 'neutral';
        }

        $improved = $lowerIsBetter ? $current < $previous : $current > $previous;

        return $improved ? 'positive' : 'negative';
    }

    private function formatDuration(?int $seconds): string
    {
        if ($seconds === null) {
            return 'Sin datos';
        }

        if ($seconds < 60) {
            return "{$seconds} s";
        }

        if ($seconds < 3600) {
            return round($seconds / 60, 1).' min';
        }

        return round($seconds / 3600, 1).' h';
    }

    private function averageResponseSeconds(User $user, CarbonInterface $start, CarbonInterface $end): ?int
    {
        $messages = $this->messagesQuery($user)
            ->where('messages.created_at', '<=', $end)
            ->where('messages.created_at', '>=', $start->copy()->subDay())
            ->orderBy('messages.chat_id')
            ->orderBy('messages.created_at')
            ->orderBy('messages.id')
            ->get(['messages.chat_id', 'messages.sender', 'messages.created_at'])
            ->groupBy('chat_id');

        return $this->responseSecondsFromMessages($messages, $start, $end);
    }

    public function responseSecondsFromMessages(Collection $messages, CarbonInterface $start, CarbonInterface $end): ?int
    {
        $durations = [];

        foreach ($messages as $chatMessages) {
            $waitingSince = null;

            foreach ($chatMessages as $message) {
                if ($message->sender === 'contact') {
                    if ($waitingSince === null && $message->created_at->betweenIncluded($start, $end)) {
                        $waitingSince = $message->created_at;
                    }

                    continue;
                }

                if ($waitingSince !== null) {
                    $durations[] = $waitingSince->diffInSeconds($message->created_at);
                    $waitingSince = null;
                }
            }
        }

        return $durations === [] ? null : (int) round(array_sum($durations) / count($durations));
    }

    private function pendingCountForRange(User $user, CarbonInterface $start, CarbonInterface $end): int
    {
        $lastMessageBeforeEnd = 'SELECT %s FROM messages WHERE messages.chat_id = chats.id AND messages.created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 1';

        return $this->chatQuery($user)
            ->whereRaw('('.sprintf($lastMessageBeforeEnd, 'sender').") = 'contact'", [$end])
            ->whereRaw('('.sprintf($lastMessageBeforeEnd, 'created_at').') BETWEEN ? AND ?', [$end, $start, $end])
            ->count();
    }

    private function messageActivity(User $user, CarbonInterface $start, CarbonInterface $end): array
    {
        $rows = $this->messagesQuery($user)
            ->whereBetween('messages.created_at', [$start, $end])
            ->selectRaw('DATE(messages.created_at) as day')
            ->selectRaw("SUM(CASE WHEN messages.sender = 'contact' THEN 1 ELSE 0 END) as incoming")
            ->selectRaw("SUM(CASE WHEN messages.sender = 'user' AND messages.sender_subtype = 'bot' THEN 1 ELSE 0 END) as bot")
            ->selectRaw("SUM(CASE WHEN messages.sender = 'user' AND messages.sender_subtype = 'operator' THEN 1 ELSE 0 END) as operator")
            ->selectRaw("SUM(CASE WHEN messages.sender = 'user' AND messages.sender_subtype = 'campaign' THEN 1 ELSE 0 END) as campaign")
            ->groupByRaw('DATE(messages.created_at)')
            ->orderBy('day')
            ->get()
            ->keyBy('day');

        $series = [];
        $cursor = Carbon::parse($start)->startOfDay();

        while ($cursor->lte($end)) {
            $day = $cursor->toDateString();
            $row = $rows->get($day);
            $series[] = [
                'date' => $day,
                'label' => $cursor->format($start->diffInDays($end) > 7 ? 'd/m' : 'D d'),
                'incoming' => (int) ($row?->incoming ?? 0),
                'bot' => (int) ($row?->bot ?? 0),
                'operator' => (int) ($row?->operator ?? 0),
                'campaign' => (int) ($row?->campaign ?? 0),
            ];
            $cursor->addDay();
        }

        return $series;
    }

    private function workQueue(User $user): array
    {
        $items = $this->pendingChatsQuery($user)
            ->with(['contact:id,name,whatsapp_id,profile_pic', 'operator:id,name'])
            ->orderByDesc('latest_message_at')
            ->limit(8)
            ->get()
            ->map(fn (Chat $chat) => [
                'id' => $chat->id,
                'name' => $chat->contact?->name ?: $chat->contact?->whatsapp_id ?: 'Contacto',
                'phone' => $chat->contact?->whatsapp_id,
                'avatar' => $chat->contact?->profile_pic,
                'message' => $chat->latest_message_body ?: 'Mensaje sin contenido',
                'message_at' => $chat->latest_message_at,
                'message_at_human' => $chat->latest_message_at ? Carbon::parse($chat->latest_message_at)->diffForHumans() : null,
                'operator_name' => $chat->operator?->name,
                'bot_enabled' => (bool) $chat->bot_enabled,
                'unread_count' => (int) $chat->unread_count,
            ])
            ->values()
            ->all();

        return [
            'total' => $this->pendingChatsQuery($user)->count(),
            'unread_messages' => (int) $this->chatQuery($user)
                ->withSum(['messages as unread_total' => fn (Builder $query) => $query->where('status', 'received')], 'id')
                ->get()
                ->sum('unread_total'),
            'items' => $items,
        ];
    }

    private function pendingChatsQuery(User $user): Builder
    {
        return $this->chatQuery($user)
            ->addSelect([
                'latest_message_sender' => Message::query()->select('sender')->whereColumn('chat_id', 'chats.id')->latest('created_at')->latest('id')->limit(1),
                'latest_message_body' => Message::query()->select('body')->whereColumn('chat_id', 'chats.id')->latest('created_at')->latest('id')->limit(1),
                'latest_message_at' => Message::query()->select('created_at')->whereColumn('chat_id', 'chats.id')->latest('created_at')->latest('id')->limit(1),
            ])
            ->withCount(['messages as unread_count' => fn (Builder $query) => $query->where('status', 'received')])
            ->whereRaw("(SELECT sender FROM messages WHERE messages.chat_id = chats.id ORDER BY created_at DESC, id DESC LIMIT 1) = 'contact'");
    }

    private function botStatus(User $user, CarbonInterface $start, CarbonInterface $end): array
    {
        $base = $this->chatQuery($user);
        $total = (clone $base)->count();
        $enabled = (clone $base)->where('bot_enabled', true)->count();

        return [
            'enabled_chats' => $enabled,
            'paused_chats' => max(0, $total - $enabled),
            'active_flows' => BotFlow::query()->where('is_active', true)->count(),
            'handoffs' => Activity::query()->where('event', 'bot_disabled')->whereBetween('created_at', [$start, $end])->count(),
            'inactivity_resets' => Activity::query()->where('event', 'bot_inactivity_reset')->whereBetween('created_at', [$start, $end])->count(),
        ];
    }

    private function campaigns(): array
    {
        $totals = Campaign::query()->selectRaw('COALESCE(SUM(sent_count), 0) sent, COALESCE(SUM(delivered_count), 0) delivered, COALESCE(SUM(read_count), 0) `read`, COALESCE(SUM(failed_count), 0) failed')->first();

        return [
            'sent' => (int) $totals->sent,
            'delivered' => (int) $totals->delivered,
            'read' => (int) $totals->read,
            'failed' => (int) $totals->failed,
            'delivery_rate' => $totals->sent > 0 ? round(($totals->delivered / $totals->sent) * 100, 1) : 0,
            'read_rate' => $totals->delivered > 0 ? round(($totals->read / $totals->delivered) * 100, 1) : 0,
            'recent' => Campaign::query()->with('template:id,name')->latest()->limit(4)->get()->map(fn (Campaign $campaign) => [
                'id' => $campaign->id,
                'name' => $campaign->name,
                'status' => $campaign->status,
                'template' => $campaign->template?->name,
                'sent' => $campaign->sent_count,
                'read' => $campaign->read_count,
                'failed' => $campaign->failed_count,
                'created_at_human' => $campaign->created_at?->diffForHumans(),
            ])->all(),
        ];
    }

    private function recentActivity(User $user): array
    {
        $query = Activity::query()->with('causer:id,name')->latest('id');

        if (! $user->hasPermission('can_view_audit')) {
            $query->where('causer_id', $user->id);
        }

        return $query->limit(8)->get()->map(fn (Activity $activity) => [
            'id' => $activity->id,
            'scope' => $activity->log_name,
            'event' => $activity->event,
            'description' => $activity->description,
            'causer_name' => $activity->causer?->name,
            'created_at_human' => $activity->created_at?->diffForHumans(),
        ])->all();
    }

    private function systemHealth(): array
    {
        $settings = SystemSetting::query()->whereIn('key', [
            'integrations.whatsapp.token',
            'integrations.whatsapp.phone_number_id',
            'integrations.alephoo.base_url',
        ])->pluck('value', 'key');

        $whatsappConfigured = trim((string) ($settings['integrations.whatsapp.token'] ?? env('WHATSAPP_ACCESS_TOKEN', ''))) !== ''
            && trim((string) ($settings['integrations.whatsapp.phone_number_id'] ?? env('WHATSAPP_PHONE_ID', ''))) !== '';
        $alephooConfigured = trim((string) ($settings['integrations.alephoo.base_url'] ?? env('HOSPITAL_PERSON_API_BASE', ''))) !== '';
        $failedJobs = DB::table('failed_jobs')->count();
        $queuedJobs = DB::table('jobs')->count();

        return [
            ['key' => 'database', 'label' => 'Base de datos', 'status' => 'ok', 'detail' => 'Conectada'],
            ['key' => 'queue', 'label' => 'Cola de trabajos', 'status' => $failedJobs > 0 ? 'warning' : 'ok', 'detail' => "{$queuedJobs} pendientes · {$failedJobs} fallidos"],
            ['key' => 'whatsapp', 'label' => 'WhatsApp', 'status' => $whatsappConfigured ? 'ok' : 'warning', 'detail' => $whatsappConfigured ? 'Configurado' : 'Configuracion incompleta'],
            ['key' => 'alephoo', 'label' => 'Alephoo', 'status' => $alephooConfigured ? 'ok' : 'neutral', 'detail' => $alephooConfigured ? 'Configurado' : 'Sin configurar'],
        ];
    }

    private function operationalAlerts(User $user): array
    {
        $campaignFailures = Campaign::query()->sum('failed_count');
        if ($campaignFailures > 0 && $user->hasPermission('can_manage_campaigns')) {
            $alerts[] = ['severity' => 'warning', 'title' => 'Fallos en campañas', 'detail' => "{$campaignFailures} destinatarios fallaron", 'path' => '/campaigns-panel'];
        }

        return $alerts;
    }

    private function alephooResults(CarbonInterface $start, CarbonInterface $end): array
    {
        $events = Activity::query()->whereBetween('created_at', [$start, $end])
            ->where('event', 'like', 'alephoo_%')->selectRaw('event, COUNT(*) total')->groupBy('event')->pluck('total', 'event');

        return [
            'appointments_created' => (int) ($events['alephoo_appointment_create_succeeded'] ?? 0),
            'appointments_cancelled' => (int) ($events['alephoo_appointment_cancel_succeeded'] ?? 0),
            'patients_created' => (int) ($events['alephoo_patient_create_succeeded'] ?? 0),
            'errors' => (int) $events->filter(fn ($total, $event) => str_contains($event, 'failed'))->sum(),
        ];
    }

    private function chatQuery(User $user): Builder
    {
        $query = Chat::query();

        if (! $user->hasPermission('can_view_all_chats')) {
            $query->where(fn (Builder $scope) => $scope->whereNull('operator_id')->orWhere('operator_id', $user->id));
        }

        return $query;
    }

    private function messagesQuery(User $user): Builder
    {
        $query = Message::query();

        if (! $user->hasPermission('can_view_all_chats')) {
            $query->join('chats', 'chats.id', '=', 'messages.chat_id')
                ->where(fn ($scope) => $scope->whereNull('chats.operator_id')->orWhere('chats.operator_id', $user->id));
        }

        return $query;
    }
}
