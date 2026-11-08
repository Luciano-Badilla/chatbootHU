<?php

namespace Tests\Feature;

use App\Models\BotFlow;
use App\Models\Holiday;
use App\Models\SystemSetting;
use App\Models\User;
use App\Services\HolidayService;
use App\Services\WebchatFlowResolver;
use Carbon\Carbon;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Feriados en la selección de flujos de Webchat y calendario administrable.
 * Corre siempre sobre SQLite en memoria: nunca toca la base MySQL de desarrollo.
 */
class HolidayFlowTest extends TestCase
{
    private const BA = 'America/Argentina/Buenos_Aires';
    private const API_2026 = 'https://date.nager.at/api/v3/PublicHolidays/2026/AR';

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
            $this->fail('Los tests de feriados solo pueden correr sobre SQLite en memoria.');
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
            $table->boolean('validated')->default(true);
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

        Schema::create('system_settings', function (Blueprint $table) {
            $table->id();
            $table->string('key')->unique();
            $table->text('value')->nullable();
            $table->timestamps();
        });

        Schema::create('bot_flows', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->text('description')->nullable();
            $table->unsignedBigInteger('start_node_id')->nullable();
            $table->boolean('is_active')->default(true);
            $table->boolean('is_default')->default(false);
            $table->json('channels')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('holidays', function (Blueprint $table) {
            $table->id();
            $table->date('date')->unique();
            $table->string('name', 150);
            $table->string('source', 20)->default('manual');
            $table->timestamps();
            $table->softDeletes();
        });

        DB::table('roles')->insert([
            ['id' => 1, 'name' => 'admin', 'created_at' => now(), 'updated_at' => now()],
            ['id' => 3, 'name' => 'operator', 'created_at' => now(), 'updated_at' => now()],
        ]);
        DB::table('users')->insert([
            ['id' => 1, 'name' => 'Admin', 'email' => 'admin@example.test', 'password' => 'x', 'role_id' => 1, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()],
            ['id' => 2, 'name' => 'Operador', 'email' => 'op@example.test', 'password' => 'x', 'role_id' => 3, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()],
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    // ── Calendario: carga desde la API ───────────────────────────────────────

    public function test_importa_solo_los_feriados_nacionales_desde_la_api(): void
    {
        Http::fake([self::API_2026 => Http::response([
            ['date' => '2026-06-15', 'localName' => 'Paso a la Inmortalidad del General Martín Miguel de Güemes', 'global' => true, 'counties' => null],
            ['date' => '2026-12-25', 'localName' => 'Navidad', 'global' => true, 'counties' => null],
            ['date' => '2026-03-01', 'localName' => 'Solo en una provincia', 'global' => false, 'counties' => ['AR-M']],
        ])]);

        $result = app(HolidayService::class)->importYear(2026);

        $this->assertSame(['created' => 2, 'updated' => 0, 'removed' => 0, 'total' => 2], $result);
        $this->assertSame('api', $this->activeHoliday('2026-06-15')?->source);
        $this->assertSame('Navidad', $this->activeHoliday('2026-12-25')?->name);
        $this->assertNull($this->activeHoliday('2026-03-01'));
    }

    public function test_reimportar_no_duplica_y_respeta_un_feriado_quitado_a_mano(): void
    {
        Http::fake([self::API_2026 => Http::response([
            ['date' => '2026-06-15', 'localName' => 'Güemes', 'global' => true],
            ['date' => '2026-12-25', 'localName' => 'Navidad', 'global' => true],
        ])]);
        $service = app(HolidayService::class);
        $service->importYear(2026);

        // El hospital trabaja el 15 de junio: lo quitamos a mano.
        $this->activeHoliday('2026-06-15')->delete();

        $result = $service->importYear(2026);

        $this->assertSame(0, $result['created']);
        $this->assertSame(1, Holiday::query()->count(), 'Solo debe quedar Navidad activa.');
        $this->assertTrue($this->trashedHoliday('2026-06-15')); // sigue en la papelera
        $this->assertNull($this->activeHoliday('2026-06-15'));
    }

    public function test_si_la_api_deja_de_traer_un_feriado_de_calendario_se_quita_pero_no_uno_manual(): void
    {
        Http::fake([self::API_2026 => Http::sequence()
            ->push([
                ['date' => '2026-06-15', 'localName' => 'Güemes', 'global' => true],
                ['date' => '2026-12-25', 'localName' => 'Navidad', 'global' => true],
            ])
            ->push([
                ['date' => '2026-12-25', 'localName' => 'Navidad', 'global' => true],
            ]),
        ]);
        $service = app(HolidayService::class);
        $service->importYear(2026);
        $service->addManual('2026-09-18', 'Día del hospital');

        $result = $service->importYear(2026);

        $this->assertSame(1, $result['removed']);
        $this->assertNull($this->activeHoliday('2026-06-15'));
        $this->assertSame('manual', $this->activeHoliday('2026-09-18')?->source);
    }

    public function test_si_la_api_falla_no_se_toca_nada(): void
    {
        Http::fake([self::API_2026 => Http::response('error', 500)]);
        $service = app(HolidayService::class);
        Holiday::query()->create(['date' => '2026-12-25', 'name' => 'Navidad', 'source' => 'api']);

        try {
            $service->importYear(2026);
            $this->fail('Debía lanzar HolidayCalendarException.');
        } catch (\App\Exceptions\HolidayCalendarException) {
            $this->assertSame(1, Holiday::query()->count());
        }
    }

    public function test_el_comando_sincroniza_el_año_indicado(): void
    {
        Http::fake([self::API_2026 => Http::response([
            ['date' => '2026-12-25', 'localName' => 'Navidad', 'global' => true],
        ])]);

        $this->artisan('holidays:sync', ['year' => 2026])->assertExitCode(0);

        $this->assertSame('api', $this->activeHoliday('2026-12-25')?->source);
    }

    // ── Calendario: altas y bajas manuales ───────────────────────────────────

    public function test_el_alta_manual_de_un_dia_quitado_lo_restaura(): void
    {
        $service = app(HolidayService::class);
        $service->addManual('2026-06-15', 'Güemes');
        $this->activeHoliday('2026-06-15')->delete();

        $holiday = $service->addManual('2026-06-15', 'Paso a la Inmortalidad de Güemes');

        $this->assertSame('manual', $holiday->source);
        $this->assertSame('Paso a la Inmortalidad de Güemes', $holiday->name);
        $this->assertSame(1, Holiday::query()->whereDate('date', '2026-06-15')->count());
    }

    public function test_no_se_puede_agregar_dos_veces_el_mismo_dia(): void
    {
        $service = app(HolidayService::class);
        $service->addManual('2026-06-15', 'Güemes');

        $this->expectException(\Illuminate\Validation\ValidationException::class);
        $service->addManual('2026-06-15', 'Otro nombre');
    }

    // ── Detección de feriado con la zona horaria del sistema ─────────────────

    public function test_detecta_el_feriado_segun_la_fecha_local_del_sistema(): void
    {
        Holiday::query()->create(['date' => '2026-06-15', 'name' => 'Güemes', 'source' => 'manual']);
        $service = app(HolidayService::class);

        // 01:00 del 15 en Buenos Aires (UTC-3) equivale a 04:00 UTC: sigue siendo feriado.
        $this->assertTrue($service->isHoliday(Carbon::parse('2026-06-15 01:00:00', self::BA)));
        // 23:30 del 14 en Buenos Aires: todavía no es feriado aunque en UTC ya sea el 15.
        $this->assertFalse($service->isHoliday(Carbon::parse('2026-06-14 23:30:00', self::BA)));
    }

    // ── Selección de flujo de Webchat ────────────────────────────────────────

    public function test_en_un_feriado_se_usa_el_flujo_de_feriados(): void
    {
        $this->seedFlows();
        Carbon::setTestNow(Carbon::parse('2026-06-15 10:00:00', self::BA));
        Holiday::query()->create(['date' => '2026-06-15', 'name' => 'Güemes', 'source' => 'api']);

        $this->assertSame(2, $this->resolveFlowId());
    }

    public function test_un_dia_comun_usa_el_flujo_del_dia(): void
    {
        $this->seedFlows();
        Carbon::setTestNow(Carbon::parse('2026-06-16 10:00:00', self::BA));
        Holiday::query()->create(['date' => '2026-06-15', 'name' => 'Güemes', 'source' => 'api']);

        $this->assertSame(1, $this->resolveFlowId());
    }

    public function test_sin_flujo_de_feriados_configurado_se_usa_el_del_dia(): void
    {
        $this->seedFlows(holidayFlowId: null);
        Carbon::setTestNow(Carbon::parse('2026-06-15 10:00:00', self::BA));
        Holiday::query()->create(['date' => '2026-06-15', 'name' => 'Güemes', 'source' => 'api']);

        $this->assertSame(1, $this->resolveFlowId());
    }

    public function test_el_flujo_de_feriados_inactivo_cae_al_del_dia(): void
    {
        $this->seedFlows();
        BotFlow::query()->whereKey(2)->update(['is_active' => false]);
        Carbon::setTestNow(Carbon::parse('2026-06-15 10:00:00', self::BA));
        Holiday::query()->create(['date' => '2026-06-15', 'name' => 'Güemes', 'source' => 'api']);

        $this->assertSame(1, $this->resolveFlowId());
    }

    public function test_el_flujo_de_feriados_debe_ser_de_webchat(): void
    {
        $this->seedFlows(holidayFlowId: 4); // flujo 4 solo sirve para WhatsApp
        Carbon::setTestNow(Carbon::parse('2026-06-15 10:00:00', self::BA));
        Holiday::query()->create(['date' => '2026-06-15', 'name' => 'Güemes', 'source' => 'api']);

        $this->assertSame(1, $this->resolveFlowId());
    }

    public function test_fuera_de_horario_tiene_prioridad_sobre_el_feriado(): void
    {
        $this->seedFlows(availabilityMode: 'schedule', outsideFlowId: 3);
        Carbon::setTestNow(Carbon::parse('2026-06-15 22:00:00', self::BA));
        Holiday::query()->create(['date' => '2026-06-15', 'name' => 'Güemes', 'source' => 'api']);

        $this->assertSame(3, $this->resolveFlowId());
    }

    // ── Endpoints de Configuración ───────────────────────────────────────────

    public function test_el_listado_devuelve_los_feriados_del_año(): void
    {
        Holiday::query()->create(['date' => '2026-06-15', 'name' => 'Güemes', 'source' => 'api']);
        Holiday::query()->create(['date' => '2027-06-21', 'name' => 'Güemes', 'source' => 'api']);

        $this->actingAs(User::find(1))
            ->getJson('/api/settings/holidays?year=2026')
            ->assertOk()
            ->assertJsonCount(1, 'holidays')
            ->assertJsonPath('holidays.0.date', '2026-06-15')
            ->assertJsonPath('holidays.0.source', 'api');
    }

    public function test_se_agrega_y_quita_un_feriado_a_mano(): void
    {
        $admin = User::find(1);

        $created = $this->actingAs($admin)
            ->postJson('/api/settings/holidays', ['date' => '2026-09-18', 'name' => 'Día del hospital'])
            ->assertCreated()
            ->assertJsonPath('holiday.source', 'manual')
            ->json('holiday.id');

        $this->actingAs($admin)
            ->postJson('/api/settings/holidays', ['date' => '2026-09-18', 'name' => 'Repetido'])
            ->assertStatus(422);

        $this->actingAs($admin)
            ->deleteJson("/api/settings/holidays/{$created}")
            ->assertOk();

        $this->assertDatabaseMissing('holidays', ['id' => $created, 'deleted_at' => null]);
        $this->assertDatabaseHas('activity_log', ['log_name' => 'holidays', 'event' => 'holiday_removed']);
    }

    public function test_importar_desde_la_api_por_endpoint_y_error_controlado(): void
    {
        Http::fake([self::API_2026 => Http::response([
            ['date' => '2026-12-25', 'localName' => 'Navidad', 'global' => true],
        ])]);

        $this->actingAs(User::find(1))
            ->postJson('/api/settings/holidays/import', ['year' => 2026])
            ->assertOk()
            ->assertJsonPath('created', 1);

        Http::fake(['*' => Http::response('error', 500)]);

        $this->actingAs(User::find(1))
            ->postJson('/api/settings/holidays/import', ['year' => 2027])
            ->assertStatus(502)
            ->assertJsonPath('ok', false);
    }

    public function test_un_operador_no_puede_administrar_feriados(): void
    {
        $this->actingAs(User::find(2))
            ->postJson('/api/settings/holidays', ['date' => '2026-09-18', 'name' => 'Día del hospital'])
            ->assertForbidden();

        $this->assertSame(0, Holiday::query()->count());
    }

    public function test_guardar_webchat_solo_acepta_flujos_de_webchat_para_feriados(): void
    {
        $this->seedFlows();

        $this->actingAs(User::find(1))
            ->postJson('/api/settings/webchat', $this->webchatPayload(holidayFlowId: 4))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Los flujos seleccionados deben estar activos y habilitados para Webchat.');

        $this->actingAs(User::find(1))
            ->postJson('/api/settings/webchat', $this->webchatPayload(holidayFlowId: 2))
            ->assertOk();

        $this->assertSame('2', SystemSetting::query()->where('key', 'webchat.holiday_flow_id')->value('value'));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Flujos 1 (día, default), 2 (feriados), 3 (fuera de horario) son de webchat; 4 es solo de WhatsApp. */
    private function seedFlows(?int $holidayFlowId = 2, string $availabilityMode = 'always', ?int $outsideFlowId = null): void
    {
        foreach ([
            [1, 'Día', ['webchat'], true],
            [2, 'Feriados', ['webchat'], true],
            [3, 'Fuera de horario', ['webchat'], true],
            [4, 'WhatsApp', ['whatsapp'], true],
        ] as [$id, $name, $channels, $active]) {
            DB::table('bot_flows')->insert([
                'id' => $id,
                'name' => $name,
                'is_active' => $active,
                'is_default' => $id === 1,
                'channels' => json_encode($channels),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $this->setSetting('general.timezone', self::BA);
        $this->setSetting('webchat.availability_mode', $availabilityMode);
        $this->setSetting('webchat.schedule_start', '08:00');
        $this->setSetting('webchat.schedule_end', '20:00');
        $this->setSetting('webchat.flow_schedule', json_encode(array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], 1
        )));
        $this->setSetting('webchat.holiday_flow_id', $holidayFlowId === null ? null : (string) $holidayFlowId);
        $this->setSetting('webchat.outside_schedule_flow_id', $outsideFlowId === null ? null : (string) $outsideFlowId);
    }

    private function activeHoliday(string $date): ?Holiday
    {
        return Holiday::query()->whereDate('date', $date)->first();
    }

    private function trashedHoliday(string $date): bool
    {
        return Holiday::onlyTrashed()->whereDate('date', $date)->exists();
    }

    private function setSetting(string $key, ?string $value): void
    {
        SystemSetting::query()->updateOrCreate(['key' => $key], ['value' => $value]);
    }

    private function resolveFlowId(): ?int
    {
        $resolver = app(WebchatFlowResolver::class);

        return $resolver->resolve($resolver->loadSettings())?->id;
    }

    private function webchatPayload(int $holidayFlowId): array
    {
        return [
            'enabled' => true,
            'availability_mode' => 'always',
            'schedule_start' => '08:00',
            'schedule_end' => '20:00',
            'bot_available_outside_schedule' => false,
            'offline_message' => 'Fuera de servicio',
            'title' => 'Asistente',
            'subtitle' => 'Hospital',
            'flow_schedule' => array_fill_keys(
                ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], 1
            ),
            'outside_schedule_flow_id' => null,
            'holiday_flow_id' => $holidayFlowId,
        ];
    }
}
