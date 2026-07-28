<?php

namespace Tests\Unit;

use App\Models\WhatsAppTemplate;
use App\Services\WhatsAppTemplateSyncService;
use PHPUnit\Framework\TestCase;

class WhatsAppTemplateSyncServiceTest extends TestCase
{
    public function test_it_maps_meta_body_variables_to_csv_columns(): void
    {
        $service = new WhatsAppTemplateSyncService;

        $attributes = $service->attributesFromMeta([
            'id' => '12345',
            'category' => 'UTILITY',
            'status' => 'APPROVED',
            'components' => [
                [
                    'type' => 'BODY',
                    'text' => 'Hola {{1}}, tu turno es el {{2}}.',
                ],
            ],
        ]);

        $this->assertSame('12345', $attributes['meta_template_id']);
        $this->assertSame(['variable_1', 'variable_2'], $attributes['variable_keys']);
        $this->assertTrue($attributes['is_supported']);
    }

    public function test_it_preserves_existing_variable_names_when_the_count_matches(): void
    {
        $service = new WhatsAppTemplateSyncService;
        $existing = new WhatsAppTemplate([
            'variable_keys' => ['nombre', 'fecha'],
        ]);

        $attributes = $service->attributesFromMeta([
            'id' => '12345',
            'components' => [
                [
                    'type' => 'BODY',
                    'text' => 'Hola {{1}}, tu turno es el {{2}}.',
                ],
            ],
        ], $existing);

        $this->assertSame(['nombre', 'fecha'], $attributes['variable_keys']);
    }

    public function test_it_marks_media_header_templates_as_unsupported(): void
    {
        $service = new WhatsAppTemplateSyncService;

        $attributes = $service->attributesFromMeta([
            'id' => '12345',
            'components' => [
                [
                    'type' => 'HEADER',
                    'format' => 'IMAGE',
                ],
                [
                    'type' => 'BODY',
                    'text' => 'Contenido de prueba',
                ],
            ],
        ]);

        $this->assertFalse($attributes['is_supported']);
    }

    public function test_it_marks_carousel_templates_as_unsupported(): void
    {
        $service = new WhatsAppTemplateSyncService;

        $attributes = $service->attributesFromMeta([
            'id' => '12345',
            'components' => [
                [
                    'type' => 'BODY',
                    'text' => 'Contenido de prueba',
                ],
                [
                    'type' => 'CAROUSEL',
                    'cards' => [],
                ],
            ],
        ]);

        $this->assertFalse($attributes['is_supported']);
    }
}
