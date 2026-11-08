<?php

namespace App\Services;

use App\Models\BotNode;
use App\Models\StorageFile;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Mime\MimeTypes;

/**
 * Inventario de archivos del disco public y cálculo de referencias.
 *
 * Reglas de referencia:
 * - Un archivo está "en uso" si lo apunta messages.media_url o un nodo del bot
 *   (bot_nodes.settings, incluidos los nodos en papelera porque se pueden restaurar).
 * - Un archivo en uso no se puede enviar a papelera ni borrar de forma permanente,
 *   así el historial del chat y los flujos no se rompen.
 * - Solo las categorías "actionable" (adjuntos de chats y medios del bot) admiten acciones.
 */
class StorageUsageService
{
    public const DISK = 'public';

    public const CATEGORY_CHAT = 'chat_attachments';
    public const CATEGORY_BOT = 'bot_media';
    public const CATEGORY_BRANDING = 'branding';
    public const CATEGORY_OTHER = 'other';

    public const CATEGORIES = [
        self::CATEGORY_CHAT => ['label' => 'Adjuntos de chats', 'actionable' => true],
        self::CATEGORY_BOT => ['label' => 'Medios de flujos del bot', 'actionable' => true],
        self::CATEGORY_BRANDING => ['label' => 'Branding e imágenes del sistema', 'actionable' => false],
        self::CATEGORY_OTHER => ['label' => 'Otros archivos', 'actionable' => false],
    ];

    private const CHUNK_SIZE = 500;
    private const MAX_PATH_LENGTH = 512;

    public function categorize(string $path): string
    {
        if (str_starts_with($path, 'bot-media/')) {
            return self::CATEGORY_BOT;
        }

        if (preg_match('#^(whatsapp|webchat)/\d+/#', $path) === 1) {
            return self::CATEGORY_CHAT;
        }

        if (str_starts_with($path, 'webchat/logos/') || str_starts_with($path, 'images/')) {
            return self::CATEGORY_BRANDING;
        }

        return self::CATEGORY_OTHER;
    }

    public function isActionable(string $category): bool
    {
        return (bool) (self::CATEGORIES[$category]['actionable'] ?? false);
    }

    public function urlForPath(string $path): string
    {
        return '/storage/'.implode('/', array_map('rawurlencode', explode('/', $path)));
    }

    /**
     * Sincroniza el registro con el disco: agrega archivos nuevos, actualiza
     * tamaño y fecha, y quita registros cuyo archivo ya no existe. No toca
     * deleted_at, así que los archivos en papelera siguen en papelera.
     *
     * @return array{files: int, removed: int}
     */
    public function scan(): array
    {
        $disk = Storage::disk(self::DISK);
        $now = now();
        $seen = [];
        $rows = [];

        foreach ($disk->allFiles() as $path) {
            if (str_starts_with(basename($path), '.') || strlen($path) > self::MAX_PATH_LENGTH) {
                continue;
            }

            $seen[$path] = true;
            $rows[] = [
                'path' => $path,
                'category' => $this->categorize($path),
                'size_bytes' => (int) $disk->size($path),
                'mime' => $this->mimeFor($path),
                'modified_at' => Carbon::createFromTimestamp((int) $disk->lastModified($path)),
                'created_at' => $now,
                'updated_at' => $now,
            ];

            if (count($rows) >= self::CHUNK_SIZE) {
                $this->upsertRows($rows);
                $rows = [];
            }
        }

        if ($rows !== []) {
            $this->upsertRows($rows);
        }

        $gone = [];
        StorageFile::withTrashed()
            ->select(['id', 'path'])
            ->chunkById(self::CHUNK_SIZE, function ($files) use ($seen, &$gone) {
                foreach ($files as $file) {
                    if (! isset($seen[$file->path])) {
                        $gone[] = $file->id;
                    }
                }
            });

        foreach (array_chunk($gone, self::CHUNK_SIZE) as $ids) {
            StorageFile::withTrashed()->whereIn('id', $ids)->forceDelete();
        }

        return ['files' => count($seen), 'removed' => count($gone)];
    }

    /**
     * @return array<string, mixed>
     */
    public function summary(): array
    {
        $active = StorageFile::query()
            ->selectRaw('category, COUNT(*) as files, COALESCE(SUM(size_bytes), 0) as bytes')
            ->groupBy('category')
            ->get()
            ->keyBy('category');

        $trashed = StorageFile::onlyTrashed()
            ->selectRaw('category, COUNT(*) as files, COALESCE(SUM(size_bytes), 0) as bytes')
            ->groupBy('category')
            ->get()
            ->keyBy('category');

        $categories = [];
        $totals = [
            'active' => ['files' => 0, 'bytes' => 0],
            'trashed' => ['files' => 0, 'bytes' => 0],
        ];

        foreach (self::CATEGORIES as $key => $meta) {
            $a = $active->get($key);
            $t = $trashed->get($key);

            $entry = [
                'key' => $key,
                'label' => $meta['label'],
                'actionable' => $meta['actionable'],
                'active' => ['files' => (int) ($a->files ?? 0), 'bytes' => (int) ($a->bytes ?? 0)],
                'trashed' => ['files' => (int) ($t->files ?? 0), 'bytes' => (int) ($t->bytes ?? 0)],
            ];

            $totals['active']['files'] += $entry['active']['files'];
            $totals['active']['bytes'] += $entry['active']['bytes'];
            $totals['trashed']['files'] += $entry['trashed']['files'];
            $totals['trashed']['bytes'] += $entry['trashed']['bytes'];

            $categories[] = $entry;
        }

        $freeBytes = @disk_free_space(Storage::disk(self::DISK)->path(''));

        return [
            'categories' => $categories,
            'totals' => [
                'files' => $totals['active']['files'] + $totals['trashed']['files'],
                'bytes' => $totals['active']['bytes'] + $totals['trashed']['bytes'],
                'active' => $totals['active'],
                'trashed' => $totals['trashed'],
            ],
            'disk' => [
                'free_bytes' => $freeBytes === false ? null : (int) $freeBytes,
            ],
            'scanned_at' => now()->toIso8601String(),
        ];
    }

    /**
     * @return array{items: array<int, array<string, mixed>>, meta: array<string, int>}
     */
    public function files(
        string $category,
        string $status,
        string $search,
        string $sort,
        int $page,
        int $perPage,
        ?int $chatId = null,
        ?string $from = null,
        ?string $to = null,
    ): array {
        $query = $this->filteredQuery($category, $status, $search, $chatId, $from, $to);

        $query = $sort === 'recent'
            ? $query->orderByDesc('modified_at')->orderByDesc('id')
            : $query->orderByDesc('size_bytes')->orderByDesc('id');

        $paginator = $query->paginate($perPage, ['*'], 'page', $page);
        $index = $this->referenceIndex();

        return [
            'items' => collect($paginator->items())
                ->map(fn (StorageFile $file) => $this->describe($file, $index))
                ->values()
                ->all(),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ];
    }

    /**
     * Filtros compartidos por la lista, la selección en lote y los duplicados.
     * $from y $to son fechas Y-m-d sobre modified_at (ambas inclusive).
     */
    public function filteredQuery(
        string $category,
        string $status,
        string $search,
        ?int $chatId = null,
        ?string $from = null,
        ?string $to = null,
    ): Builder {
        $query = match ($status) {
            'trashed' => StorageFile::onlyTrashed(),
            'all' => StorageFile::withTrashed(),
            default => StorageFile::query(),
        };

        if ($category !== '') {
            $query->where('category', $category);
        }

        if ($search !== '') {
            $query->where('path', 'like', '%'.$search.'%');
        }

        if ($chatId !== null) {
            $query->where(function ($nested) use ($chatId) {
                $nested
                    ->where('path', 'like', "whatsapp/{$chatId}/%")
                    ->orWhere('path', 'like', "webchat/{$chatId}/%");
            });
        }

        if ($from !== null && $from !== '') {
            $query->where('modified_at', '>=', $from.' 00:00:00');
        }

        if ($to !== null && $to !== '') {
            $query->where('modified_at', '<=', $to.' 23:59:59');
        }

        return $query;
    }

    /**
     * Archivos de chats agrupados por chat. La carpeta whatsapp/{id} o webchat/{id}
     * es el id del chat, así que no hace falta parsear nada más.
     *
     * La antigüedad es la del último mensaje del chat (no la del archivo), porque
     * es la que importa para la guarda de la historia clínica.
     *
     * @return array{items: array<int, array<string, mixed>>, meta: array<string, int>}
     */
    public function chats(int $inactiveMonths, string $sort, int $page, int $perPage, string $search = ''): array
    {
        $groups = [];

        StorageFile::query()
            ->where('category', self::CATEGORY_CHAT)
            ->get(['path', 'size_bytes'])
            ->each(function (StorageFile $file) use (&$groups) {
                if (preg_match('#^(whatsapp|webchat)/(\d+)/#', $file->path, $matches) !== 1) {
                    return;
                }

                $id = (int) $matches[2];
                $groups[$id] ??= ['channel' => $matches[1], 'files' => 0, 'bytes' => 0];
                $groups[$id]['files']++;
                $groups[$id]['bytes'] += (int) $file->size_bytes;
            });

        $chats = [];
        $lastActivity = [];

        foreach (array_chunk(array_keys($groups), self::CHUNK_SIZE) as $chunk) {
            DB::table('chats as c')
                ->leftJoin('contacts as k', 'k.id', '=', 'c.contact_id')
                ->whereIn('c.id', $chunk)
                ->get(['c.id', 'c.channel', 'c.title', 'k.name', 'k.whatsapp_id'])
                ->each(function ($row) use (&$chats) {
                    $chats[(int) $row->id] = $row;
                });

            DB::table('messages')
                ->whereIn('chat_id', $chunk)
                ->groupBy('chat_id')
                ->selectRaw('chat_id, MAX(created_at) as last_at')
                ->get()
                ->each(function ($row) use (&$lastActivity) {
                    $lastActivity[(int) $row->chat_id] = $row->last_at;
                });
        }

        $threshold = $inactiveMonths > 0 ? now()->subMonths($inactiveMonths) : null;
        $rows = [];

        foreach ($groups as $id => $group) {
            $chat = $chats[$id] ?? null;
            $last = isset($lastActivity[$id]) ? Carbon::parse($lastActivity[$id]) : null;

            // Con filtro de inactividad, se dejan afuera los chats con actividad reciente.
            if ($threshold !== null && $last !== null && $last->greaterThanOrEqualTo($threshold)) {
                continue;
            }

            if ($search !== '' && ! $this->chatMatches($id, $chat, $search)) {
                continue;
            }

            $rows[] = [
                'chat_id' => $id,
                'label' => $this->chatLabel($id, $chat),
                'channel' => $chat->channel ?? $group['channel'],
                'files' => $group['files'],
                'bytes' => $group['bytes'],
                'last_message_at' => $last?->toIso8601String(),
                'months_inactive' => $last !== null ? (int) $last->diffInMonths(now()) : null,
                'exists' => $chat !== null,
            ];
        }

        usort($rows, $sort === 'oldest'
            ? fn (array $a, array $b) => ($a['last_message_at'] ?? '0') <=> ($b['last_message_at'] ?? '0')
            : fn (array $a, array $b) => $b['bytes'] <=> $a['bytes']);

        $total = count($rows);

        return [
            'items' => array_values(array_slice($rows, ($page - 1) * $perPage, $perPage)),
            'meta' => [
                'current_page' => $page,
                'last_page' => max(1, (int) ceil($total / $perPage)),
                'per_page' => $perPage,
                'total' => $total,
            ],
        ];
    }

    // Busca en el id, el nombre del contacto, el teléfono y el título del chat.
    private function chatMatches(int $id, ?object $chat, string $search): bool
    {
        $needle = mb_strtolower($search);
        $fields = [
            (string) $id,
            (string) ($chat->name ?? ''),
            (string) ($chat->whatsapp_id ?? ''),
            (string) ($chat->title ?? ''),
        ];

        foreach ($fields as $field) {
            if ($field !== '' && str_contains(mb_strtolower($field), $needle)) {
                return true;
            }
        }

        return false;
    }

    private function chatLabel(int $id, ?object $chat): string
    {
        if ($chat === null) {
            return "Chat eliminado #{$id}";
        }

        foreach ([$chat->name ?? null, $chat->whatsapp_id ?? null, $chat->title ?? null] as $candidate) {
            $value = trim((string) $candidate);

            if ($value !== '') {
                return $value;
            }
        }

        return "Chat #{$id}";
    }

    /**
     * Describe un archivo para la UI, con sus referencias y las acciones permitidas.
     *
     * @param  array<string, array<string, int>>|null  $index
     * @return array<string, mixed>
     */
    public function describe(StorageFile $file, ?array $index = null): array
    {
        $refs = $this->referencesFor($file->path, $index);
        $actionable = $this->isActionable($file->category);
        $inUse = $refs['total'] > 0;
        $trashed = $file->trashed();

        return [
            'id' => $file->id,
            'path' => $file->path,
            'name' => basename($file->path),
            'category' => $file->category,
            'category_label' => self::CATEGORIES[$file->category]['label'] ?? $file->category,
            'actionable' => $actionable,
            'size_bytes' => (int) $file->size_bytes,
            'mime' => $file->mime,
            'modified_at' => optional($file->modified_at)->toIso8601String(),
            'url' => $this->urlForPath($file->path),
            'trashed' => $trashed,
            'deleted_at' => optional($file->deleted_at)->toIso8601String(),
            'references' => $refs,
            'in_use' => $inUse,
            'can_trash' => ! $trashed && $actionable && $refs['bot_nodes'] === 0,
            'can_restore' => $trashed,
            'can_force_delete' => $trashed && $actionable && ! $inUse,
            'blocked_reason' => $this->blockedReason($actionable, $refs),
        ];
    }

    /**
     * @param  array<string, array<string, int>>|null  $index
     * @return array{messages: int, bot_nodes: int, total: int}
     */
    public function referencesFor(string $path, ?array $index = null): array
    {
        $index ??= $this->referenceIndex();
        $entry = $index[$path] ?? [];

        $messages = (int) ($entry['messages'] ?? 0);
        $botNodes = (int) ($entry['bot_nodes'] ?? 0);

        return [
            'messages' => $messages,
            'bot_nodes' => $botNodes,
            'total' => $messages + $botNodes,
        ];
    }

    /**
     * Mapa ruta => cantidad de mensajes y nodos del bot que la apuntan.
     *
     * @return array<string, array<string, int>>
     */
    public function referenceIndex(): array
    {
        $index = [];

        DB::table('messages')
            ->whereNotNull('media_url')
            ->where('media_url', 'like', '%/storage/%')
            ->groupBy('media_url')
            ->select('media_url')
            ->selectRaw('COUNT(*) as total')
            ->get()
            ->each(function ($row) use (&$index) {
                foreach ($this->pathsFromMediaUrl((string) $row->media_url) as $path) {
                    $index[$path]['messages'] = ($index[$path]['messages'] ?? 0) + (int) $row->total;
                }
            });

        BotNode::withTrashed()
            ->select(['id', 'settings'])
            ->chunkById(self::CHUNK_SIZE, function ($nodes) use (&$index) {
                foreach ($nodes as $node) {
                    foreach ($this->pathsFromValue($node->settings) as $path) {
                        $index[$path]['bot_nodes'] = ($index[$path]['bot_nodes'] ?? 0) + 1;
                    }
                }
            });

        return $index;
    }

    /**
     * Rutas candidatas para una URL o ruta /storage/... guardada en messages.media_url.
     * Se usa el resto de la cadena completa: los nombres inbound pueden traer espacios,
     * '#' o '?', y cortar ahí dejaría el archivo sin referencia (y borrable).
     *
     * @return array<int, string>
     */
    public function pathsFromMediaUrl(string $url): array
    {
        $pos = strpos($url, '/storage/');

        if ($pos === false) {
            return [];
        }

        return $this->candidatePaths(substr($url, $pos + strlen('/storage/')));
    }

    /**
     * Rutas /storage/... dentro de cualquier valor (arrays anidados y strings),
     * como los campos de un nodo del bot. Un texto puede tener varias URLs.
     *
     * @return array<int, string>
     */
    public function pathsFromValue(mixed $value): array
    {
        $paths = [];

        $walk = function (mixed $item) use (&$walk, &$paths) {
            if (is_array($item)) {
                foreach ($item as $child) {
                    $walk($child);
                }

                return;
            }

            if (! is_string($item) || ! str_contains($item, '/storage/')) {
                return;
            }

            if (preg_match_all('#/storage/([^\s"\'<>\\\\]+)#', $item, $matches) > 0) {
                foreach ($matches[1] as $remainder) {
                    array_push($paths, ...$this->candidatePaths($remainder));
                }
            }
        };

        $walk($value);

        return array_values(array_unique($paths));
    }

    /**
     * Variantes de una ruta: tal cual, decodificada, sin signos de puntuación finales
     * y sin query string. Un archivo cuenta como referenciado si coincide con cualquiera.
     *
     * @return array<int, string>
     */
    private function candidatePaths(string $remainder): array
    {
        $variants = [];

        foreach ([$remainder, rawurldecode($remainder)] as $base) {
            $variants[] = $base;
            $variants[] = rtrim($base, '.,;:)]}');

            if (str_contains($base, '?')) {
                $variants[] = strstr($base, '?', true);
            }
        }

        $paths = [];
        foreach (array_unique($variants) as $variant) {
            $path = ltrim((string) $variant, '/');

            if ($path !== '') {
                $paths[] = $path;
            }
        }

        return array_values(array_unique($paths));
    }

    /**
     * @param  array{messages: int, bot_nodes: int, total: int}  $refs
     */
    private function blockedReason(bool $actionable, array $refs): ?string
    {
        if (! $actionable) {
            return 'Este tipo de archivo no se gestiona desde este módulo.';
        }

        // Un archivo usado en mensajes se puede mandar a papelera: los mensajes quedan con aviso.
        // Un archivo usado por un nodo del bot no, para no romper el flujo.
        if ($refs['bot_nodes'] > 0) {
            return 'Lo usa '.$refs['bot_nodes'].' nodo(s) del bot. No se puede mandar a papelera.';
        }

        return null;
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     */
    private function upsertRows(array $rows): void
    {
        StorageFile::query()->upsert(
            $rows,
            ['path'],
            ['category', 'size_bytes', 'mime', 'modified_at', 'updated_at'],
        );
    }

    private function mimeFor(string $path): ?string
    {
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));

        if ($extension === '') {
            return null;
        }

        return MimeTypes::getDefault()->getMimeTypes($extension)[0] ?? null;
    }
}
