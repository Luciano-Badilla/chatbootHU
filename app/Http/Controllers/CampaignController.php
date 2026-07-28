<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\WhatsAppTemplate;
use App\Services\AuditService;
use App\Services\CampaignImportService;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

class CampaignController extends Controller
{
    public function __construct(
        private readonly CampaignImportService $campaignImportService,
        private readonly AuditService $auditService,
    ) {}

    public function index()
    {
        return Inertia::render('CampaignsPanel', [
            'campaigns' => $this->campaigns(),
            'templates' => $this->templates(),
        ]);
    }

    public function apiIndex()
    {
        return response()->json([
            'campaigns' => $this->campaigns(),
            'templates' => $this->templates(),
        ]);
    }

    public function show(Campaign $campaign)
    {
        $campaign->load(['template', 'creator']);

        return response()->json([
            'campaign' => $this->serializeCampaign($campaign),
            'recipients' => $campaign->recipients()
                ->orderBy('row_number')
                ->orderBy('id')
                ->paginate(100),
        ]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:160'],
            'whatsapp_template_id' => ['required', 'integer', 'exists:whatsapp_templates,id'],
            'source_filename' => ['required', 'string', 'max:255'],
            'rows' => ['required', 'array', 'min:1', 'max:5000'],
            'rows.*.row_number' => ['nullable', 'integer', 'min:2'],
            'rows.*.phone' => ['nullable', 'string', 'max:80'],
            'rows.*.values' => ['nullable', 'array'],
        ]);

        $template = WhatsAppTemplate::query()->findOrFail($data['whatsapp_template_id']);

        if (strtoupper($template->status) !== 'APPROVED') {
            throw ValidationException::withMessages([
                'whatsapp_template_id' => 'Solo se pueden usar plantillas aprobadas por Meta.',
            ]);
        }

        if (! $template->is_supported) {
            throw ValidationException::withMessages([
                'whatsapp_template_id' => 'La plantilla usa componentes que esta version del modulo todavia no puede enviar.',
            ]);
        }

        $campaign = $this->campaignImportService->create(
            $data['name'],
            $template,
            $data['source_filename'],
            $data['rows'],
            $request->user(),
        );

        $this->auditService->record(
            'campaigns',
            'created',
            "Creo la campaña {$campaign->name}",
            $request->user(),
            $campaign,
            [
                'template' => $template->name,
                'total_count' => $campaign->total_count,
                'valid_count' => $campaign->valid_count,
                'invalid_count' => $campaign->invalid_count,
                'duplicate_count' => $campaign->duplicate_count,
            ],
        );

        return response()->json([
            'ok' => true,
            'campaign' => $this->serializeCampaign($campaign),
        ], 201);
    }

    public function launch(Request $request, Campaign $campaign)
    {
        if (! in_array($campaign->status, ['draft', 'paused'], true)) {
            throw ValidationException::withMessages([
                'campaign' => 'La campaña no se puede iniciar desde su estado actual.',
            ]);
        }

        if ($campaign->valid_count < 1 || ! $campaign->recipients()->where('status', 'pending')->exists()) {
            throw ValidationException::withMessages([
                'campaign' => 'La campaña no tiene destinatarios pendientes válidos.',
            ]);
        }

        $campaign->load('template');
        if (! $campaign->template || strtoupper($campaign->template->status) !== 'APPROVED') {
            throw ValidationException::withMessages([
                'campaign' => 'La plantilla dejó de estar aprobada y la campaña no puede iniciarse.',
            ]);
        }

        $campaign->update([
            'status' => 'running',
            'started_at' => $campaign->started_at ?? now(),
            'finished_at' => null,
        ]);

        $this->auditService->record(
            'campaigns',
            'launched',
            "Inicio la campaña {$campaign->name}",
            $request->user(),
            $campaign,
            ['valid_count' => $campaign->valid_count],
        );

        return response()->json([
            'ok' => true,
            'campaign' => $this->serializeCampaign($campaign->fresh(['template', 'creator'])),
            'message' => 'Campaña iniciada. Los destinatarios se enviarán mediante la cola.',
        ]);
    }

    public function pause(Request $request, Campaign $campaign)
    {
        if ($campaign->status !== 'running') {
            throw ValidationException::withMessages([
                'campaign' => 'Solo se pueden pausar campañas en ejecución.',
            ]);
        }

        $campaign->update(['status' => 'paused']);

        $this->auditService->record(
            'campaigns',
            'paused',
            "Pauso la campaña {$campaign->name}",
            $request->user(),
            $campaign,
        );

        return response()->json([
            'ok' => true,
            'campaign' => $this->serializeCampaign($campaign->fresh(['template', 'creator'])),
        ]);
    }

    private function campaigns()
    {
        return Campaign::query()
            ->with(['template', 'creator'])
            ->latest()
            ->limit(100)
            ->get()
            ->map(fn (Campaign $campaign) => $this->serializeCampaign($campaign))
            ->values();
    }

    private function templates()
    {
        return WhatsAppTemplate::query()
            ->with('creator')
            ->latest()
            ->get()
            ->map(fn (WhatsAppTemplate $template) => [
                'id' => $template->id,
                'meta_template_id' => $template->meta_template_id,
                'name' => $template->name,
                'language' => $template->language,
                'category' => $template->category,
                'status' => $template->status,
                'body' => $template->body,
                'is_supported' => $template->is_supported,
                'variable_keys' => $template->variable_keys ?? [],
                'created_by' => $template->creator?->name,
                'created_at' => $template->created_at?->toIso8601String(),
                'synced_at' => $template->synced_at?->toIso8601String(),
            ])
            ->values();
    }

    private function serializeCampaign(Campaign $campaign): array
    {
        return [
            'id' => $campaign->id,
            'name' => $campaign->name,
            'status' => $campaign->status,
            'source_filename' => $campaign->source_filename,
            'total_count' => $campaign->total_count,
            'valid_count' => $campaign->valid_count,
            'invalid_count' => $campaign->invalid_count,
            'duplicate_count' => $campaign->duplicate_count,
            'sent_count' => $campaign->sent_count,
            'delivered_count' => $campaign->delivered_count,
            'read_count' => $campaign->read_count,
            'failed_count' => $campaign->failed_count,
            'import_errors' => $campaign->import_errors ?? [],
            'template' => $campaign->template ? [
                'id' => $campaign->template->id,
                'name' => $campaign->template->name,
                'language' => $campaign->template->language,
                'status' => $campaign->template->status,
            ] : null,
            'created_by' => $campaign->creator?->name,
            'started_at' => $campaign->started_at?->toIso8601String(),
            'finished_at' => $campaign->finished_at?->toIso8601String(),
            'created_at' => $campaign->created_at?->toIso8601String(),
        ];
    }
}
