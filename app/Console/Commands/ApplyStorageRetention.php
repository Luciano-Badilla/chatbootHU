<?php

namespace App\Console\Commands;

use App\Services\StorageCleanupService;
use App\Services\StorageUsageService;
use Illuminate\Console\Command;

class ApplyStorageRetention extends Command
{
    protected $signature = 'storage:apply-retention';

    protected $description = 'Aplica las reglas automáticas de almacenamiento (medios del bot sin uso y vaciado de papelera)';

    public function handle(StorageUsageService $storage, StorageCleanupService $cleanup): int
    {
        // Primero se registran los archivos nuevos, para que las reglas vean el disco actual.
        $scan = $storage->scan();
        $result = $cleanup->applyRetention();

        $this->info(sprintf(
            'Archivos registrados: %d. Enviados a papelera por regla: %d. Borrados definitivamente por regla: %d.',
            $scan['files'],
            $result['trashed'],
            $result['purged'],
        ));

        return self::SUCCESS;
    }
}
