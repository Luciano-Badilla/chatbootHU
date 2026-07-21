<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        DB::statement("ALTER TABLE messages MODIFY message_type ENUM('text','image','video','audio','document','template','contacts','location') NOT NULL DEFAULT 'text'");
    }

    public function down(): void
    {
        DB::statement("ALTER TABLE messages MODIFY message_type ENUM('text','image','video','audio','document','template','contacts') NOT NULL DEFAULT 'text'");
    }
};
