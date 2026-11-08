<?php

namespace App\Http\Controllers;

use App\Models\StorageFile;
use App\Services\AuditService;
use App\Services\StorageCleanupService;
use App\Services\StorageThumbnailService;
use App\Services\StorageUsageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

class StorageFileController extends Controller
{
    public function __construct(
        private readonly AuditService $auditService,
        private readonly StorageUsageService $storage,
        private readonly StorageCleanupService $cleanup,
    ) {
    }

    public function index()
    {
        return Inertia::render('StoragePanel');
    }

    public function summary(): JsonResponse
    {
        $scan = $this->storage->scan();

        return response()->json([
            'ok' => true,
            'scan' => $scan,
            'summary' => $this->storage->summary(),
        ]);
    }

    public function files(Request $request): JsonResponse
    {
        $data = $request->validate([
            'category' => ['nullable', Rule::in(array_keys(StorageUsageService::CATEGORIES))],
            'status' => ['nullable', Rule::in(['active', 'trashed', 'all'])],
            'q' => ['nullable', 'string', 'max:120'],
            'sort' => ['nullable', Rule::in(['size', 'recent'])],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:10', 'max:100'],
            'chat_id' => ['nullable', 'integer', 'min:1'],
            'modified_from' => ['nullable', 'date_format:Y-m-d'],
            'modified_to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:modified_from'],
        ]);

        $result = $this->storage->files(
            (string) ($data['category'] ?? ''),
            (string) ($data['status'] ?? 'active'),
            trim((string) ($data['q'] ?? '')),
            (string) ($data['sort'] ?? 'size'),
            (int) ($data['page'] ?? 1),
            (int) ($data['per_page'] ?? 25),
            isset($data['chat_id']) ? (int) $data['chat_id'] : null,
            $data['modified_from'] ?? null,
            $data['modified_to'] ?? null,
        );

        return response()->json(['ok' => true] + $result);
    }

    public function trashableIds(Request $request): JsonResponse
    {
        $data = $request->validate([
            'category' => ['nullable', Rule::in(array_keys(StorageUsageService::CATEGORIES))],
            'q' => ['nullable', 'string', 'max:120'],
            'chat_id' => ['nullable', 'integer', 'min:1'],
            'modified_from' => ['nullable', 'date_format:Y-m-d'],
            'modified_to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:modified_from'],
        ]);

        $result = $this->cleanup->trashableIds(
            (string) ($data['category'] ?? ''),
            trim((string) ($data['q'] ?? '')),
            isset($data['chat_id']) ? (int) $data['chat_id'] : null,
            $data['modified_from'] ?? null,
            $data['modified_to'] ?? null,
        );

        return response()->json(['ok' => true] + $result);
    }

    public function trashBatch(Request $request): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:'.StorageCleanupService::MAX_BATCH],
            'ids.*' => ['integer', 'min:1'],
        ]);

        $ids = array_values(array_unique(array_map('intval', $data['ids'])));
        $result = $this->cleanup->trashMany($ids, $request->user());

        return response()->json(['ok' => true] + $result);
    }

    public function duplicates(): JsonResponse
    {
        return response()->json(['ok' => true] + $this->cleanup->duplicates());
    }

    public function retention(): JsonResponse
    {
        return response()->json(['ok' => true, 'settings' => $this->cleanup->retentionSettings()]);
    }

    public function updateRetention(Request $request): JsonResponse
    {
        $data = $request->validate([
            'bot_media_unused_days' => ['nullable', 'integer', 'min:1', 'max:3650'],
            'trash_purge_days' => ['nullable', 'integer', 'min:1', 'max:3650'],
        ]);

        $settings = $this->cleanup->saveRetentionSettings(
            isset($data['bot_media_unused_days']) ? (int) $data['bot_media_unused_days'] : null,
            isset($data['trash_purge_days']) ? (int) $data['trash_purge_days'] : null,
            $request->user(),
        );

        return response()->json(['ok' => true, 'settings' => $settings]);
    }

    public function thumbnail(int $id, StorageThumbnailService $thumbnails): Response
    {
        $file = StorageFile::withTrashed()->findOrFail($id);
        $path = $thumbnails->thumbnailPath($file);

        if ($path === null) {
            abort(404);
        }

        return response()->file($path, [
            'Content-Type' => 'image/jpeg',
            'Cache-Control' => 'private, max-age=86400',
        ]);
    }

    public function chats(Request $request): JsonResponse
    {
        $data = $request->validate([
            'inactive_months' => ['nullable', Rule::in([0, 3, 6, 12, 24])],
            'sort' => ['nullable', Rule::in(['size', 'oldest'])],
            'q' => ['nullable', 'string', 'max:120'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:10', 'max:100'],
        ]);

        $result = $this->storage->chats(
            (int) ($data['inactive_months'] ?? 0),
            (string) ($data['sort'] ?? 'size'),
            (int) ($data['page'] ?? 1),
            (int) ($data['per_page'] ?? 25),
            trim((string) ($data['q'] ?? '')),
        );

        return response()->json(['ok' => true] + $result);
    }

    public function destroy(Request $request, StorageFile $storageFile): JsonResponse
    {
        if (! $this->storage->isActionable($storageFile->category)) {
            return response()->json([
                'ok' => false,
                'message' => 'Este tipo de archivo no se puede enviar a papelera desde este módulo.',
            ], 422);
        }

        // Mismo criterio que el lote: los mensajes que lo usan quedan con aviso; los nodos del bot bloquean.
        $result = $this->cleanup->trashMany([$storageFile->id], $request->user());

        if ($result['trashed'] === 0) {
            $reason = $result['skipped'][0]['reason'] ?? 'No se pudo enviar a papelera.';

            return response()->json(['ok' => false, 'message' => $reason], 409);
        }

        $storageFile->refresh();

        return response()->json([
            'ok' => true,
            'file' => $this->storage->describe($storageFile->fresh() ?? $storageFile),
        ]);
    }

    public function restore(Request $request, int $id): JsonResponse
    {
        $storageFile = StorageFile::onlyTrashed()->findOrFail($id);
        $storageFile->restore();

        $this->auditService->record(
            'storage',
            'restored',
            "Restauro el archivo {$storageFile->path}",
            $request->user(),
            $storageFile,
            ['before' => $this->snapshot($storageFile)],
        );

        // Si el archivo estaba desvinculado de algún chat, los mensajes vuelven a mostrarlo.
        $relinked = $this->cleanup->relinkFor($storageFile, $request->user());

        return response()->json([
            'ok' => true,
            'relinked' => $relinked,
            'file' => $this->storage->describe($storageFile->fresh()),
        ]);
    }

    public function emptyTrash(Request $request): JsonResponse
    {
        $request->validate([
            'confirmed' => ['required', 'accepted'],
        ], [
            'confirmed.accepted' => 'Confirmá antes de vaciar la papelera.',
        ]);

        return response()->json(['ok' => true] + $this->cleanup->emptyTrash($request->user()));
    }

    public function forceDestroy(Request $request, int $id): JsonResponse
    {
        $request->validate([
            'confirmed' => ['required', 'accepted'],
        ], [
            'confirmed.accepted' => 'Confirmá el borrado permanente para continuar.',
        ]);

        $storageFile = StorageFile::onlyTrashed()->findOrFail($id);

        if (! $this->storage->isActionable($storageFile->category)) {
            return response()->json([
                'ok' => false,
                'message' => 'Este tipo de archivo no se puede borrar desde este módulo.',
            ], 422);
        }

        $refs = $this->storage->referencesFor($storageFile->path);
        if ($refs['total'] > 0) {
            return $this->inUseResponse($refs);
        }

        $snapshot = $this->snapshot($storageFile);
        $disk = Storage::disk(StorageUsageService::DISK);

        if ($disk->exists($storageFile->path) && ! $disk->delete($storageFile->path)) {
            return response()->json([
                'ok' => false,
                'message' => 'No se pudo borrar el archivo del disco. No se modificó el registro.',
            ], 500);
        }

        $this->auditService->record(
            'storage',
            'force_deleted',
            "Elimino definitivamente el archivo {$storageFile->path}",
            $request->user(),
            $storageFile,
            ['before' => $snapshot, 'references' => $refs],
        );

        $storageFile->forceDelete();

        return response()->json(['ok' => true, 'deleted_id' => $id]);
    }

    /**
     * @param  array{messages: int, bot_nodes: int, total: int}  $refs
     */
    private function inUseResponse(array $refs): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'message' => 'El archivo está en uso y no se puede modificar. Se bloquea para no romper el historial ni los flujos.',
            'references' => $refs,
        ], 409);
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(StorageFile $file): array
    {
        return [
            'path' => $file->path,
            'category' => $file->category,
            'size_bytes' => (int) $file->size_bytes,
            'mime' => $file->mime,
        ];
    }
}
