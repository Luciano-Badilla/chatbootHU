<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->unsignedBigInteger('bot_node_id')->nullable()->after('bot_flow_id');

            // FK opcional: si borrás nodos, dejamos null el puntero
            $table->foreign('bot_node_id')
                ->references('id')
                ->on('bot_nodes')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->dropForeign(['bot_node_id']);
            $table->dropColumn('bot_node_id');
        });
    }
};
