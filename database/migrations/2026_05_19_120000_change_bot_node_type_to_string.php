<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        DB::statement("ALTER TABLE bot_nodes MODIFY type VARCHAR(50) NOT NULL DEFAULT 'text'");
    }

    public function down(): void
    {
        DB::statement("ALTER TABLE bot_nodes MODIFY type ENUM('text', 'buttons', 'list', 'input', 'handoff', 'person_lookup') NOT NULL DEFAULT 'text'");
    }
};
