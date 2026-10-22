<?php

namespace Tests\Unit;

use App\Support\EmailHtmlSanitizer;
use Tests\TestCase;

class EmailHtmlSanitizerTest extends TestCase
{
    public function test_it_keeps_basic_email_markup_and_removes_executable_content(): void
    {
        $html = (new EmailHtmlSanitizer())->sanitize(
            '<p onclick="run()" style="text-align: center; background-image: url(https://bad.test/x)">Hola <strong>Lucía</strong><script>alert(1)</script> '
            .'<a href="javascript:alert(1)">enlace inseguro</a> <a href="https://hospital.example">portal</a></p>',
        );

        $this->assertStringContainsString('<strong>Lucía</strong>', $html);
        $this->assertStringContainsString('href="https://hospital.example"', $html);
        $this->assertStringContainsString('text-align: center', $html);
        $this->assertStringNotContainsString('onclick', $html);
        $this->assertStringNotContainsString('script', $html);
        $this->assertStringNotContainsString('javascript:', $html);
        $this->assertStringNotContainsString('background-image', $html);
    }
}
