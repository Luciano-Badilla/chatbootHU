<?php

namespace App\Jobs;

use App\Models\CampaignRecipient;
use App\Models\Chat;
use App\Models\Contact;
use App\Models\Message;
use App\Services\CampaignMetricsService;
use App\Services\WhatsAppTemplateMessageService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

class SendCampaignRecipient implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public array $backoff = [60, 300];

    public function __construct(public readonly int $recipientId)
    {
        $this->onQueue('campaigns');
    }

    public function handle(
        WhatsAppTemplateMessageService $messageService,
        CampaignMetricsService $metricsService,
    ): void {
        $recipient = CampaignRecipient::query()
            ->with('campaign.template')
            ->find($this->recipientId);

        if (! $recipient || ! $recipient->campaign || ! $recipient->campaign->template) {
            return;
        }

        if ($recipient->campaign->status !== 'running') {
            if (in_array($recipient->status, ['queued', 'processing'], true)) {
                $recipient->update(['status' => 'pending']);
            }

            return;
        }

        if (! in_array($recipient->status, ['queued', 'processing'], true)) {
            return;
        }

        $claimed = CampaignRecipient::query()
            ->whereKey($recipient->id)
            ->where(function ($query) {
                $query
                    ->where('status', 'queued')
                    ->orWhere(function ($staleQuery) {
                        $staleQuery
                            ->where('status', 'processing')
                            ->where('updated_at', '<=', now()->subMinutes(5));
                    });
            })
            ->update([
                'status' => 'processing',
                'attempts' => DB::raw('attempts + 1'),
                'error_code' => null,
                'error_message' => null,
                'updated_at' => now(),
            ]);

        if ($claimed !== 1) {
            return;
        }

        $recipient->refresh();

        try {
            $response = $messageService->send(
                $recipient->campaign->template,
                $recipient->phone,
                $recipient->variables ?? [],
            );
        } catch (Throwable $exception) {
            $recipient->update([
                'status' => 'queued',
                'error_message' => Str::limit($exception->getMessage(), 2000, ''),
            ]);
            throw $exception;
        }

        if (! $response->successful()) {
            $errorCode = (string) ($response->json('error.code') ?? $response->status());
            $errorMessage = (string) ($response->json('error.message') ?? $response->body());

            if ($response->status() === 429 || $response->serverError()) {
                $recipient->update([
                    'status' => 'queued',
                    'error_code' => $errorCode,
                    'error_message' => Str::limit($errorMessage, 2000, ''),
                ]);
                throw new \RuntimeException($errorMessage);
            }

            $recipient->update([
                'status' => 'failed',
                'error_code' => $errorCode,
                'error_message' => Str::limit($errorMessage, 2000, ''),
                'failed_at' => now(),
            ]);
            $metricsService->refresh($recipient->campaign_id);

            return;
        }

        $whatsappMessageId = (string) $response->json('messages.0.id');

        if ($whatsappMessageId === '') {
            throw new \RuntimeException('Meta acepto la solicitud sin devolver un identificador de mensaje.');
        }

        DB::transaction(function () use ($recipient, $whatsappMessageId) {
            $contact = Contact::query()->firstOrCreate(
                ['whatsapp_id' => $recipient->phone],
                ['name' => $recipient->name ?: $recipient->phone],
            );
            $contact->update([
                'name' => $recipient->name ?: $contact->name,
                'last_interaction_at' => now(),
            ]);

            $chat = Chat::query()->firstOrCreate(
                ['contact_id' => $contact->id, 'status' => 'open'],
                ['title' => $contact->name ?: $recipient->phone],
            );

            Message::query()->firstOrCreate(
                ['whatsapp_message_id' => $whatsappMessageId],
                [
                    'chat_id' => $chat->id,
                    'sender' => 'user',
                    'sender_subtype' => 'campaign',
                    'message_type' => 'template',
                    'body' => $recipient->rendered_body,
                    'template_name' => $recipient->campaign->template->name,
                    'template_language' => $recipient->campaign->template->language,
                    'status' => 'sent',
                ],
            );

            $recipient->update([
                'status' => 'sent',
                'whatsapp_message_id' => $whatsappMessageId,
                'sent_at' => now(),
                'error_code' => null,
                'error_message' => null,
            ]);
        });

        $metricsService->refresh($recipient->campaign_id);
    }

    public function failed(Throwable $exception): void
    {
        $recipient = CampaignRecipient::query()->find($this->recipientId);
        if (! $recipient) {
            return;
        }

        $recipient->update([
            'status' => 'failed',
            'error_message' => Str::limit($exception->getMessage(), 2000, ''),
            'failed_at' => now(),
        ]);

        app(CampaignMetricsService::class)->refresh($recipient->campaign_id);
    }
}
