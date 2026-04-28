<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('roles')) {
            return;
        }

        DB::table('roles')->upsert([
            ['id' => 1, 'name' => 'Administrador'],
            ['id' => 2, 'name' => 'Supervisor'],
            ['id' => 3, 'name' => 'Operador'],
        ], ['id'], ['name']);
    }

    public function down(): void
    {
        if (!Schema::hasTable('roles')) {
            return;
        }

        DB::table('roles')->upsert([
            ['id' => 1, 'name' => 'admin'],
            ['id' => 2, 'name' => 'supervisor'],
            ['id' => 3, 'name' => 'operator'],
        ], ['id'], ['name']);
    }
};
