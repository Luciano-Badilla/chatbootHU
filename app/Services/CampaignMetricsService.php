<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\CampaignRecipient;

class CampaignMetricsService
{
    public function __construct(private readonly AuditService $auditService)
    {
    }

    public function refresh(int $campaignId): void
    {
        $counts = CampaignRecipient::query()
            ->where('campaign_id', $campaignId)
            ->selectRaw("
                SUM(CASE WHEN status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END) as sent_count,
                SUM(CASE WHEN status IN ('delivered', 'read') THEN 1 ELSE 0 END) as delivered_count,
                SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) as read_count,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
                SUM(CASE WHEN status IN ('pending', 'queued', 'processing') THEN 1 ELSE 0 END) as remaining_count
            ")
            ->first();

        $remaining = (int) ($counts?->remaining_count ?? 0);
        $campaign = Campaign::query()->find($campaignId);

        if (! $campaign) {
            return;
        }

        $updates = [
            'sent_count' => (int) ($counts?->sent_count ?? 0),
            'delivered_count' => (int) ($counts?->delivered_count ?? 0),
            'read_count' => (int) ($counts?->read_count ?? 0),
            'failed_count' => (int) ($counts?->failed_count ?? 0),
        ];

        $completedNow = $campaign->status === 'running' && $remaining === 0;
        if ($completedNow) {
            $updates['status'] = 'completed';
            $updates['finished_at'] = now();
        }

        $campaign->update($updates);

        if ($completedNow) {
            $this->auditService->record(
                'campaigns',
                'campaign_completed',
                'Completo automaticamente la campaña',
                null,
                $campaign,
                [
                    'after' => [
                        'status' => 'completed',
                        'sent_count' => $campaign->sent_count,
                        'delivered_count' => $campaign->delivered_count,
                        'read_count' => $campaign->read_count,
                        'failed_count' => $campaign->failed_count,
                    ],
                ],
            );
        }
    }
}
