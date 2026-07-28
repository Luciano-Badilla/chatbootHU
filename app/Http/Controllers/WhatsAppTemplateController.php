<?php

namespace App\Http\Controllers;

use App\Services\AuditService;
use App\Services\WhatsAppTemplateSyncService;
use Illuminate\Http\Request;

class WhatsAppTemplateController extends Controller
{
    public function __construct(
        private readonly AuditService $auditService,
        private readonly WhatsAppTemplateSyncService $syncService,
    ) {}

    public function sync(Request $request)
    {
        $result = $this->syncService->sync();

        $this->auditService->record(
            'campaigns',
            'templates_synced',
            'Sincronizo las plantillas de WhatsApp desde Meta',
            $request->user(),
            null,
            $result,
        );

        return response()->json([
            'ok' => true,
            'summary' => $result,
        ]);
    }
}
