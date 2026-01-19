<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->timestamp('last_user_message_at')->nullable()->after('bot_state');
            $table->index('last_user_message_at');
        });
    }

    public function down(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->dropIndex(['last_user_message_at']);
            $table->dropColumn('last_user_message_at');
        });
    }
};
