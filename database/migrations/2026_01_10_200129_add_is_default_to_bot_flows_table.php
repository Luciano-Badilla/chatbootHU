<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('bot_flows', function (Blueprint $table) {
            $table->boolean('is_default')->default(false)->after('is_active');
        });
    }

    public function down(): void
    {

        Schema::table('bot_flows', function (Blueprint $table) {
            $table->dropColumn('is_default');
        });
    }
};
