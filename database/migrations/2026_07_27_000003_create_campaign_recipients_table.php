<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campaign_recipients', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('row_number')->nullable();
            $table->string('phone', 32);
            $table->string('name')->nullable();
            $table->json('variables')->nullable();
            $table->text('rendered_body')->nullable();
            $table->string('status', 30)->default('pending');
            $table->string('whatsapp_message_id')->nullable()->unique();
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->string('error_code')->nullable();
            $table->text('error_message')->nullable();
            $table->timestamp('queued_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamp('read_at')->nullable();
            $table->timestamp('failed_at')->nullable();
            $table->timestamps();

            $table->unique(['campaign_id', 'phone']);
            $table->index(['campaign_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('campaign_recipients');
    }
};
