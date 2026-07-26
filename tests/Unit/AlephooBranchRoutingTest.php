<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

class AlephooBranchRoutingTest extends TestCase
{
    public function test_runtime_does_not_reload_the_resolved_lookup_branch_before_advancing(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2) . '/app/Http/Controllers/WhatsAppController.php');
        $runAutoAdvance = $this->methodBody($source, 'runAutoAdvance');

        $this->assertStringContainsString('$chat->refresh();', $runAutoAdvance);
        $this->assertStringNotContainsString('$justSent->refresh();', $runAutoAdvance);
        $this->assertStringContainsString('$current->next_node_id', $runAutoAdvance);
    }

    public function test_selection_nodes_auto_advance_only_after_an_empty_or_error_branch_is_resolved(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2) . '/app/Http/Controllers/WhatsAppController.php');

        $this->assertStringContainsString("\$node->setAttribute('runtime_branch_resolved', true);", $source);
        $this->assertStringContainsString("return (bool) \$node->getAttribute('runtime_branch_resolved');", $source);
    }

    private function methodBody(string $source, string $method): string
    {
        $start = strpos($source, "private function {$method}");
        $this->assertNotFalse($start);

        $nextMethod = strpos($source, "\n    private function ", $start + 1);

        return substr($source, $start, $nextMethod === false ? null : $nextMethod - $start);
    }
}
