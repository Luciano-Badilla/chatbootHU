<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

class AlephooAppointmentCreateTest extends TestCase
{
    public function test_appointment_creation_revalidates_the_slot_before_posting(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2) . '/app/Http/Controllers/WhatsAppController.php');

        $availabilityCall = strpos($source, '->get($baseUrl . "/turnos/{$doctorId}/{$specialtyId}/{$days}")');
        $createCall = strpos($source, "->post(\$baseUrl . '/crear/turno', \$payload)");

        $this->assertNotFalse($availabilityCall);
        $this->assertNotFalse($createCall);
        $this->assertLessThan($createCall, $availabilityCall);
        $this->assertStringContainsString("'agenda_id' => (int) \$agendaId", $source);
        $this->assertStringContainsString("'persona_id' => (int) \$personId", $source);
        $this->assertStringContainsString("'especialidad_id' => (int) \$specialtyId", $source);
    }

    public function test_it_exposes_created_unavailable_and_error_results(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2) . '/app/Http/Controllers/WhatsAppController.php');

        $this->assertStringContainsString("'turno_create_status' => 'created'", $source);
        $this->assertStringContainsString("\$resultVars['turno_create_status'] = 'unavailable'", $source);
        $this->assertStringContainsString("\$settings['error_next_node_id']", $source);
    }
}
