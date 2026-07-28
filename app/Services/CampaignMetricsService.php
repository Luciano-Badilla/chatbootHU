<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\CampaignRecipient;

class CampaignMetricsService
{
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

        if ($campaign->status === 'running' && $remaining === 0) {
            $updates['status'] = 'completed';
            $updates['finished_at'] = now();
        }

        $campaign->update($updates);
    }
}
