<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('chat_id')->constrained()->onDelete('cascade');
            $table->enum('sender', ['user', 'contact']);
            $table->enum('message_type', ['text','image','video','audio','document','template'])->default('text');
            $table->text('body')->nullable();
            $table->string('media_url')->nullable();
            $table->string('media_name')->nullable();
            $table->string('template_name')->nullable();
            $table->string('template_language')->nullable();
            $table->enum('status', ['sent','delivered','read','failed','received'])->default('sent');
            $table->string('whatsapp_message_id')->unique()->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
    }
};
