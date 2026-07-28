<?php

namespace Tests\Unit;

use App\Models\WhatsAppTemplate;
use PHPUnit\Framework\TestCase;

class WhatsAppTemplateRenderTest extends TestCase
{
    public function test_it_renders_template_variables_in_meta_order(): void
    {
        $template = new WhatsAppTemplate([
            'body' => 'Hola {{1}}, recordamos tu turno del {{2}} a las {{3}}.',
            'variable_keys' => ['nombre', 'fecha', 'hora'],
        ]);

        $this->assertSame(
            'Hola Ana, recordamos tu turno del 29/07/2026 a las 10:30.',
            $template->render([
                'nombre' => 'Ana',
                'fecha' => '29/07/2026',
                'hora' => '10:30',
            ]),
        );
    }
}
