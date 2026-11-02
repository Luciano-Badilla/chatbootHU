<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->index(['created_at', 'chat_id'], 'messages_created_at_chat_id_idx');
            $table->index(['chat_id', 'created_at'], 'messages_chat_id_created_at_idx');
            $table->index(['status', 'chat_id'], 'messages_status_chat_id_idx');
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropIndex('messages_created_at_chat_id_idx');
            $table->dropIndex('messages_chat_id_created_at_idx');
            $table->dropIndex('messages_status_chat_id_idx');
        });
    }
};
