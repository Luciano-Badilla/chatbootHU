<?php

namespace Tests\Unit;

use App\Support\SpecialtyMatcher;
use PHPUnit\Framework\TestCase;

class SpecialtyMatcherTest extends TestCase
{
    public function test_matches_professional_and_specialty_forms(): void
    {
        $this->assertTrue(SpecialtyMatcher::matches('traumatólogo', 'Traumatología'));
        $this->assertTrue(SpecialtyMatcher::matches('cardiologo', 'Cardiología'));
        $this->assertTrue(SpecialtyMatcher::matches('pediatra', 'Pediatría'));
        $this->assertTrue(SpecialtyMatcher::matches('traumatologia', 'Traumatología'));
    }

    public function test_matches_each_specialty_mentioned_in_a_message(): void
    {
        $query = 'Quiero traumatólogo o cardiólogo';

        $this->assertTrue(SpecialtyMatcher::matches($query, 'Traumatología'));
        $this->assertTrue(SpecialtyMatcher::matches($query, 'Cardiología'));
        $this->assertFalse(SpecialtyMatcher::matches($query, 'Dermatología'));
    }

    public function test_tolerates_accents_typos_and_short_search_terms(): void
    {
        $this->assertTrue(SpecialtyMatcher::matches('cardiologia', 'Cardiología'));
        $this->assertTrue(SpecialtyMatcher::matches('pediatrria', 'Pediatría'));
        $this->assertTrue(SpecialtyMatcher::matches('cardio', 'Cardiología'));
        $this->assertFalse(SpecialtyMatcher::matches('cardio', 'Dermatología'));
    }
}
