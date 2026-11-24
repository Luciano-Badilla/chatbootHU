<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            // Etiqueta operativa visible para el operador (ej. "reprogramacion").
            $table->string('tag', 40)->nullable()->after('title')->index();
        });
    }

    public function down(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->dropIndex(['tag']);
            $table->dropColumn('tag');
        });
    }
};
