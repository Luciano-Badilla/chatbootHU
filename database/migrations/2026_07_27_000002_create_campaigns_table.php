<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campaigns', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->foreignId('whatsapp_template_id')->constrained()->restrictOnDelete();
            $table->string('status', 30)->default('draft');
            $table->string('source_filename')->nullable();
            $table->unsignedInteger('total_count')->default(0);
            $table->unsignedInteger('valid_count')->default(0);
            $table->unsignedInteger('invalid_count')->default(0);
            $table->unsignedInteger('duplicate_count')->default(0);
            $table->unsignedInteger('sent_count')->default(0);
            $table->unsignedInteger('delivered_count')->default(0);
            $table->unsignedInteger('read_count')->default(0);
            $table->unsignedInteger('failed_count')->default(0);
            $table->json('import_errors')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('campaigns');
    }
};
