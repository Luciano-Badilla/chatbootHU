<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Mi perfil: ver datos, cambiar nombre y email, cambiar contraseña.
 * Corre siempre sobre SQLite en memoria: nunca toca la base MySQL de desarrollo.
 */
class MyProfileTest extends TestCase
{
    public function createApplication(): Application
    {
        $app = require __DIR__.'/../../bootstrap/app.php';
        $app->afterBootstrapping(LoadConfiguration::class, function ($app) {
            $app['config']->set('app.url', 'http://localhost');
            $app['config']->set('database.default', 'sqlite');
            $app['config']->set('database.connections.sqlite.database', ':memory:');
        });
        $app->make(Kernel::class)->bootstrap();

        return $app;
    }

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'sqlite') {
            $this->fail('Los tests de perfil solo pueden correr sobre SQLite en memoria.');
        }

        Schema::create('roles', function (Blueprint $table) {
            $table->id();
            $table->string('name')->nullable();
            $table->timestamps();
        });

        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password');
            $table->rememberToken();
            $table->unsignedBigInteger('role_id')->nullable();
            $table->boolean('is_active')->default(true);
            $table->boolean('requestsPassword')->default(false);
            $table->boolean('validated')->default(false);
            $table->timestamp('deactivated_at')->nullable();
            $table->unsignedBigInteger('deactivated_by')->nullable();
            $table->timestamps();
        });

        Schema::create('activity_log', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('log_name')->nullable();
            $table->text('description');
            $table->nullableMorphs('subject', 'subject');
            $table->string('event')->nullable();
            $table->nullableMorphs('causer', 'causer');
            $table->json('properties')->nullable();
            $table->uuid('batch_uuid')->nullable();
            $table->timestamps();
        });

        DB::table('roles')->insert(['id' => 3, 'name' => 'operator', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('users')->insert([
            'id' => 1,
            'name' => 'Ana Operadora',
            'email' => 'ana@example.test',
            'password' => Hash::make('ClaveActual#1'),
            'role_id' => 3,
            'is_active' => true,
            'requestsPassword' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_la_pagina_de_perfil_entrega_los_datos_del_usuario(): void
    {
        $this->withoutVite();

        $this->actingAs(User::find(1))
            ->get('/profile')
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('MyProfile')
                ->where('profile.name', 'Ana Operadora')
                ->where('profile.email', 'ana@example.test')
                ->where('profile.role', 'Operador'));
    }

    public function test_se_puede_cambiar_el_email_el_nombre_no_cambia_y_queda_auditado(): void
    {
        $this->actingAs(User::find(1))
            ->patch('/profile', ['name' => 'Intento Cambiar', 'email' => 'ana.nueva@example.test'])
            ->assertSessionHasNoErrors()
            ->assertRedirect('/profile');

        $user = DB::table('users')->where('id', 1)->first();
        $this->assertSame('Ana Operadora', $user->name);
        $this->assertSame('ana.nueva@example.test', $user->email);
        $this->assertDatabaseHas('activity_log', ['log_name' => 'users', 'event' => 'profile_updated']);
    }

    public function test_no_se_puede_usar_un_email_de_otro_usuario(): void
    {
        DB::table('users')->insert([
            'id' => 2,
            'name' => 'Otro',
            'email' => 'otro@example.test',
            'password' => Hash::make('OtraClave#2'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs(User::find(1))
            ->patch('/profile', ['email' => 'otro@example.test'])
            ->assertSessionHasErrors('email');

        $this->assertSame('ana@example.test', DB::table('users')->where('id', 1)->value('email'));
    }

    public function test_cambiar_la_contrasena_exige_la_actual(): void
    {
        $user = User::find(1);

        $this->actingAs($user)
            ->put('/password', [
                'current_password' => 'Incorrecta#0',
                'password' => 'NuevaClave#2026',
                'password_confirmation' => 'NuevaClave#2026',
            ])
            ->assertSessionHasErrors('current_password');

        $this->assertTrue(Hash::check('ClaveActual#1', DB::table('users')->where('id', 1)->value('password')));
    }

    public function test_se_puede_cambiar_la_contrasena_con_la_actual(): void
    {
        $this->actingAs(User::find(1))
            ->put('/password', [
                'current_password' => 'ClaveActual#1',
                'password' => 'NuevaClave#2026',
                'password_confirmation' => 'NuevaClave#2026',
            ])
            ->assertSessionHasNoErrors();

        $this->assertTrue(Hash::check('NuevaClave#2026', DB::table('users')->where('id', 1)->value('password')));
        $this->assertDatabaseHas('activity_log', ['log_name' => 'security', 'event' => 'password_changed']);
    }
}
