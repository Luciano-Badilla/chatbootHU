<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('roles')) {
            Schema::create('roles', function (Blueprint $table) {
                $table->id();
                $table->string('name')->unique();
                $table->timestamps();
            });
        }

        DB::table('roles')->upsert([
            ['id' => 1, 'name' => 'Administrador'],
            ['id' => 2, 'name' => 'Supervisor'],
            ['id' => 3, 'name' => 'Operador'],
        ], ['id'], ['name']);

        if (Schema::hasTable('users')) {
            DB::table('users')
                ->where(function ($query) {
                    $query->whereNull('role_id')->orWhere('role_id', 0);
                })
                ->update(['role_id' => 3]);
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('users')) {
            DB::table('users')
                ->where('role_id', 3)
                ->update(['role_id' => 0]);
        }

        Schema::dropIfExists('roles');
    }
};
