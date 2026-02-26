<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->string('bot_node_type', 30)->nullable()->after('sender_subtype');
            $table->json('interactive_options')->nullable()->after('bot_node_type');
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropColumn(['bot_node_type', 'interactive_options']);
        });
    }
};

