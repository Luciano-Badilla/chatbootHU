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

        $this->artisan('migrate', [
            '--path' => 'database/migrations/2026_11_08_000001_add_content_hash_to_storage_files_table.php',
        ])->assertExitCode(0);

        // Reglas automáticas: se guardan en system_settings.
        $this->artisan('migrate', [
            '--path' => 'database/migrations/2026_04_13_120000_create_system_settings_table.php',
        ])->assertExitCode(0);

        // Desvinculación de adjuntos: agrega las columnas de aviso a messages.
        $this->artisan('migrate', [
            '--path' => 'database/migrations/2026_11_09_000001_add_media_removed_to_messages_table.php',
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

    public function test_archivo_usado_en_un_chat_se_manda_a_papelera_y_el_mensaje_queda_con_aviso(): void
    {
        Storage::disk('public')->put('whatsapp/12/document_informe.pdf', 'pdf');
        $this->addMessage('/storage/whatsapp/12/document_informe.pdf');

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();
        $file = $this->fileId('whatsapp/12/document_informe.pdf');

        $listed = $this->actingAs($admin)->getJson('/api/storage/files')->assertOk()->json('items.0');
        $this->assertTrue($listed['in_use']);
        $this->assertTrue($listed['can_trash']);
        $this->assertNull($listed['blocked_reason']);

        $this->actingAs($admin)->deleteJson("/api/storage/files/{$file}")
            ->assertOk()
            ->assertJsonPath('file.trashed', true);

        $message = DB::table('messages')->where('chat_id', 12)->first();
        $this->assertNull($message->media_url);
        $this->assertSame('/storage/whatsapp/12/document_informe.pdf', $message->media_removed_url);
        $this->assertNotNull($message->media_removed_at);
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
        $this->assertTrue($listed['can_trash']);
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

    public function test_chats_agrupa_los_archivos_por_chat_con_nombre_y_ultima_actividad(): void
    {
        $this->createChatTables();
        DB::table('contacts')->insert([
            'id' => 1,
            'whatsapp_id' => '5491111',
            'name' => 'Ana Pérez',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('chats')->insert([
            ['id' => 12, 'contact_id' => 1, 'channel' => 'whatsapp', 'title' => null, 'status' => 'open', 'created_at' => now(), 'updated_at' => now()],
            ['id' => 7, 'contact_id' => null, 'channel' => 'webchat', 'title' => 'Visitante web', 'status' => 'open', 'created_at' => now(), 'updated_at' => now()],
        ]);

        Storage::disk('public')->put('whatsapp/12/a.pdf', 'aaaa');
        Storage::disk('public')->put('whatsapp/12/b.jpg', 'bb');
        Storage::disk('public')->put('webchat/7/c.png', 'cccccccc');
        Storage::disk('public')->put('bot-media/image/x.png', 'x');
        $this->addMessageForChat(12, now()->subDay());
        $this->addMessageForChat(7, now()->subYears(2));

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();

        $items = $this->actingAs($admin)->getJson('/api/storage/chats')->assertOk()->json('items');

        $this->assertCount(2, $items);
        $this->assertSame(7, $items[0]['chat_id']);
        $this->assertSame('Visitante web', $items[0]['label']);
        $this->assertSame(1, $items[0]['files']);
        $this->assertSame(8, $items[0]['bytes']);
        $this->assertSame(12, $items[1]['chat_id']);
        $this->assertSame('Ana Pérez', $items[1]['label']);
        $this->assertSame(2, $items[1]['files']);
        $this->assertSame(6, $items[1]['bytes']);
        $this->assertSame(0, $items[1]['months_inactive']);
    }

    public function test_filtro_de_inactividad_deja_solo_los_chats_sin_mensajes_recientes(): void
    {
        $this->createChatTables();
        DB::table('chats')->insert([
            ['id' => 1, 'contact_id' => null, 'channel' => 'whatsapp', 'title' => 'Viejo', 'status' => 'open', 'created_at' => now(), 'updated_at' => now()],
            ['id' => 2, 'contact_id' => null, 'channel' => 'whatsapp', 'title' => 'Reciente', 'status' => 'open', 'created_at' => now(), 'updated_at' => now()],
            ['id' => 3, 'contact_id' => null, 'channel' => 'whatsapp', 'title' => 'Sin mensajes', 'status' => 'open', 'created_at' => now(), 'updated_at' => now()],
        ]);
        Storage::disk('public')->put('whatsapp/1/a.pdf', 'a');
        Storage::disk('public')->put('whatsapp/2/b.pdf', 'b');
        Storage::disk('public')->put('whatsapp/3/c.pdf', 'c');
        $this->addMessageForChat(1, now()->subYears(2));
        $this->addMessageForChat(2, now()->subDays(3));

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();

        $all = $this->actingAs($admin)->getJson('/api/storage/chats')->assertOk()->json('items');
        $this->assertCount(3, $all);

        $inactive = $this->actingAs($admin)->getJson('/api/storage/chats?inactive_months=12')->assertOk()->json('items');
        $this->assertSame([1, 3], collect($inactive)->pluck('chat_id')->sort()->values()->all());
        $this->assertNull(collect($inactive)->firstWhere('chat_id', 3)['last_message_at']);
    }

    public function test_los_archivos_se_pueden_filtrar_por_chat(): void
    {
        Storage::disk('public')->put('whatsapp/12/a.pdf', 'a');
        Storage::disk('public')->put('whatsapp/120/b.pdf', 'b');
        Storage::disk('public')->put('webchat/12/c.png', 'c');

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();

        $response = $this->actingAs($admin)->getJson('/api/storage/files?chat_id=12')->assertOk();

        $response->assertJsonPath('meta.total', 2);
        $this->assertSame(
            ['webchat/12/c.png', 'whatsapp/12/a.pdf'],
            collect($response->json('items'))->pluck('path')->sort()->values()->all(),
        );
    }

    public function test_lote_envia_a_papelera_solo_los_archivos_que_se_pueden(): void
    {
        Storage::disk('public')->put('whatsapp/12/a.pdf', 'a');
        Storage::disk('public')->put('whatsapp/12/b.pdf', 'b');
        Storage::disk('public')->put('images/x.ico', 'x');
        $this->addMessage('/storage/whatsapp/12/b.pdf');

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();
        $a = $this->fileId('whatsapp/12/a.pdf');
        $b = $this->fileId('whatsapp/12/b.pdf');
        $x = $this->fileId('images/x.ico');

        $this->actingAs($admin)->postJson('/api/storage/files/trash', ['ids' => [$a, $b, $x]])
            ->assertOk()
            ->assertJsonPath('trashed', 2)
            ->assertJsonCount(1, 'skipped');

        // El archivo usado en un chat también va a papelera; su mensaje queda con aviso.
        $this->assertNotNull(StorageFile::withTrashed()->find($a)->deleted_at);
        $this->assertNotNull(StorageFile::withTrashed()->find($b)->deleted_at);
        $this->assertNull(StorageFile::find($x)->deleted_at);
        $this->assertNotNull(DB::table('messages')->where('chat_id', 12)->value('media_removed_at'));
        $this->assertDatabaseHas('activity_log', ['log_name' => 'storage', 'event' => 'trashed']);
    }

    public function test_ids_para_seleccionar_incluyen_los_archivos_de_chats_y_se_omiten_los_de_nodos(): void
    {
        Storage::disk('public')->put('whatsapp/12/a.pdf', 'aa');
        Storage::disk('public')->put('whatsapp/12/b.pdf', 'bbb');
        $this->addMessage('/storage/whatsapp/12/b.pdf');

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();
        $a = $this->fileId('whatsapp/12/a.pdf');
        $b = $this->fileId('whatsapp/12/b.pdf');

        $response = $this->actingAs($admin)->getJson('/api/storage/files/trashable-ids')->assertOk();

        $response->assertJsonPath('total', 2)->assertJsonPath('bytes', 5)->assertJsonPath('truncated', false);
        $this->assertEqualsCanonicalizing([$a, $b], $response->json('ids'));
    }

    public function test_filtro_por_fecha_de_modificacion(): void
    {
        Storage::disk('public')->put('bot-media/image/viejo.png', 'v');
        Storage::disk('public')->put('bot-media/image/nuevo.png', 'n');
        touch(Storage::disk('public')->path('bot-media/image/viejo.png'), now()->subYears(2)->timestamp);

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();

        $old = $this->actingAs($admin)
            ->getJson('/api/storage/files?modified_to='.now()->subYear()->toDateString())
            ->assertOk()
            ->json('items');
        $this->assertSame(['bot-media/image/viejo.png'], collect($old)->pluck('path')->all());

        $recent = $this->actingAs($admin)
            ->getJson('/api/storage/files?modified_from='.now()->subDay()->toDateString())
            ->assertOk()
            ->json('items');
        $this->assertSame(['bot-media/image/nuevo.png'], collect($recent)->pluck('path')->all());
    }

    public function test_duplicados_agrupan_por_contenido_y_conservan_la_copia_en_uso(): void
    {
        Storage::disk('public')->put('bot-media/image/p1.png', 'same');
        Storage::disk('public')->put('bot-media/image/p2.png', 'same');
        Storage::disk('public')->put('whatsapp/12/c.png', 'same');
        Storage::disk('public')->put('bot-media/image/otro.png', 'diff');
        $this->addMessage('/storage/whatsapp/12/c.png');

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();

        $response = $this->actingAs($admin)->getJson('/api/storage/duplicates')->assertOk();
        $response->assertJsonPath('total_groups', 1);

        $group = $response->json('groups.0');
        $this->assertSame(3, $group['copies']);
        $this->assertSame(8, $group['wasted_bytes']);

        $byPath = collect($group['files'])->keyBy('path');
        $this->assertTrue($byPath['whatsapp/12/c.png']['keep']);
        $this->assertTrue($byPath['whatsapp/12/c.png']['can_trash']);
        $this->assertFalse($byPath['bot-media/image/p1.png']['keep']);
        $this->assertTrue($byPath['bot-media/image/p1.png']['can_trash']);

        // Mandar a papelera las copias sobrantes no toca la que está en uso.
        $this->actingAs($admin)->postJson('/api/storage/files/trash', [
            'ids' => [$byPath['bot-media/image/p1.png']['id'], $byPath['bot-media/image/p2.png']['id']],
        ])->assertOk()->assertJsonPath('trashed', 2);

        $this->assertNull(StorageFile::find($byPath['whatsapp/12/c.png']['id'])->deleted_at);
    }

    public function test_regla_automatica_manda_a_papelera_medios_del_bot_viejos_sin_uso(): void
    {
        Storage::disk('public')->put('bot-media/image/viejo.png', 'v');
        Storage::disk('public')->put('bot-media/image/viejo-en-uso.png', 'u');
        Storage::disk('public')->put('bot-media/image/nuevo.png', 'n');
        $old = now()->subDays(60)->timestamp;
        touch(Storage::disk('public')->path('bot-media/image/viejo.png'), $old);
        touch(Storage::disk('public')->path('bot-media/image/viejo-en-uso.png'), $old);
        $this->addBotNode(['source_kind' => 'url', 'source' => '/storage/bot-media/image/viejo-en-uso.png']);

        $admin = $this->user(1);
        $this->actingAs($admin)->putJson('/api/storage/retention', [
            'bot_media_unused_days' => 30,
            'trash_purge_days' => null,
        ])->assertOk()->assertJsonPath('settings.bot_media_unused_days', 30);

        $this->artisan('storage:apply-retention')
            ->expectsOutputToContain('Enviados a papelera por regla: 1')
            ->assertExitCode(0);

        $this->assertNotNull(StorageFile::withTrashed()->where('path', 'bot-media/image/viejo.png')->first()->deleted_at);
        $this->assertNull(StorageFile::where('path', 'bot-media/image/viejo-en-uso.png')->first()->deleted_at);
        $this->assertNull(StorageFile::where('path', 'bot-media/image/nuevo.png')->first()->deleted_at);
        $this->assertDatabaseHas('activity_log', ['log_name' => 'storage', 'event' => 'auto_trashed']);
    }

    public function test_regla_de_papelera_borra_definitivamente_lo_viejo_sin_uso(): void
    {
        Storage::disk('public')->put('bot-media/document/vieja.pdf', 'pdf');
        Storage::disk('public')->put('bot-media/document/reciente.pdf', 'pdf2');

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();
        $vieja = $this->fileId('bot-media/document/vieja.pdf');
        $reciente = $this->fileId('bot-media/document/reciente.pdf');

        $this->actingAs($admin)->deleteJson("/api/storage/files/{$vieja}")->assertOk();
        $this->actingAs($admin)->deleteJson("/api/storage/files/{$reciente}")->assertOk();
        StorageFile::withTrashed()->where('id', $vieja)->update(['deleted_at' => now()->subDays(40)]);

        $this->actingAs($admin)->putJson('/api/storage/retention', ['trash_purge_days' => 30])->assertOk();

        $this->artisan('storage:apply-retention')
            ->expectsOutputToContain('Borrados definitivamente por regla: 1')
            ->assertExitCode(0);

        Storage::disk('public')->assertMissing('bot-media/document/vieja.pdf');
        Storage::disk('public')->assertExists('bot-media/document/reciente.pdf');
        $this->assertNull(StorageFile::withTrashed()->find($vieja));
        $this->assertNotNull(StorageFile::withTrashed()->find($reciente));
        $this->assertDatabaseHas('activity_log', ['log_name' => 'storage', 'event' => 'auto_purged']);
    }

    public function test_reglas_y_lote_solo_para_administradores_y_valida_los_dias(): void
    {
        Storage::disk('public')->put('whatsapp/12/a.pdf', 'a');
        $operator = $this->user(3);
        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();
        $file = $this->fileId('whatsapp/12/a.pdf');

        $this->actingAs($operator)->getJson('/api/storage/retention')->assertForbidden();
        $this->actingAs($operator)->postJson('/api/storage/files/trash', ['ids' => [$file]])->assertForbidden();

        $this->actingAs($admin)->putJson('/api/storage/retention', ['bot_media_unused_days' => 0])
            ->assertStatus(422);
    }

    public function test_el_buscador_de_chats_filtra_por_nombre_telefono_y_id(): void
    {
        $this->createChatTables();
        DB::table('contacts')->insert([
            'id' => 1,
            'whatsapp_id' => '5491111',
            'name' => 'Ana Pérez',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('chats')->insert([
            ['id' => 12, 'contact_id' => 1, 'channel' => 'whatsapp', 'title' => null, 'status' => 'open', 'created_at' => now(), 'updated_at' => now()],
            ['id' => 7, 'contact_id' => null, 'channel' => 'webchat', 'title' => 'Visitante web', 'status' => 'open', 'created_at' => now(), 'updated_at' => now()],
        ]);
        Storage::disk('public')->put('whatsapp/12/a.pdf', 'a');
        Storage::disk('public')->put('webchat/7/b.png', 'b');

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();

        $ids = fn (string $q) => collect($this->actingAs($admin)->getJson('/api/storage/chats?q='.urlencode($q))->assertOk()->json('items'))
            ->pluck('chat_id')
            ->sort()
            ->values()
            ->all();

        $this->assertSame([12], $ids('ana'));
        $this->assertSame([12], $ids('5491'));
        $this->assertSame([7], $ids('visitante'));
        $this->assertSame([7], $ids('7'));
        $this->assertSame([], $ids('zzz'));
    }

    public function test_la_miniatura_de_una_imagen_se_genera_una_sola_vez_y_solo_para_imagenes(): void
    {
        Storage::fake('local');
        $source = imagecreatetruecolor(800, 600);
        ob_start();
        imagepng($source);
        $png = ob_get_clean();
        imagedestroy($source);

        Storage::disk('public')->put('bot-media/image/foto.png', $png);
        Storage::disk('public')->put('bot-media/document/manual.pdf', 'pdf');

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();
        $foto = $this->fileId('bot-media/image/foto.png');
        $pdf = $this->fileId('bot-media/document/manual.pdf');

        $response = $this->actingAs($admin)->get("/api/storage/files/{$foto}/thumbnail")->assertOk();
        $this->assertStringContainsString('image/jpeg', (string) $response->headers->get('Content-Type'));

        // Segunda pedida: sale de la caché, no genera otra miniatura.
        $this->actingAs($admin)->get("/api/storage/files/{$foto}/thumbnail")->assertOk();
        $this->assertCount(1, Storage::disk('local')->files('storage-thumbs'));

        $this->actingAs($admin)->get("/api/storage/files/{$pdf}/thumbnail")->assertNotFound();
        $this->actingAs($this->user(3))->get("/api/storage/files/{$foto}/thumbnail")->assertForbidden();
    }

    public function test_mandar_a_papelera_un_archivo_de_chat_deja_el_mensaje_con_aviso(): void
    {
        Storage::disk('public')->put('whatsapp/12/viejo.pdf', 'pdf');
        Storage::disk('public')->put('bot-media/image/menu.png', 'png');
        $old = now()->subYears(2);
        DB::table('messages')->insert([
            ['chat_id' => 12, 'sender' => 'user', 'message_type' => 'document', 'body' => 'Te envío el estudio', 'media_url' => '/storage/whatsapp/12/viejo.pdf', 'media_name' => 'viejo.pdf', 'created_at' => $old, 'updated_at' => $old],
            ['chat_id' => 12, 'sender' => 'user', 'message_type' => 'image', 'body' => '', 'media_url' => '/storage/bot-media/image/menu.png', 'media_name' => 'menu.png', 'created_at' => $old, 'updated_at' => $old],
        ]);

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();
        $viejo = $this->fileId('whatsapp/12/viejo.pdf');

        $this->actingAs($admin)->deleteJson("/api/storage/files/{$viejo}")->assertOk();

        $messages = DB::table('messages')->where('chat_id', 12)->orderBy('id')->get();
        $this->assertNull($messages[0]->media_url);
        $this->assertSame('/storage/whatsapp/12/viejo.pdf', $messages[0]->media_removed_url);
        $this->assertNotNull($messages[0]->media_removed_at);
        $this->assertSame('Te envío el estudio', $messages[0]->body);

        // Un medio del bot que el chat usa no cambia el archivo: solo se toca lo que se manda a papelera.
        $this->assertSame('/storage/bot-media/image/menu.png', $messages[1]->media_url);
        $this->assertNull(StorageFile::where('path', 'bot-media/image/menu.png')->first()->deleted_at);
        $this->assertDatabaseHas('activity_log', ['log_name' => 'storage', 'event' => 'trashed']);
    }

    public function test_restaurar_el_archivo_vuelve_a_enlazar_el_mensaje(): void
    {
        Storage::disk('public')->put('whatsapp/12/viejo.pdf', 'pdf');
        $old = now()->subYears(2);
        DB::table('messages')->insert([
            'chat_id' => 12, 'sender' => 'user', 'message_type' => 'document', 'body' => '', 'media_url' => '/storage/whatsapp/12/viejo.pdf', 'media_name' => 'viejo.pdf', 'created_at' => $old, 'updated_at' => $old,
        ]);

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();
        $file = $this->fileId('whatsapp/12/viejo.pdf');
        $this->actingAs($admin)->deleteJson("/api/storage/files/{$file}")->assertOk();

        $this->actingAs($admin)->postJson("/api/storage/files/{$file}/restore")
            ->assertOk()
            ->assertJsonPath('relinked', 1);

        $message = DB::table('messages')->where('chat_id', 12)->first();
        $this->assertSame('/storage/whatsapp/12/viejo.pdf', $message->media_url);
        $this->assertNull($message->media_removed_url);
        $this->assertNull($message->media_removed_at);
    }

    public function test_vaciar_la_papelera_borra_lo_que_no_esta_en_uso_y_pide_confirmacion(): void
    {
        Storage::disk('public')->put('bot-media/document/uno.pdf', 'uno');
        Storage::disk('public')->put('bot-media/document/dos.pdf', 'dos');
        Storage::disk('public')->put('bot-media/document/tres.pdf', 'tres');

        $admin = $this->user(1);
        $this->actingAs($admin)->getJson('/api/storage/summary')->assertOk();
        $uno = $this->fileId('bot-media/document/uno.pdf');
        $dos = $this->fileId('bot-media/document/dos.pdf');
        $tres = $this->fileId('bot-media/document/tres.pdf');

        $this->actingAs($admin)->deleteJson("/api/storage/files/{$uno}")->assertOk();
        $this->actingAs($admin)->deleteJson("/api/storage/files/{$dos}")->assertOk();
        $this->actingAs($admin)->deleteJson("/api/storage/files/{$tres}")->assertOk();

        // Un nodo del bot vuelve a usar uno de los archivos en papelera: ese no se borra.
        $this->addBotNode(['source_kind' => 'url', 'source' => '/storage/bot-media/document/dos.pdf']);

        $this->actingAs($admin)->postJson('/api/storage/trash/empty', [])->assertStatus(422);
        Storage::disk('public')->assertExists('bot-media/document/uno.pdf');

        $this->actingAs($admin)->postJson('/api/storage/trash/empty', ['confirmed' => true])
            ->assertOk()
            ->assertJsonPath('deleted', 2)
            ->assertJsonPath('skipped', 1);

        Storage::disk('public')->assertMissing('bot-media/document/uno.pdf');
        Storage::disk('public')->assertExists('bot-media/document/dos.pdf');
        $this->assertNull(StorageFile::withTrashed()->find($uno));
        $this->assertNotNull(StorageFile::withTrashed()->find($dos));
        $this->assertDatabaseHas('activity_log', ['log_name' => 'storage', 'event' => 'force_deleted']);
    }

    private function createChatTables(): void
    {
        Schema::create('contacts', function (Blueprint $table) {
            $table->id();
            $table->string('whatsapp_id')->nullable();
            $table->string('name')->nullable();
            $table->timestamps();
        });

        Schema::create('chats', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('contact_id')->nullable();
            $table->string('channel')->nullable();
            $table->string('title')->nullable();
            $table->string('status')->nullable();
            $table->timestamps();
        });
    }

    private function addMessageForChat(int $chatId, $at): void
    {
        DB::table('messages')->insert([
            'chat_id' => $chatId,
            'sender' => 'user',
            'message_type' => 'text',
            'body' => 'hola',
            'media_url' => null,
            'media_name' => null,
            'created_at' => $at,
            'updated_at' => $at,
        ]);
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
