<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

class AlephooAppointmentCancelTest extends TestCase
{
    public function test_it_encrypts_and_cancels_only_an_appointment_from_the_lookup_result(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2) . '/app/Http/Controllers/WhatsAppController.php');

        $this->assertStringContainsString("!in_array((string) \$appointmentId, \$knownAppointmentIds, true)", $source);
        $this->assertStringContainsString("openssl_encrypt(\$appointmentId, 'AES-128-CBC'", $source);
        $this->assertStringContainsString("->put(\$baseUrl . '/cancelarTurnos/'", $source);
        $this->assertStringContainsString("'turno_cancel_status' => 'error'", $source);
        $this->assertStringContainsString("\$resultVars['turno_cancel_status'] = 'cancelled'", $source);
        $this->assertStringContainsString("\$settings['unavailable_next_node_id']", $source);
        $this->assertStringContainsString("\$settings['error_next_node_id']", $source);
    }
}
