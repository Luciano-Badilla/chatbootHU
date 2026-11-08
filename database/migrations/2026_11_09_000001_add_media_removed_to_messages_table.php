<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            // Ruta original del adjunto cuando se desvincula por almacenamiento.
            // El mensaje conserva su texto; media_url queda vacío y media_removed_at marca la fecha.
            $table->text('media_removed_url')->nullable();
            $table->timestamp('media_removed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropColumn(['media_removed_url', 'media_removed_at']);
        });
    }
};
