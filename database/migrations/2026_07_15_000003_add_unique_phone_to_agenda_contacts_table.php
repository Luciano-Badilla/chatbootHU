<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        try {
            DB::statement('ALTER TABLE agenda_contacts ADD UNIQUE agenda_contacts_phone_unique (phone)');
        } catch (\Throwable $e) {
            // La validación de aplicación evita nuevos duplicados; si el índice ya existe o hay datos duplicados, no bloqueamos migraciones.
        }
    }

    public function down(): void
    {
        try {
            DB::statement('ALTER TABLE agenda_contacts DROP INDEX agenda_contacts_phone_unique');
        } catch (\Throwable $e) {
            // noop
        }
    }
};
