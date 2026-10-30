<?php

namespace App\Console\Commands;

use App\Models\Chat;
use App\Services\BotInactivityService;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class ExpireInactiveBotChats extends Command
{
    protected $signature = 'bot:expire-inactive-chats {--dry-run : Solo muestra cuantos chats vencerian}';

    protected $description = 'Archiva chats por inactividad del bot o falta de respuesta del paciente al operador';

    public function handle(BotInactivityService $botInactivityService): int
    {
        $timeoutMinutes = $botInactivityService->inactivityTimeoutMinutes();
        $cutoff = Carbon::now()->subMinutes($timeoutMinutes);

        $botChats = Chat::query()
            ->with('contact')
            ->whereNotNull('last_user_message_at')
            ->where('last_user_message_at', '<=', $cutoff)
            ->whereNotNull('bot_flow_id')
            ->where('bot_enabled', true)
            ->whereNull('operator_id')
            ->where('status', 'open')
            ->where(function ($query) {
                $query->whereNull('attention_status')->orWhere('attention_status', 'bot');
            });
        $operatorChats = Chat::query()
            ->with(['contact', 'operator', 'lastOperator'])
            ->whereNotNull('last_operator_message_at')
            ->where('last_operator_message_at', '<=', $cutoff)
            ->where('status', 'open')
            ->where('attention_status', 'assigned')
            ->whereNotNull('operator_id');

        if ($this->option('dry-run')) {
            $count = (clone $botChats)->count() + (clone $operatorChats)->count();
            $this->info("Dry run: {$count} chats candidatos con timeout >= {$timeoutMinutes} minutos.");
            return self::SUCCESS;
        }

        $processed = 0;

        foreach ([
            [$botChats, 'processExpiredChat'],
            [$operatorChats, 'processExpiredOperatorChat'],
        ] as [$query, $processor]) {
            $query->orderBy('id')->chunkById(100, function ($chats) use ($botInactivityService, &$processed, $processor) {
                foreach ($chats as $chat) {
                    try {
                        if ($botInactivityService->{$processor}($chat)) {
                            $processed++;
                        }
                    } catch (\Throwable $e) {
                        Log::error('Error procesando el vencimiento por inactividad de un chat.', [
                            'chat_id' => $chat->id,
                            'processor' => $processor,
                            'error' => $e->getMessage(),
                        ]);
                    }
                }
            });
        }

        $this->info("Chats procesados por inactividad: {$processed}.");

        return self::SUCCESS;
    }
}
