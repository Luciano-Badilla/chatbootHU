<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('agenda_contacts', function (Blueprint $table) {
            $table->id();
            $table->string('first_name')->nullable();
            $table->string('last_name')->nullable();
            $table->string('formatted_name');
            $table->string('phone')->unique();
            $table->string('organization')->nullable();
            $table->string('title')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['formatted_name', 'phone']);
            $table->index('deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agenda_contacts');
    }
};
