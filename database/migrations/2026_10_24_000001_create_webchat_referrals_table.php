<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webchat_referrals', function (Blueprint $table) {
            $table->id();
            $table->string('token', 32)->unique();
            $table->foreignId('source_chat_id')->constrained('chats')->cascadeOnDelete();
            $table->foreignId('source_message_id')->nullable()->constrained('messages')->nullOnDelete();
            $table->timestamp('sent_at')->nullable()->index();
            $table->timestamp('entered_at')->nullable()->index();
            $table->timestamps();
            $table->index(['source_chat_id', 'sent_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('webchat_referrals');
    }
};
