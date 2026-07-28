<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('whatsapp_templates', function (Blueprint $table) {
            $table->id();
            $table->string('meta_template_id')->nullable();
            $table->string('name');
            $table->string('language', 20)->default('es_AR');
            $table->string('category', 30)->default('UTILITY');
            $table->string('status', 30)->default('APPROVED');
            $table->text('body');
            $table->json('variable_keys')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['name', 'language']);
            $table->index(['status', 'category']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('whatsapp_templates');
    }
};
