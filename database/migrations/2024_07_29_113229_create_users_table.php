<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Crear la tabla 'users' con los campos extendidos.
        Schema::create('users', function (Blueprint $table) {
            $table->id(); // ID autoincremental
            $table->string('name'); // Nombre y apellido
            $table->string('email')->unique(); // Correo electrónico único
            $table->string('password'); // Contraseña
            $table->string('remember_token', 100)->nullable(); // Token de recordatorio
            $table->timestamps(); // Timestamps (created_at, updated_at)
            $table->boolean('validated')->default(0); // Validado (0 o 1)
            $table->boolean('requestsPassword')->default(0); // Solicitar contraseña (0 o 1)
            $table->integer('role_id')->default(0);
        });

        // Crear la tabla 'password_reset_tokens'.
        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary(); // Correo electrónico (clave primaria)
            $table->string('token'); // Token de restablecimiento de contraseña
            $table->timestamp('created_at')->nullable(); // Fecha de creación del token
        });

        // Crear la tabla 'sessions'.
        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary(); // ID de sesión (clave primaria)
            $table->foreignId('user_id')->nullable()->index(); // Relación con la tabla 'users'
            $table->string('ip_address', 45)->nullable(); // Dirección IP
            $table->text('user_agent')->nullable(); // Información del agente de usuario
            $table->longText('payload'); // Carga útil de la sesión
            $table->integer('last_activity')->index(); // Última actividad
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Eliminar las tablas
        Schema::dropIfExists('users');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('sessions');
    }
};
