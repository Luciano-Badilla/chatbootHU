<?php

namespace Tests\Feature;

use App\Models\StorageFile;
use App\Models\User;
use App\Services\StorageUsageService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Corre siempre sobre SQLite en memoria: nunca toca la base MySQL de desarrollo.
 */
class StorageFilesTest extends TestCase
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
            $this->fail('Los tests de almacenamiento solo pueden correr sobre SQLite en memoria.');
        }

        Storage::fake(StorageUsageService::DISK);

        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('chat_id')->nullable();
            $table->string('sender')->nullable();
            $table->string('message_type')->nullable();
            $table->text('body')->nullable();
            $table->text('media_url')->nullable();
            $table->string('media_name')->nullable();
            $table->timestamps();
        });

        Schema::create('bot_nodes', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('flow_id')->nullable();
            $table->string('key')->nullable();
            $table->string('type')->nullable();
            $table->text('body')->nullable();
            $table->text('settings')->nullable();
            $table->unsignedBigInteger('next_node_id')->nullable();
            $table->timestamps();
            $table->softDeletes();
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

        $this->artisan('migrate', [
            '--path' => 'database/migrations/2026_11_07_000001_create_storage_files_table.php',
        ])->assertExitCode(0);
    }

    public function test_el_resumen_agrupa_archivos_por_categoria_y_omite_dotfiles(): void
    {
        Storage::disk('public')->put('bot-media/image/logo.png', '12345');
        Storage::disk('public')->put('whatsapp/12/document_x.pdf', '0123456789');
        Storage::disk('public')->put('webchat/7/image_y.jpg', '666');
        Storage::disk('public')->put('webchat/logos/logo.png', 'abcd');
        Storage::disk('public')->put('images/favicon.ico', 'ab');
        Storage::disk('public')->put('otros/nota.txt', '123456');
        Storage::disk('public')->put('whatsapp/12/.gitignore', '*');

        $response = $this->actingAs($this->user(1))->getJson('/api/storage/summary');

        $response->assertOk();
        $response->assertJsonPath('scan.files', 6);
        $response->assertJsonPath('summary.totals.files', 6);
        $response->assertJsonPath('summary.totals.bytes', 30);

        $categories = collect($response->json('summary.categories'))->keyBy('key');
        $this->assertSame(['files' => 2, 'bytes' => 13], $categories['chat_attachments']['active']);
        $this->assertSame(['files' => 1, 'bytes' => 5], $categories['bot_media']['active']);
        $this->assertSame(['files' => 2, 'bytes' => 6], $categories['branding']['active']);
        $this->assertSame(['files' => 1, 'bytes' => 6], $categories['other']['active']);
        $this->assertTrue($categories['chat_attachments']['actionable']);
        $this->assertFalse($categories['branding']['actionable']);
    }

    public function test_archivo_referenciado_por_un_mensaje_no_se_puede_mandar_a_papelera(): void
    {
        Storage::disk('public')->put('whatsapp/12/document_informe.pdf', 'pdf');
        $this->addMessage('/storage/whatsapp/12/document_informe.pdf');

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();

        $file = $this->fileId('whatsapp/12/document_informe.pdf');

        $listed = $this->actingAs($admin)->getJson('/api/storage/files')->assertOk()->json('items.0');
        $this->assertTrue($listed['in_use']);
        $this->assertFalse($listed['can_trash']);
        $this->assertSame(1, $listed['references']['messages']);
        $this->assertNotNull($listed['blocked_reason']);

        $this->actingAs($admin)->deleteJson("/api/storage/files/{$file}")
            ->assertStatus(409)
            ->assertJsonPath('references.messages', 1);

        $this->assertNull(StorageFile::find($file)->deleted_at);
        Storage::disk('public')->assertExists('whatsapp/12/document_informe.pdf');
    }

    public function test_referencias_de_nodos_del_bot_incluyen_nodos_en_papelera_y_urls_absolutas(): void
    {
        Storage::disk('public')->put('bot-media/image/a.png', 'png');
        Storage::disk('public')->put('bot-media/image/b.png', 'png');

        $this->addBotNode(['source_kind' => 'url', 'source' => '/storage/bot-media/image/a.png'], trashed: true);
        $this->addBotNode(['source_kind' => 'url', 'source' => 'https://chat.test/storage/bot-media/image/a.png'], trashed: false);

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();

        $items = collect($this->actingAs($admin)->getJson('/api/storage/files')->assertOk()->json('items'))->keyBy('path');

        $this->assertTrue($items['bot-media/image/a.png']['in_use']);
        $this->assertSame(2, $items['bot-media/image/a.png']['references']['bot_nodes']);
        $this->assertFalse($items['bot-media/image/b.png']['in_use']);
        $this->assertTrue($items['bot-media/image/b.png']['can_trash']);
    }

    public function test_papelera_conserva_el_archivo_en_disco_y_restaurar_lo_devuelve(): void
    {
        Storage::disk('public')->put('whatsapp/12/image_foto.jpg', 'jpg');
        $file = $this->fileId('whatsapp/12/image_foto.jpg');
        $admin = $this->user(1);

        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();

        $this->actingAs($admin)->deleteJson("/api/storage/files/{$file}")
            ->assertOk()
            ->assertJsonPath('file.trashed', true)
            ->assertJsonPath('file.can_restore', true);

        $this->assertNotNull(StorageFile::withTrashed()->find($file)->deleted_at);
        Storage::disk('public')->assertExists('whatsapp/12/image_foto.jpg');

        $this->actingAs($admin)->getJson('/api/storage/files?status=trashed')
            ->assertOk()
            ->assertJsonPath('items.0.path', 'whatsapp/12/image_foto.jpg');

        $this->actingAs($admin)->postJson("/api/storage/files/{$file}/restore")
            ->assertOk()
            ->assertJsonPath('file.trashed', false);

        $this->assertNull(StorageFile::find($file)->deleted_at);
        $this->assertSame(2, DB::table('activity_log')->where('log_name', 'storage')->count());
        $this->assertDatabaseHas('activity_log', ['log_name' => 'storage', 'event' => 'trashed']);
        $this->assertDatabaseHas('activity_log', ['log_name' => 'storage', 'event' => 'restored']);
    }

    public function test_borrado_permanente_exige_estar_en_papelera_y_confirmacion(): void
    {
        Storage::disk('public')->put('whatsapp/12/image_foto.jpg', 'jpg');
        $file = $this->fileId('whatsapp/12/image_foto.jpg');
        $admin = $this->user(1);

        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();

        // Sin pasar por papelera no se puede borrar definitivamente.
        $this->actingAs($admin)->deleteJson("/api/storage/files/{$file}/force", ['confirmed' => true])
            ->assertNotFound();

        $this->actingAs($admin)->deleteJson("/api/storage/files/{$file}")->assertOk();

        $this->actingAs($admin)->deleteJson("/api/storage/files/{$file}/force")
            ->assertStatus(422);

        Storage::disk('public')->assertExists('whatsapp/12/image_foto.jpg');

        $this->actingAs($admin)->deleteJson("/api/storage/files/{$file}/force", ['confirmed' => true])
            ->assertOk()
            ->assertJsonPath('deleted_id', $file);

        Storage::disk('public')->assertMissing('whatsapp/12/image_foto.jpg');
        $this->assertNull(StorageFile::withTrashed()->find($file));
        $this->assertDatabaseHas('activity_log', ['log_name' => 'storage', 'event' => 'force_deleted']);
    }

    public function test_archivo_de_flujo_en_uso_no_se_borra_aunque_este_en_papelera(): void
    {
        Storage::disk('public')->put('bot-media/document/manual.pdf', 'pdf');
        $file = $this->fileId('bot-media/document/manual.pdf');
        $admin = $this->user(1);

        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();
        $this->actingAs($admin)->deleteJson("/api/storage/files/{$file}")->assertOk();

        // Se vuelve a usar en un nodo mientras está en papelera.
        $this->addBotNode(['source_kind' => 'url', 'source' => '/storage/bot-media/document/manual.pdf']);

        $this->actingAs($admin)->deleteJson("/api/storage/files/{$file}/force", ['confirmed' => true])
            ->assertStatus(409);

        Storage::disk('public')->assertExists('bot-media/document/manual.pdf');
        $this->assertNotNull(StorageFile::withTrashed()->find($file));
    }

    public function test_branding_y_otros_archivos_son_solo_lectura(): void
    {
        Storage::disk('public')->put('images/favicon.ico', 'ico');
        $file = $this->fileId('images/favicon.ico');
        $admin = $this->user(1);

        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();

        $this->actingAs($admin)->deleteJson("/api/storage/files/{$file}")->assertStatus(422);
        $this->assertNull(StorageFile::find($file)->deleted_at);
        Storage::disk('public')->assertExists('images/favicon.ico');
    }

    public function test_el_rescaneo_quita_registros_de_archivos_que_ya_no_existen(): void
    {
        Storage::disk('public')->put('whatsapp/12/a.jpg', 'a');
        Storage::disk('public')->put('whatsapp/12/b.jpg', 'b');
        $a = $this->fileId('whatsapp/12/a.jpg');
        $admin = $this->user(1);

        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();
        $this->actingAs($admin)->deleteJson("/api/storage/files/{$a}")->assertOk();

        Storage::disk('public')->delete('whatsapp/12/b.jpg');

        $this->actingAs($admin)->getJson('/api/storage/summary')
            ->assertOk()
            ->assertJsonPath('scan.removed', 1);

        $this->assertSame(1, StorageFile::withTrashed()->count());
        $this->assertNotNull(StorageFile::onlyTrashed()->find($a));
    }

    public function test_solo_administradores_pueden_gestionar_el_almacenamiento(): void
    {
        Storage::disk('public')->put('whatsapp/12/a.jpg', 'a');
        $file = $this->fileId('whatsapp/12/a.jpg');

        $this->actingAs($this->user(3))->getJson('/api/storage/summary')->assertForbidden();
        $this->actingAs($this->user(2))->getJson('/api/storage/summary')->assertForbidden();
        $this->actingAs($this->user(3))->deleteJson("/api/storage/files/{$file}")->assertForbidden();

        $this->assertNull(StorageFile::find($file)->deleted_at);
    }

    public function test_extrae_las_rutas_posibles_desde_urls_y_valores_de_nodos(): void
    {
        $service = app(StorageUsageService::class);

        $this->assertContains('whatsapp/12/a b.pdf', $service->pathsFromMediaUrl('https://chat.test/storage/whatsapp/12/a%20b.pdf?x=1'));
        $this->assertContains('bot-media/image/x.png', $service->pathsFromMediaUrl('/storage/bot-media/image/x.png'));
        $this->assertSame([], $service->pathsFromMediaUrl('https://cdn.example.com/archivo.pdf'));

        $this->assertSame(
            ['bot-media/image/x.png', 'bot-media/image/y.png'],
            $service->pathsFromValue([
                'source' => '/storage/bot-media/image/x.png',
                'nested' => ['text' => 'mirá https://h.test/storage/bot-media/image/y.png gracias'],
                'number' => 3,
            ]),
        );
    }

    public function test_archivo_con_espacios_y_numeral_en_el_nombre_sigue_protegido_si_un_mensaje_lo_usa(): void
    {
        // Nombres inbound de WhatsApp: no se sanitizan y pueden traer '#' y espacios.
        $name = 'whatsapp/27/document_feliz año nuevo #recuerdos #2025.mp4';
        Storage::disk('public')->put($name, 'mp4');
        $this->addMessage('/storage/'.$name);

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();

        $listed = collect($this->actingAs($admin)->getJson('/api/storage/files')->assertOk()->json('items'))
            ->firstWhere('path', $name);

        $this->assertNotNull($listed);
        $this->assertTrue($listed['in_use']);
        $this->assertFalse($listed['can_trash']);
        $this->assertSame(1, $listed['references']['messages']);
    }

    public function test_el_registro_arranca_vacio_y_el_comando_carga_los_archivos_existentes(): void
    {
        Storage::disk('public')->put('whatsapp/12/a.jpg', 'a');
        Storage::disk('public')->put('bot-media/image/b.png', 'b');

        // La migración no importa archivos: el registro arranca vacío.
        $this->assertSame(0, StorageFile::withTrashed()->count());

        // La lista no escanea: sin sincronizar, no ve los archivos existentes.
        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/files')
            ->assertOk()
            ->assertJsonPath('meta.total', 0);

        $this->artisan('storage:scan')
            ->expectsOutputToContain('Archivos registrados: 2')
            ->assertExitCode(0);

        $this->assertSame(2, StorageFile::withTrashed()->count());
        $this->actingAs($admin)->getJson('/api/storage/files')
            ->assertOk()
            ->assertJsonPath('meta.total', 2);
    }

    private function user(int $roleId): User
    {
        $user = new User([
            'name' => 'Usuario de prueba',
            'email' => 'prueba'.$roleId.'@example.test',
            'role_id' => $roleId,
            'is_active' => true,
        ]);
        // Evita consultar la tabla roles, que no existe en SQLite de prueba.
        $user->setRelation('role', null);

        return $user;
    }

    private function fileId(string $path): int
    {
        // Sincroniza el registro con el disco antes de buscar el id.
        app(StorageUsageService::class)->scan();

        return (int) StorageFile::query()->where('path', $path)->value('id');
    }

    private function addMessage(string $mediaUrl): void
    {
        DB::table('messages')->insert([
            'chat_id' => 12,
            'sender' => 'user',
            'message_type' => 'document',
            'body' => '',
            'media_url' => $mediaUrl,
            'media_name' => basename($mediaUrl),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function addBotNode(array $settings, bool $trashed = false): void
    {
        DB::table('bot_nodes')->insert([
            'flow_id' => 1,
            'key' => 'media_'.uniqid(),
            'type' => 'media',
            'body' => null,
            'settings' => json_encode($settings),
            'created_at' => now(),
            'updated_at' => now(),
            'deleted_at' => $trashed ? now() : null,
        ]);
    }
}
