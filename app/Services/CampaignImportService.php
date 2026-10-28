<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\User;
use App\Models\WhatsAppTemplate;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

class CampaignImportService
{
    public function create(
        string $name,
        WhatsAppTemplate $template,
        string $sourceFilename,
        array $rows,
        ?User $creator = null,
        ?Carbon $scheduledAt = null,
    ): Campaign {
        $variableKeys = $template->variable_keys ?? [];
        $seenPhones = [];
        $recipients = [];
        $errors = [];
        $duplicateCount = 0;

        foreach ($rows as $index => $row) {
            $rowNumber = max(2, (int) ($row['row_number'] ?? ($index + 2)));
            $phone = $this->normalizePhone((string) ($row['phone'] ?? ''));
            $values = is_array($row['values'] ?? null) ? $row['values'] : [];
            $recipientName = $this->extractRecipientName($values);

            if (! $this->isValidPhone($phone)) {
                $errors[] = [
                    'row' => $rowNumber,
                    'message' => 'El telefono debe incluir codigo de pais y contener entre 10 y 15 digitos.',
                ];

                continue;
            }

            if (isset($seenPhones[$phone])) {
                $duplicateCount++;
                $errors[] = [
                    'row' => $rowNumber,
                    'message' => "Telefono duplicado en el archivo: {$phone}.",
                ];

                continue;
            }

            $missingKeys = array_values(array_filter(
                $variableKeys,
                fn (string $key) => trim((string) ($values[$key] ?? '')) === ''
            ));

            if ($missingKeys !== []) {
                $errors[] = [
                    'row' => $rowNumber,
                    'message' => 'Faltan valores para: '.implode(', ', $missingKeys).'.',
                ];

                continue;
            }

            $seenPhones[$phone] = true;
            $normalizedValues = [];

            foreach ($variableKeys as $key) {
                $normalizedValues[$key] = trim((string) ($values[$key] ?? ''));
            }

            $recipients[] = [
                'row_number' => $rowNumber,
                'phone' => $phone,
                'name' => $recipientName,
                'variables' => $normalizedValues,
                'rendered_body' => $template->render($normalizedValues),
                'status' => 'pending',
            ];
        }

        if ($scheduledAt && $recipients === []) {
            throw ValidationException::withMessages([
                'rows' => 'No se puede programar una campaña sin destinatarios válidos.',
            ]);
        }

        return DB::transaction(function () use (
            $name,
            $template,
            $sourceFilename,
            $rows,
            $recipients,
            $errors,
            $duplicateCount,
            $creator,
            $scheduledAt,
        ) {
            $campaign = Campaign::create([
                'name' => trim($name),
                'whatsapp_template_id' => $template->id,
                'status' => $scheduledAt ? 'scheduled' : 'draft',
                'source_filename' => $sourceFilename,
                'total_count' => count($rows),
                'valid_count' => count($recipients),
                'invalid_count' => max(0, count($errors) - $duplicateCount),
                'duplicate_count' => $duplicateCount,
                'import_errors' => array_slice($errors, 0, 200),
                'created_by' => $creator?->id,
                'scheduled_at' => $scheduledAt,
            ]);

            if ($recipients !== []) {
                $campaign->recipients()->createMany($recipients);
            }

            return $campaign->load(['template', 'creator']);
        });
    }

    public function updateDraft(
        Campaign $campaign,
        string $name,
        WhatsAppTemplate $template,
        ?string $sourceFilename,
        ?array $rows,
        ?Carbon $scheduledAt = null,
    ): Campaign {
        $recipients = [];
        $errors = [];
        $duplicateCount = 0;

        if ($rows !== null) {
            $variableKeys = $template->variable_keys ?? [];
            $seenPhones = [];

            foreach ($rows as $index => $row) {
                $rowNumber = max(2, (int) ($row['row_number'] ?? ($index + 2)));
                $phone = $this->normalizePhone((string) ($row['phone'] ?? ''));
                $values = is_array($row['values'] ?? null) ? $row['values'] : [];
                $recipientName = $this->extractRecipientName($values);

                if (! $this->isValidPhone($phone)) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'El telefono debe incluir codigo de pais y contener entre 10 y 15 digitos.'];
                    continue;
                }

                if (isset($seenPhones[$phone])) {
                    $duplicateCount++;
                    $errors[] = ['row' => $rowNumber, 'message' => "Telefono duplicado en el archivo: {$phone}."];
                    continue;
                }

                $missingKeys = array_values(array_filter(
                    $variableKeys,
                    fn (string $key) => trim((string) ($values[$key] ?? '')) === ''
                ));

                if ($missingKeys !== []) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'Faltan valores para: '.implode(', ', $missingKeys).'.'];
                    continue;
                }

                $seenPhones[$phone] = true;
                $normalizedValues = [];

                foreach ($variableKeys as $key) {
                    $normalizedValues[$key] = trim((string) ($values[$key] ?? ''));
                }

                $recipients[] = [
                    'row_number' => $rowNumber,
                    'phone' => $phone,
                    'name' => $recipientName,
                    'variables' => $normalizedValues,
                    'rendered_body' => $template->render($normalizedValues),
                    'status' => 'pending',
                ];
            }

            if ($scheduledAt && $recipients === []) {
                throw ValidationException::withMessages([
                    'rows' => 'No se puede programar una campaña sin destinatarios válidos.',
                ]);
            }
        } else {
            $existingRecipients = $campaign->recipients()->get();
            $variableKeys = $template->variable_keys ?? [];

            foreach ($existingRecipients as $recipient) {
                $values = is_array($recipient->variables) ? $recipient->variables : [];
                $missingKeys = array_values(array_filter(
                    $variableKeys,
                    fn (string $key) => trim((string) ($values[$key] ?? '')) === ''
                ));

                if ($missingKeys !== []) {
                    throw ValidationException::withMessages([
                        'whatsapp_template_id' => 'La plantilla elegida requiere variables que no están guardadas en los destinatarios. Importá un archivo nuevo para cambiar la plantilla.',
                    ]);
                }
            }

            if ($scheduledAt && $existingRecipients->isEmpty()) {
                throw ValidationException::withMessages([
                    'rows' => 'No se puede programar una campaña sin destinatarios válidos.',
                ]);
            }
        }

        $campaignId = $campaign->id;

        return DB::transaction(function () use (
            $campaignId,
            $name,
            $template,
            $sourceFilename,
            $rows,
            $recipients,
            $errors,
            $duplicateCount,
            $scheduledAt,
        ) {
            $campaign = Campaign::query()->lockForUpdate()->findOrFail($campaignId);
            if ($campaign->status !== 'draft') {
                throw ValidationException::withMessages([
                    'campaign' => 'Solo se pueden editar campañas en borrador.',
                ]);
            }

            if ($rows !== null) {
                $campaign->recipients()->delete();
                if ($recipients !== []) {
                    $campaign->recipients()->createMany($recipients);
                }

                $campaign->total_count = count($rows);
                $campaign->valid_count = count($recipients);
                $campaign->invalid_count = max(0, count($errors) - $duplicateCount);
                $campaign->duplicate_count = $duplicateCount;
                $campaign->import_errors = array_slice($errors, 0, 200);
                $campaign->source_filename = $sourceFilename;
            } elseif ($template->id !== $campaign->whatsapp_template_id) {
                foreach ($campaign->recipients()->get() as $recipient) {
                    $values = is_array($recipient->variables) ? $recipient->variables : [];
                    $normalizedValues = [];
                    foreach ($template->variable_keys ?? [] as $key) {
                        $normalizedValues[$key] = trim((string) $values[$key]);
                    }

                    $recipient->update([
                        'variables' => $normalizedValues,
                        'rendered_body' => $template->render($normalizedValues),
                    ]);
                }
            }

            $campaign->name = trim($name);
            $campaign->whatsapp_template_id = $template->id;
            $campaign->status = $scheduledAt ? 'scheduled' : 'draft';
            $campaign->scheduled_at = $scheduledAt;
            $campaign->save();

            return $campaign->load(['template', 'creator']);
        });
    }

    public function normalizePhone(string $phone): string
    {
        $normalized = preg_replace('/\D+/', '', trim($phone)) ?? '';

        if (str_starts_with($normalized, '00')) {
            $normalized = substr($normalized, 2);
        }

        return $normalized;
    }

    public function isValidPhone(string $phone): bool
    {
        return preg_match('/^[1-9]\d{9,14}$/', $phone) === 1;
    }

    public function extractRecipientName(array $values): ?string
    {
        foreach (['nombre', 'name', 'destinatario', 'paciente'] as $key) {
            $name = trim((string) ($values[$key] ?? ''));

            if ($name !== '') {
                return $name;
            }
        }

        return null;
    }
}
