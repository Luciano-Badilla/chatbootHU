<?php

// database/migrations/2025_12_10_000000_add_bot_fields_to_chats.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up()
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->boolean('bot_enabled')->default(true)->after('status'); // true = responde el bot
            $table->string('bot_step')->nullable()->after('bot_enabled');   // paso actual del flujo
            $table->json('bot_state')->nullable()->after('bot_step');       // variables (dni, etc.)
        });
    }

    public function down()
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->dropColumn(['bot_enabled', 'bot_step', 'bot_state']);
        });
    }
};
