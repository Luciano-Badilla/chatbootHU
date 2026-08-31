<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quick_replies', function (Blueprint $table) {
            $table->id();
            $table->string('title', 100);
            $table->text('body');
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        DB::table('quick_replies')->insert([
            ['title' => 'Saludo inicial', 'body' => '¡Hola! ¿Cómo estás? Soy parte del equipo de atención. ¿En qué podemos ayudarte?', 'sort_order' => 10, 'active' => true, 'created_at' => now(), 'updated_at' => now()],
            ['title' => 'Aguardar un momento', 'body' => 'Gracias por la información. Dame un momento mientras reviso tu consulta, por favor.', 'sort_order' => 20, 'active' => true, 'created_at' => now(), 'updated_at' => now()],
            ['title' => 'Solicitar datos', 'body' => 'Para poder ayudarte, ¿podrías indicarme tu nombre completo y número de documento?', 'sort_order' => 30, 'active' => true, 'created_at' => now(), 'updated_at' => now()],
            ['title' => 'Consulta resuelta', 'body' => '¿Pude resolver tu consulta o necesitás ayuda con algo más?', 'sort_order' => 40, 'active' => true, 'created_at' => now(), 'updated_at' => now()],
            ['title' => 'Despedida', 'body' => '¡Gracias por comunicarte con nosotros! Que tengas un excelente día.', 'sort_order' => 50, 'active' => true, 'created_at' => now(), 'updated_at' => now()],
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('quick_replies');
    }
};
