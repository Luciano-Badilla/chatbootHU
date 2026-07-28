<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('whatsapp_templates', function (Blueprint $table) {
            $table->json('meta_components')->nullable()->after('body');
            $table->boolean('is_supported')->default(true)->after('meta_components');
            $table->timestamp('synced_at')->nullable()->after('created_by');

            $table->index(['status', 'is_supported']);
        });
    }

    public function down(): void
    {
        Schema::table('whatsapp_templates', function (Blueprint $table) {
            $table->dropIndex(['status', 'is_supported']);
            $table->dropColumn(['meta_components', 'is_supported', 'synced_at']);
        });
    }
};
