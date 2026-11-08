<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('storage_files', function (Blueprint $table) {
            $table->id();
            // Ruta relativa al disco public (ej. whatsapp/12/image_x.jpg).
            $table->string('path', 512)->unique();
            $table->string('category', 32);
            $table->unsignedBigInteger('size_bytes')->default(0);
            $table->string('mime', 127)->nullable();
            $table->timestamp('modified_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['category', 'deleted_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storage_files');
    }
};
