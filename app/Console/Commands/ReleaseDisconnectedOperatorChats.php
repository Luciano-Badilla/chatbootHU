<?php

namespace App\Console\Commands;

use App\Services\AuditService;
use App\Services\OperatorAvailabilityService;
use Illuminate\Console\Command;

class ReleaseDisconnectedOperatorChats extends Command
{
    protected $signature = 'operators:release-disconnected-chats';

    protected $description = 'Libera chats y la conversación actual de usuarios que perdieron el heartbeat';

    public function handle(OperatorAvailabilityService $availabilityService, AuditService $auditService): int
    {
        $results = $availabilityService->releaseDisconnectedOperators();

        foreach ($results as $result) {
            $operator = $result['operator'];
            foreach ($result['chats'] as $chat) {
                $auditService->recordChatAction(
                    'operator_disconnected_released',
                    'Libero el chat por desconexión del operador '.$operator->name,
                    $chat,
                    null,
                    [
                        'meta' => [
                            'previous_operator_id' => $operator->id,
                            'reassigned_operator_id' => $chat->operator_id,
                            'reason' => 'heartbeat_expired',
                        ],
                    ],
                );
            }
        }

        $this->info("Operadores procesados por desconexión: {$results->count()}.");

        return self::SUCCESS;
    }
}
