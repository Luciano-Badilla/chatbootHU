<?php

namespace App\Console\Commands;

use App\Services\StorageUsageService;
use Illuminate\Console\Command;

class ScanStorageFiles extends Command
{
    protected $signature = 'storage:scan';

    protected $description = 'Carga en el registro de almacenamiento los archivos que ya existen en el disco public';

    public function handle(StorageUsageService $storage): int
    {
        $result = $storage->scan();

        $this->info("Archivos registrados: {$result['files']}. Registros quitados por archivo inexistente: {$result['removed']}.");

        return self::SUCCESS;
    }
}
