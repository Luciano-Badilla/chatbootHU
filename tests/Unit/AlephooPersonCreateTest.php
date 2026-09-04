<?php

namespace Tests\Unit;

use App\Http\Controllers\WhatsAppController;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

class AlephooPersonCreateTest extends TestCase
{
    public function test_it_builds_the_documented_alephoo_v3_payload_with_address(): void
    {
        $reflection = new ReflectionClass(WhatsAppController::class);
        $controller = $reflection->newInstanceWithoutConstructor();
        $method = $reflection->getMethod('buildAlephooV3PersonPayload');
        $method->setAccessible(true);

        $payload = $method->invoke($controller, [
            'last_name' => 'Perez', 'first_name' => 'Ana', 'dni' => '23456789',
            'birth_date' => '1985-08-20', 'gender' => 'F', 'street' => 'San Martin',
            'street_number' => '1234', 'email' => 'ana@example.com',
            'phone_code' => '261', 'phone' => '5551234', 'plan_id' => 29,
        ]);

        $this->assertSame('Admin\\Persona', $payload['data']['type']);
        $this->assertSame(1, $payload['data']['attributes']['tipoDocumento']);
        $this->assertSame('San Martin', $payload['data']['attributes']['calle']);
        $this->assertSame('1234', $payload['data']['attributes']['numero']);
        $this->assertSame('F', $payload['data']['attributes']['sexo']);
        $this->assertSame('F', $payload['data']['attributes']['generoDocumento']);
        $this->assertSame('54', $payload['data']['attributes']['celulares'][0]['paisCelularSelected']['attributes']['prefijoTelefonico']);
        $this->assertSame(29, $payload['data']['attributes']['coberturaMedica'][0]['planSelected']['id']);
    }

    public function test_person_creation_uses_alephoo_v3_directly(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/WhatsAppController.php');
        $start = strpos($source, 'private function sendPersonCreateNode');
        $end = strpos($source, 'private function buildAlephooV3PersonPayload', $start);
        $methodSource = substr($source, $start, $end - $start);

        $this->assertStringContainsString("->withBasicAuth(\$username, \$password)", $methodSource);
        $this->assertStringContainsString("->accept('application/vnd.api+json')", $methodSource);
        $this->assertStringContainsString("->post(\$baseUrl.'/admin/personas'", $methodSource);
        $this->assertStringNotContainsString("'/crear/persona'", $methodSource);
        $this->assertStringNotContainsString('alephooApiKey()', $methodSource);
    }
}
