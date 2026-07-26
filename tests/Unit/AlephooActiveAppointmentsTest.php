<?php

namespace Tests\Unit;

use App\Http\Controllers\WhatsAppController;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

class AlephooActiveAppointmentsTest extends TestCase
{
    public function test_the_endpoint_query_does_not_send_an_exact_date_filter(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2) . '/app/Http/Controllers/WhatsAppController.php');

        $this->assertStringNotContainsString("'filter[fecha]' =>", $source);
        $this->assertStringContainsString("'sort' => '-fecha,-hora'", $source);
    }

    public function test_it_keeps_only_pending_future_appointments_and_orders_them(): void
    {
        $payload = [
            'data' => [
                $this->appointment(30, '2026-07-23', '09:00', 1),
                $this->appointment(20, '2026-07-24', '10:00', 1),
                $this->appointment(10, '2026-07-23', '16:00', 1),
                $this->appointment(40, '2026-07-25', '12:00', 3),
            ],
            'included' => [
                [
                    'type' => 'Admision\\Estadoturno',
                    'id' => 1,
                    'attributes' => ['nombre' => 'Pendiente', 'codigo' => 'P'],
                ],
                [
                    'type' => 'Admision\\Estadoturno',
                    'id' => 3,
                    'attributes' => ['nombre' => 'Cancelado', 'codigo' => 'C'],
                ],
                [
                    'type' => 'Admision\\Agenda',
                    'id' => 100,
                    'relationships' => [
                        'especialidad' => ['data' => ['type' => 'Admin\\Especialidad', 'id' => 5]],
                        'profesional' => ['data' => ['type' => 'Admin\\Personal', 'id' => 7]],
                    ],
                ],
                [
                    'type' => 'Admin\\Especialidad',
                    'id' => 5,
                    'attributes' => ['nombre' => 'Cardiología'],
                ],
                [
                    'type' => 'Admin\\Personal',
                    'id' => 7,
                    'relationships' => [
                        'persona' => ['data' => ['type' => 'Admin\\Persona', 'id' => 8]],
                    ],
                ],
                [
                    'type' => 'Admin\\Persona',
                    'id' => 8,
                    'attributes' => ['nombres' => 'Ana', 'apellidos' => 'Pérez'],
                ],
            ],
        ];

        $appointments = $this->normalize(
            $payload,
            new \DateTimeImmutable('2026-07-23 15:00:00', new \DateTimeZone('America/Argentina/Buenos_Aires')),
            true
        );

        $this->assertSame([10, 20], array_column($appointments, 'id'));
        $this->assertSame('Cardiología', $appointments[0]['especialidad']);
        $this->assertSame('Ana Pérez', $appointments[0]['profesional']);
        $this->assertSame('Pendiente', $appointments[0]['estado']);
    }

    public function test_it_can_keep_an_elapsed_time_from_today_when_configured(): void
    {
        $payload = [
            'data' => [$this->appointment(30, '2026-07-23', '09:00', 1)],
            'included' => [[
                'type' => 'Admision\\Estadoturno',
                'id' => 1,
                'attributes' => ['alias' => 'Pendiente'],
            ]],
        ];

        $appointments = $this->normalize(
            $payload,
            new \DateTimeImmutable('2026-07-23 15:00:00', new \DateTimeZone('America/Argentina/Buenos_Aires')),
            false
        );

        $this->assertCount(1, $appointments);
    }

    public function test_each_appointment_can_populate_its_own_template_variables(): void
    {
        $first = $this->templateVars([
            'id' => 10,
            'fecha' => '2026-07-25',
            'hora' => '09:00',
            'especialidad' => 'Cardiologia',
            'profesional' => 'Ana Perez',
        ]);
        $second = $this->templateVars([
            'id' => 20,
            'fecha' => '2026-07-26',
            'hora' => '11:30',
            'especialidad' => 'Clinica',
            'profesional' => 'Juan Gomez',
        ]);

        $this->assertSame(10, $first['turno_id']);
        $this->assertSame('Cardiologia', $first['turno_especialidad']);
        $this->assertSame(20, $second['turno_id']);
        $this->assertSame('Juan Gomez', $second['turno_profesional']);
    }

    public function test_cancel_mode_waits_for_the_selected_appointment_instead_of_auto_advancing(): void
    {
        $reflection = new ReflectionClass(WhatsAppController::class);
        $controller = $reflection->newInstanceWithoutConstructor();
        $node = new \App\Models\BotNode(['type' => 'appointment_lookup']);
        $node->setAttribute('runtime_waiting_input', true);
        $method = $reflection->getMethod('shouldAutoAdvance');
        $method->setAccessible(true);

        $this->assertFalse($method->invoke($controller, $node));
    }

    private function appointment(int $id, string $date, string $time, int $stateId): array
    {
        return [
            'type' => 'Admision\\Turnoprogramado',
            'id' => $id,
            'attributes' => [
                'fecha' => $date,
                'hora' => $time,
                'sobreturno' => false,
                'observacion' => '',
                'fechahoraArribo' => null,
            ],
            'relationships' => [
                'estadoTurno' => ['data' => ['type' => 'Admision\\Estadoturno', 'id' => $stateId]],
                'agenda' => ['data' => ['type' => 'Admision\\Agenda', 'id' => 100]],
                'plan' => ['data' => ['type' => 'Admin\\Plan', 'id' => 109]],
            ],
        ];
    }

    private function normalize(array $payload, \DateTimeImmutable $now, bool $excludeElapsedToday): array
    {
        $reflection = new ReflectionClass(WhatsAppController::class);
        $controller = $reflection->newInstanceWithoutConstructor();
        $method = $reflection->getMethod('normalizeActiveAppointments');
        $method->setAccessible(true);

        return $method->invoke($controller, $payload, $now, $excludeElapsedToday);
    }

    private function templateVars(array $appointment): array
    {
        $reflection = new ReflectionClass(WhatsAppController::class);
        $controller = $reflection->newInstanceWithoutConstructor();
        $method = $reflection->getMethod('appointmentTemplateVars');
        $method->setAccessible(true);

        return $method->invoke($controller, $appointment);
    }
}
