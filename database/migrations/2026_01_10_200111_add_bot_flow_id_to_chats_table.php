<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            // si querés obligarlo, sacale nullable() y definí default primero
            $table->unsignedBigInteger('bot_flow_id')->nullable()->after('contact_id');

            $table->foreign('bot_flow_id')
                ->references('id')
                ->on('bot_flows')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->dropForeign(['bot_flow_id']);
            $table->dropColumn('bot_flow_id');
        });
    }
};
