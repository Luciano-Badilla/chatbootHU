<?php

namespace App\Console\Commands;

use App\Models\Chat;
use App\Services\BotInactivityService;
use Carbon\Carbon;
use Illuminate\Console\Command;

class ExpireInactiveBotChats extends Command
{
    protected $signature = 'bot:expire-inactive-chats {--dry-run : Solo muestra cuantos chats vencerian}';

    protected $description = 'Envia el mensaje de inactividad y reinicia chats del bot que quedaron a medias';

    public function handle(BotInactivityService $botInactivityService): int
    {
        $timeoutMinutes = $botInactivityService->inactivityTimeoutMinutes();
        $cutoff = Carbon::now()->subMinutes($timeoutMinutes);

        $query = Chat::query()
            ->with('contact')
            ->whereNotNull('last_user_message_at')
            ->where('last_user_message_at', '<=', $cutoff)
            ->whereNotNull('bot_flow_id');

        if ($this->option('dry-run')) {
            $count = (clone $query)->count();
            $this->info("Dry run: {$count} chats candidatos con timeout >= {$timeoutMinutes} minutos.");
            return self::SUCCESS;
        }

        $processed = 0;

        $query->orderBy('id')->chunkById(100, function ($chats) use ($botInactivityService, &$processed) {
            foreach ($chats as $chat) {
                if ($botInactivityService->processExpiredChat($chat)) {
                    $processed++;
                }
            }
        });

        $this->info("Chats procesados por inactividad: {$processed}.");

        return self::SUCCESS;
    }
}
