<?php

namespace App\Services;

use App\Models\StorageFile;
use App\Models\SystemSetting;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Acciones de limpieza: envío a papelera en lote, duplicados por contenido y
 * reglas automáticas.
 *
 * Regla de uso:
 * - Un archivo usado en un mensaje sí se puede mandar a papelera: el mensaje conserva
 *   su texto y queda con aviso de "archivo no disponible". Restaurar el archivo desde
 *   papelera vuelve a enlazar esos mensajes.
 * - Un archivo usado por un nodo del bot no se puede mandar a papelera.
 * - Las reglas automáticas nunca desvinculan mensajes: solo tocan archivos sin uso.
 */
class StorageCleanupService
{
    public const MAX_BATCH = 500;
    public const MAX_SELECTABLE = 2000;
    public const SETTING_BOT_UNUSED_DAYS = 'storage.bot_media_unused_days';
    public const SETTING_TRASH_PURGE_DAYS = 'storage.trash_purge_days';

    public function __construct(
        private readonly StorageUsageService $storage,
        private readonly AuditService $auditService,
    ) {
    }

    /**
     * Motivo por el que el archivo no se puede enviar a papelera, o null si se puede.
     *
     * @param  array<string, array<string, int>>  $index
     */
    public function trashBlockReason(StorageFile $file, array $index): ?string
    {
        if ($file->trashed()) {
            return 'Ya está en papelera.';
        }

        if (! $this->storage->isActionable($file->category)) {
            return 'Este tipo de archivo no se gestiona desde este módulo.';
        }

        if ($this->storage->referencesFor($file->path, $index)['bot_nodes'] > 0) {
            return 'Lo usa un nodo del bot.';
        }

        return null;
    }

    /**
     * @param  array<int, int>  $ids
     * @return array{trashed: int, skipped: array<int, array{id: int, path: string|null, reason: string}>}
     */
    public function trashMany(array $ids, ?User $actor): array
    {
        $index = $this->storage->referenceIndex();
        $files = StorageFile::withTrashed()->whereIn('id', $ids)->get()->keyBy('id');

        $trashed = 0;
        $skipped = [];
        $messagesByPath = null;

        foreach ($ids as $id) {
            $file = $files->get($id);

            if ($file === null) {
                $skipped[] = ['id' => $id, 'path' => null, 'reason' => 'No existe.'];
                continue;
            }

            $reason = $this->trashBlockReason($file, $index);
            if ($reason !== null) {
                $skipped[] = ['id' => $id, 'path' => $file->path, 'reason' => $reason];
                continue;
            }

            // Los mensajes solo se buscan si el archivo está enlazado a alguno.
            $linked = [];
            if ($this->storage->referencesFor($file->path, $index)['messages'] > 0) {
                $messagesByPath ??= $this->messageRowsByPath();
                $linked = $messagesByPath[$file->path] ?? [];
            }

            $snapshot = $this->snapshot($file);

            DB::transaction(function () use ($file, $linked) {
                $this->unlinkMessages($linked);
                $file->delete();
            });

            $this->auditService->record(
                'storage',
                'trashed',
                "Envio a papelera el archivo {$file->path}",
                $actor,
                $file,
                ['before' => $snapshot, 'batch' => true, 'unlinked_messages' => count($linked)],
            );

            $trashed++;
        }

        return ['trashed' => $trashed, 'skipped' => $skipped];
    }

    /**
     * Ids de los archivos de la lista que sí se pueden enviar a papelera.
     *
     * @return array{ids: array<int, int>, total: int, bytes: int, truncated: bool}
     */
    public function trashableIds(
        string $category,
        string $search,
        ?int $chatId,
        ?string $from,
        ?string $to,
    ): array {
        $index = $this->storage->referenceIndex();
        $ids = [];
        $bytes = 0;

        $this->storage->filteredQuery($category, 'active', $search, $chatId, $from, $to)
            ->orderByDesc('size_bytes')
            ->get(['id', 'path', 'category', 'size_bytes', 'deleted_at'])
            ->each(function (StorageFile $file) use (&$ids, &$bytes, $index) {
                if ($this->trashBlockReason($file, $index) !== null) {
                    return;
                }

                $ids[] = (int) $file->id;
                $bytes += (int) $file->size_bytes;
            });

        return [
            'ids' => array_slice($ids, 0, self::MAX_SELECTABLE),
            'total' => count($ids),
            'bytes' => $bytes,
            'truncated' => count($ids) > self::MAX_SELECTABLE,
        ];
    }

    /**
     * Grupos de archivos con el mismo contenido. Los hashes se calculan solo para
     * archivos que comparten tamaño con otro, y se guardan hasta que cambie el archivo.
     *
     * En cada grupo se marca qué copias conservar: todas las que están en uso, o si
     * ninguna lo está, la más antigua. El resto se puede mandar a papelera.
     *
     * @return array{groups: array<int, array<string, mixed>>, total_groups: int, wasted_bytes: int}
     */
    public function duplicates(int $limit = 200): array
    {
        $sizes = StorageFile::query()
            ->where('size_bytes', '>', 0)
            ->groupBy('size_bytes')
            ->havingRaw('COUNT(*) > 1')
            ->pluck('size_bytes')
            ->all();

        if ($sizes === []) {
            return ['groups' => [], 'total_groups' => 0, 'wasted_bytes' => 0];
        }

        $disk = Storage::disk(StorageUsageService::DISK);
        $byHash = [];

        foreach (array_chunk($sizes, 500) as $chunk) {
            StorageFile::query()
                ->whereIn('size_bytes', $chunk)
                ->get()
                ->each(function (StorageFile $file) use ($disk, &$byHash) {
                    $hash = $this->hashFor($file, $disk);

                    if ($hash !== null) {
                        $byHash[$hash][] = $file;
                    }
                });
        }

        $index = $this->storage->referenceIndex();
        $groups = [];

        foreach ($byHash as $hash => $members) {
            if (count($members) < 2) {
                continue;
            }

            $keepIds = $this->keepIds($members, $index);
            $size = (int) $members[0]->size_bytes;

            $groups[] = [
                'hash' => $hash,
                'size_bytes' => $size,
                'copies' => count($members),
                'wasted_bytes' => (count($members) - 1) * $size,
                'files' => array_map(
                    fn (StorageFile $file) => $this->storage->describe($file, $index) + [
                        'keep' => in_array($file->id, $keepIds, true),
                    ],
                    $members,
                ),
            ];
        }

        usort($groups, fn (array $a, array $b) => $b['wasted_bytes'] <=> $a['wasted_bytes']);

        return [
            'groups' => array_slice($groups, 0, $limit),
            'total_groups' => count($groups),
            'wasted_bytes' => array_sum(array_column($groups, 'wasted_bytes')),
        ];
    }

    /**
     * Vuelve a enlazar los mensajes desvinculados cuyo adjunto se restauró desde papelera.
     */
    public function relinkFor(StorageFile $file, ?User $actor): int
    {
        $relinked = 0;

        DB::table('messages')
            ->whereNotNull('media_removed_at')
            ->where('media_removed_url', 'like', '%'.basename($file->path).'%')
            ->get(['id', 'media_removed_url'])
            ->each(function ($row) use ($file, &$relinked) {
                if (! in_array($file->path, $this->storage->pathsFromMediaUrl((string) $row->media_removed_url), true)) {
                    return;
                }

                DB::table('messages')->where('id', $row->id)->update([
                    'media_url' => $row->media_removed_url,
                    'media_removed_url' => null,
                    'media_removed_at' => null,
                ]);

                $relinked++;
            });

        if ($relinked > 0) {
            $this->auditService->record(
                'storage',
                'relinked',
                "Restauró el archivo {$file->path} y volvió a enlazar {$relinked} mensaje(s)",
                $actor,
                $file,
                ['messages' => $relinked],
            );
        }

        return $relinked;
    }

    /**
     * Borra definitivamente todo lo que está en papelera y no tiene referencias.
     * Lo que sigue en uso (por ejemplo, un nodo del bot que volvió a usarlo) se omite.
     *
     * @return array{deleted: int, skipped: int, bytes: int}
     */
    public function emptyTrash(?User $actor): array
    {
        $index = $this->storage->referenceIndex();
        $disk = Storage::disk(StorageUsageService::DISK);
        $deleted = 0;
        $skipped = 0;
        $bytes = 0;

        StorageFile::onlyTrashed()
            ->get()
            ->each(function (StorageFile $file) use ($index, $disk, $actor, &$deleted, &$skipped, &$bytes) {
                if (! $this->storage->isActionable($file->category)
                    || $this->storage->referencesFor($file->path, $index)['total'] > 0) {
                    $skipped++;

                    return;
                }

                $snapshot = $this->snapshot($file);

                if ($disk->exists($file->path) && ! $disk->delete($file->path)) {
                    $skipped++;

                    return;
                }

                $this->auditService->record(
                    'storage',
                    'force_deleted',
                    "Vació la papelera: borrado definitivo de {$file->path}",
                    $actor,
                    $file,
                    ['before' => $snapshot, 'batch' => 'empty_trash'],
                );

                $bytes += (int) $file->size_bytes;
                $file->forceDelete();
                $deleted++;
            });

        return ['deleted' => $deleted, 'skipped' => $skipped, 'bytes' => $bytes];
    }

    /**
     * @return array{bot_media_unused_days: int|null, trash_purge_days: int|null}
     */
    public function retentionSettings(): array
    {
        return [
            'bot_media_unused_days' => $this->settingDays(self::SETTING_BOT_UNUSED_DAYS),
            'trash_purge_days' => $this->settingDays(self::SETTING_TRASH_PURGE_DAYS),
        ];
    }

    public function saveRetentionSettings(?int $botUnusedDays, ?int $trashPurgeDays, ?User $actor): array
    {
        $before = $this->retentionSettings();

        $this->storeSetting(self::SETTING_BOT_UNUSED_DAYS, $botUnusedDays);
        $this->storeSetting(self::SETTING_TRASH_PURGE_DAYS, $trashPurgeDays);

        $after = $this->retentionSettings();

        if ($before !== $after) {
            $this->auditService->record(
                'storage',
                'retention_updated',
                'Actualizo las reglas automáticas de almacenamiento',
                $actor,
                null,
                ['before' => $before, 'after' => $after],
            );
        }

        return $after;
    }

    /**
     * Aplica las reglas automáticas. Lo llama el comando diario storage:apply-retention.
     *
     * - Medios del bot sin uso: se mandan a papelera si su archivo tiene más de N días
     *   y no lo usa ningún mensaje ni nodo. Los adjuntos de chats no entran en esta regla.
     * - Papelera: se borra definitivamente lo que lleva más de M días en papelera y
     *   sigue sin uso.
     *
     * @return array{trashed: int, purged: int}
     */
    public function applyRetention(): array
    {
        $settings = $this->retentionSettings();
        $index = $this->storage->referenceIndex();
        $trashed = 0;
        $purged = 0;

        if ($settings['bot_media_unused_days'] !== null) {
            $cutoff = now()->subDays($settings['bot_media_unused_days']);

            StorageFile::query()
                ->where('category', StorageUsageService::CATEGORY_BOT)
                ->where('modified_at', '<', $cutoff)
                ->get()
                ->each(function (StorageFile $file) use ($index, &$trashed, $settings) {
                    // La regla automática no desvincula mensajes: solo toca lo que nadie usa.
                    if ($this->trashBlockReason($file, $index) !== null
                        || $this->storage->referencesFor($file->path, $index)['total'] > 0) {
                        return;
                    }

                    $snapshot = $this->snapshot($file);
                    $file->delete();

                    $this->auditService->record(
                        'storage',
                        'auto_trashed',
                        "Regla automática: medio del bot sin uso enviado a papelera {$file->path}",
                        null,
                        $file,
                        ['before' => $snapshot, 'rule_days' => $settings['bot_media_unused_days']],
                    );

                    $trashed++;
                });
        }

        if ($settings['trash_purge_days'] !== null) {
            $cutoff = now()->subDays($settings['trash_purge_days']);
            $disk = Storage::disk(StorageUsageService::DISK);

            StorageFile::onlyTrashed()
                ->where('deleted_at', '<', $cutoff)
                ->get()
                ->each(function (StorageFile $file) use ($index, $disk, &$purged, $settings) {
                    if (! $this->storage->isActionable($file->category)) {
                        return;
                    }

                    if ($this->storage->referencesFor($file->path, $index)['total'] > 0) {
                        return;
                    }

                    $snapshot = $this->snapshot($file);

                    if ($disk->exists($file->path) && ! $disk->delete($file->path)) {
                        return;
                    }

                    $this->auditService->record(
                        'storage',
                        'auto_purged',
                        "Regla automática: borrado definitivo de {$file->path}",
                        null,
                        $file,
                        ['before' => $snapshot, 'rule_days' => $settings['trash_purge_days']],
                    );

                    $file->forceDelete();
                    $purged++;
                });
        }

        return ['trashed' => $trashed, 'purged' => $purged];
    }

    /**
     * Mensajes con adjunto agrupados por la ruta registrada que apuntan.
     *
     * @return array<string, array<int, object>>
     */
    private function messageRowsByPath(): array
    {
        $registry = StorageFile::withTrashed()->pluck('path')->flip()->all();
        $byPath = [];

        DB::table('messages')
            ->whereNotNull('media_url')
            ->where('media_url', 'like', '%/storage/%')
            ->get(['id', 'media_url'])
            ->each(function ($row) use ($registry, &$byPath) {
                foreach ($this->storage->pathsFromMediaUrl((string) $row->media_url) as $candidate) {
                    if (isset($registry[$candidate])) {
                        $byPath[$candidate][] = $row;

                        return;
                    }
                }
            });

        return $byPath;
    }

    /**
     * Desvincula mensajes: conservan su texto, guardan la ruta original y quedan con aviso.
     *
     * @param  array<int, object>  $rows
     */
    private function unlinkMessages(array $rows): void
    {
        foreach ($rows as $row) {
            DB::table('messages')->where('id', $row->id)->update([
                'media_removed_url' => $row->media_url,
                'media_url' => null,
                'media_removed_at' => now(),
            ]);
        }
    }

    /**
     * @param  array<int, StorageFile>  $members
     * @param  array<string, array<string, int>>  $index
     * @return array<int, int>
     */
    private function keepIds(array $members, array $index): array
    {
        $inUse = array_values(array_filter(
            $members,
            fn (StorageFile $file) => $this->storage->referencesFor($file->path, $index)['total'] > 0,
        ));

        if ($inUse !== []) {
            return array_map(fn (StorageFile $file) => (int) $file->id, $inUse);
        }

        $oldest = $members[0];
        foreach ($members as $file) {
            if ($file->modified_at && (! $oldest->modified_at || $file->modified_at->lt($oldest->modified_at))) {
                $oldest = $file;
            }
        }

        return [(int) $oldest->id];
    }

    private function hashFor(StorageFile $file, $disk): ?string
    {
        $modified = optional($file->modified_at)->toDateTimeString();

        if ($file->content_hash !== null && optional($file->hashed_modified_at)->toDateTimeString() === $modified) {
            return $file->content_hash;
        }

        if (! $disk->exists($file->path)) {
            return null;
        }

        $hash = hash_file('sha256', $disk->path($file->path));

        if ($hash === false) {
            return null;
        }

        $file->forceFill([
            'content_hash' => $hash,
            'hashed_modified_at' => $file->modified_at,
        ])->save();

        return $hash;
    }

    private function settingDays(string $key): ?int
    {
        $value = SystemSetting::query()->where('key', $key)->value('value');

        if ($value === null || trim((string) $value) === '') {
            return null;
        }

        $days = (int) $value;

        return $days > 0 ? $days : null;
    }

    private function storeSetting(string $key, ?int $days): void
    {
        SystemSetting::query()->updateOrCreate(
            ['key' => $key],
            ['value' => $days === null ? '' : (string) $days],
        );
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
