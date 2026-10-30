<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->timestamp('last_operator_message_at')->nullable()->after('last_user_message_at')->index();
        });

        DB::table('chats')
            ->where('status', 'open')
            ->where('attention_status', 'assigned')
            ->whereNotNull('operator_id')
            ->orderBy('id')
            ->chunkById(100, function ($chats): void {
                foreach ($chats as $chat) {
                    $latestMessage = DB::table('messages')
                        ->where('chat_id', $chat->id)
                        ->orderByDesc('id')
                        ->first(['sender', 'sender_subtype', 'operator_name', 'created_at']);

                    $isOperatorMessage = $latestMessage
                        && ($latestMessage->sender_subtype === 'operator'
                            || ($latestMessage->sender === 'user' && filled($latestMessage->operator_name)));

                    if ($isOperatorMessage) {
                        DB::table('chats')
                            ->where('id', $chat->id)
                            ->update(['last_operator_message_at' => $latestMessage->created_at]);
                    }
                }
            });
    }

    public function down(): void
    {
        Schema::table('chats', function (Blueprint $table) {
            $table->dropColumn('last_operator_message_at');
        });
    }
};
