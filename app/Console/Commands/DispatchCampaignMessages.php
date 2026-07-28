<?php

namespace App\Console\Commands;

use App\Jobs\SendCampaignRecipient;
use App\Models\Campaign;
use App\Models\CampaignRecipient;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class DispatchCampaignMessages extends Command
{
    protected $signature = 'campaigns:dispatch {--limit=100 : Cantidad maxima de destinatarios a encolar por ejecucion}';

    protected $description = 'Encola destinatarios pendientes de las campañas activas';

    public function handle(): int
    {
        $limit = max(1, min(1000, (int) $this->option('limit')));
        $remaining = $limit;
        $dispatched = 0;

        Campaign::query()
            ->where('status', 'running')
            ->orderBy('id')
            ->each(function (Campaign $campaign) use (&$remaining, &$dispatched) {
                if ($remaining < 1) {
                    return false;
                }

                $recipientIds = DB::transaction(function () use ($campaign, $remaining) {
                    $recipients = CampaignRecipient::query()
                        ->where('campaign_id', $campaign->id)
                        ->where('status', 'pending')
                        ->orderBy('id')
                        ->lockForUpdate()
                        ->limit($remaining)
                        ->get(['id']);

                    if ($recipients->isEmpty()) {
                        return [];
                    }

                    $ids = $recipients->pluck('id')->all();
                    CampaignRecipient::query()
                        ->whereIn('id', $ids)
                        ->update([
                            'status' => 'queued',
                            'queued_at' => now(),
                        ]);

                    return $ids;
                });

                foreach ($recipientIds as $recipientId) {
                    try {
                        SendCampaignRecipient::dispatch($recipientId);
                        $dispatched++;
                        $remaining--;
                    } catch (\Throwable $exception) {
                        CampaignRecipient::query()
                            ->whereKey($recipientId)
                            ->where('status', 'queued')
                            ->update([
                                'status' => 'pending',
                                'queued_at' => null,
                            ]);

                        $this->error("No se pudo encolar el destinatario {$recipientId}: {$exception->getMessage()}");
                    }
                }

                return $remaining > 0;
            });

        $this->info("Destinatarios encolados: {$dispatched}.");

        return self::SUCCESS;
    }
}
