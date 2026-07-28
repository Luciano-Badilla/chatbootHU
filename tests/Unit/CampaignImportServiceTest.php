<?php

namespace Tests\Unit;

use App\Services\CampaignImportService;
use PHPUnit\Framework\TestCase;

class CampaignImportServiceTest extends TestCase
{
    public function test_it_normalizes_international_phone_numbers(): void
    {
        $service = new CampaignImportService;

        $this->assertSame('5492615551234', $service->normalizePhone('+54 9 261 555-1234'));
        $this->assertSame('5492615551234', $service->normalizePhone('0054 9 261 555 1234'));
    }

    public function test_it_requires_between_ten_and_fifteen_digits(): void
    {
        $service = new CampaignImportService;

        $this->assertTrue($service->isValidPhone('5492615551234'));
        $this->assertFalse($service->isValidPhone('02615551234'));
        $this->assertFalse($service->isValidPhone('123'));
        $this->assertFalse($service->isValidPhone('1234567890123456'));
    }

    public function test_it_extracts_an_optional_recipient_name(): void
    {
        $service = new CampaignImportService;

        $this->assertSame('Luciano', $service->extractRecipientName(['nombre' => ' Luciano ']));
        $this->assertSame('Paciente de prueba', $service->extractRecipientName(['paciente' => 'Paciente de prueba']));
        $this->assertNull($service->extractRecipientName([]));
    }
}
