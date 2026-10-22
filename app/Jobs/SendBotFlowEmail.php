<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

class SendBotFlowEmail implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public array $backoff = [60, 300];

    public function __construct(
        public readonly int $chatId,
        public readonly int $nodeId,
        public readonly string $recipient,
        public readonly string $subject,
        public readonly string $html,
    ) {}

    public function handle(): void
    {
        Mail::html($this->html, function ($message): void {
            $message->to($this->recipient)->subject($this->subject);
        });
    }

    public function failed(Throwable $exception): void
    {
        Log::error('No se pudo enviar un correo de flujo después de los reintentos.', [
            'chat_id' => $this->chatId,
            'node_id' => $this->nodeId,
            'exception' => $exception::class,
        ]);
    }
}
