<?php

namespace App\Http\Controllers;

use App\Models\StorageFile;
use App\Services\AuditService;
use App\Services\StorageUsageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Inertia\Inertia;

class StorageFileController extends Controller
{
    public function __construct(
        private readonly AuditService $auditService,
        private readonly StorageUsageService $storage,
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
        ]);

        $result = $this->storage->files(
            (string) ($data['category'] ?? ''),
            (string) ($data['status'] ?? 'active'),
            trim((string) ($data['q'] ?? '')),
            (string) ($data['sort'] ?? 'size'),
            (int) ($data['page'] ?? 1),
            (int) ($data['per_page'] ?? 25),
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

        $refs = $this->storage->referencesFor($storageFile->path);
        if ($refs['total'] > 0) {
            return $this->inUseResponse($refs);
        }

        $snapshot = $this->snapshot($storageFile);
        $storageFile->delete();

        $this->auditService->record(
            'storage',
            'trashed',
            "Envio a papelera el archivo {$storageFile->path}",
            $request->user(),
            $storageFile,
            ['before' => $snapshot, 'references' => $refs],
        );

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

        return response()->json([
            'ok' => true,
            'file' => $this->storage->describe($storageFile->fresh()),
        ]);
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
