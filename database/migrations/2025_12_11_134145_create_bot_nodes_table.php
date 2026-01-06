<?php

// database/migrations/2025_12_11_000001_create_bot_nodes_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up()
    {
        Schema::create('bot_nodes', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('flow_id');
            $table->string('key')->nullable(); // identificador legible: 'menu_principal', 'pedir_dni'
            $table->enum('type', ['text', 'buttons', 'list', 'input', 'handoff'])->default('text');
            $table->text('body')->nullable(); // texto principal del mensaje
            $table->json('settings')->nullable(); // botones, listas, validación, etc.
            $table->unsignedBigInteger('next_node_id')->nullable(); // para los nodos que tienen un siguiente “lineal”
            $table->timestamps();

            $table->foreign('flow_id')->references('id')->on('bot_flows')->onDelete('cascade');
        });
    }

    public function down()
    {
        Schema::dropIfExists('bot_nodes');
    }
};
