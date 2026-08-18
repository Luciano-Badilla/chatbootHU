<?php

namespace Tests\Unit;

use App\Services\DashboardMetricsService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use PHPUnit\Framework\TestCase;

class DashboardMetricsServiceTest extends TestCase
{
    public function test_it_measures_one_response_for_a_consecutive_contact_message_block(): void
    {
        $start = Carbon::parse('2026-08-17 00:00:00');
        $end = Carbon::parse('2026-08-17 23:59:59');
        $messages = new Collection([
            10 => new Collection([
                $this->message('contact', '2026-08-17 10:00:00'),
                $this->message('contact', '2026-08-17 10:00:10'),
                $this->message('user', '2026-08-17 10:01:00'),
            ]),
        ]);

        $seconds = (new DashboardMetricsService)->responseSecondsFromMessages($messages, $start, $end);

        $this->assertSame(60, $seconds);
    }

    public function test_it_averages_responses_and_ignores_unanswered_blocks(): void
    {
        $start = Carbon::parse('2026-08-17 00:00:00');
        $end = Carbon::parse('2026-08-17 23:59:59');
        $messages = new Collection([
            10 => new Collection([
                $this->message('contact', '2026-08-17 10:00:00'),
                $this->message('user', '2026-08-17 10:01:00'),
                $this->message('contact', '2026-08-17 11:00:00'),
            ]),
            11 => new Collection([
                $this->message('contact', '2026-08-17 12:00:00'),
                $this->message('user', '2026-08-17 12:03:00'),
            ]),
        ]);

        $seconds = (new DashboardMetricsService)->responseSecondsFromMessages($messages, $start, $end);

        $this->assertSame(120, $seconds);
    }

    private function message(string $sender, string $createdAt): object
    {
        return (object) [
            'sender' => $sender,
            'created_at' => Carbon::parse($createdAt),
        ];
    }
}
