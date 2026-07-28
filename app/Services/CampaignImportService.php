<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\User;
use App\Models\WhatsAppTemplate;
use Illuminate\Support\Facades\DB;

class CampaignImportService
{
    public function create(
        string $name,
        WhatsAppTemplate $template,
        string $sourceFilename,
        array $rows,
        ?User $creator = null
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

        return DB::transaction(function () use (
            $name,
            $template,
            $sourceFilename,
            $rows,
            $recipients,
            $errors,
            $duplicateCount,
            $creator
        ) {
            $campaign = Campaign::create([
                'name' => trim($name),
                'whatsapp_template_id' => $template->id,
                'status' => 'draft',
                'source_filename' => $sourceFilename,
                'total_count' => count($rows),
                'valid_count' => count($recipients),
                'invalid_count' => max(0, count($errors) - $duplicateCount),
                'duplicate_count' => $duplicateCount,
                'import_errors' => array_slice($errors, 0, 200),
                'created_by' => $creator?->id,
            ]);

            if ($recipients !== []) {
                $campaign->recipients()->createMany($recipients);
            }

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
