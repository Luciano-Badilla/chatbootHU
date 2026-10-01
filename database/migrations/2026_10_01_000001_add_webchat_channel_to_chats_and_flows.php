<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->string('channel', 32)->default('whatsapp')->after('contact_id');
            $table->string('webchat_token', 80)->nullable()->unique()->after('channel');
            $table->timestamp('webchat_last_seen_at')->nullable()->after('webchat_token');
        });

        Schema::table('bot_flows', function (Blueprint $table) {
            $table->json('channels')->nullable()->after('is_active');
        });

        // Los flujos existentes siguen siendo de WhatsApp hasta que se habiliten explícitamente para webchat.
        DB::table('bot_flows')->whereNull('channels')->update(['channels' => json_encode(['whatsapp'])]);
    }

    public function down(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->dropUnique(['webchat_token']);
            $table->dropColumn(['channel', 'webchat_token', 'webchat_last_seen_at']);
        });

        Schema::table('bot_flows', function (Blueprint $table) {
            $table->dropColumn('channels');
        });
    }
};
