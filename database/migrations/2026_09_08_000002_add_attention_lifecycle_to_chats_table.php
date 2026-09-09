<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->string('attention_status', 30)->default('bot')->after('status')->index();
            $table->timestamp('assigned_at')->nullable()->after('operator_id');
            $table->timestamp('closed_at')->nullable()->after('last_user_message_at')->index();
            $table->string('closed_by', 20)->nullable()->after('closed_at');
            $table->foreignId('closed_by_user_id')->nullable()->after('closed_by')->constrained('users')->nullOnDelete();
            $table->foreignId('last_operator_id')->nullable()->after('closed_by_user_id')->constrained('users')->nullOnDelete();
            $table->index(['status', 'attention_status']);
        });
    }

    public function down(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->dropForeign(['closed_by_user_id']);
            $table->dropForeign(['last_operator_id']);
            $table->dropIndex(['status', 'attention_status']);
            $table->dropIndex(['attention_status']);
            $table->dropIndex(['closed_at']);
            $table->dropColumn(['attention_status', 'assigned_at', 'closed_at', 'closed_by', 'closed_by_user_id', 'last_operator_id']);
        });
    }
};
