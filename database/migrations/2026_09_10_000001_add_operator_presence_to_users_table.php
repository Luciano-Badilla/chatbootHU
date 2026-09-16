<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('current_chat_id')->nullable()->after('operator_availability')->constrained('chats')->nullOnDelete();
            $table->timestamp('last_operator_activity_at')->nullable()->after('current_chat_id')->index();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['current_chat_id']);
            $table->dropIndex(['last_operator_activity_at']);
            $table->dropColumn(['current_chat_id', 'last_operator_activity_at']);
        });
    }
};
