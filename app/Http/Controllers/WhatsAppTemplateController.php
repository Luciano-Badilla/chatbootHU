<?php

namespace App\Http\Controllers;

use App\Models\WhatsAppTemplate;
use App\Services\AuditService;
use App\Services\WhatsAppTemplateSyncService;
use Illuminate\Http\Request;

class WhatsAppTemplateController extends Controller
{
    public function __construct(
        private readonly AuditService $auditService,
        private readonly WhatsAppTemplateSyncService $syncService,
    ) {}

    /**
     * Plantillas que se pueden enviar desde un chat: aprobadas por Meta y compatibles con el módulo.
     */
    public function apiIndex()
    {
        $templates = WhatsAppTemplate::query()
            ->where('status', 'APPROVED')
            ->where('is_supported', true)
            ->orderBy('name')
            ->orderBy('language')
            ->get()
            ->map(fn (WhatsAppTemplate $template) => [
                'id' => $template->id,
                'name' => $template->name,
                'language' => $template->language,
                'body' => $template->body,
                'variable_keys' => $template->variable_keys ?? [],
            ])
            ->values();

        return response()->json(['templates' => $templates]);
    }

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
