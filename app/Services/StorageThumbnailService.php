<?php

namespace App\Services;

use App\Models\StorageFile;
use Illuminate\Support\Facades\Storage;

/**
 * Miniaturas de imágenes para la pantalla de almacenamiento. Se generan con GD,
 * se reducen a MAX_SIDE píxeles y se guardan en el disco local (no en public), así
 * la lista no decodifica imágenes de 4000 píxeles para mostrar cuadraditos.
 */
class StorageThumbnailService
{
    public const MAX_SIDE = 160;
    public const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
    public const MAX_SOURCE_PIXELS = 24_000_000;
    private const DIR = 'storage-thumbs';
    private const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];

    /**
     * Ruta absoluta de la miniatura, o null si el archivo no es una imagen soportada.
     */
    public function thumbnailPath(StorageFile $file): ?string
    {
        if (! $this->isImage($file) || ! function_exists('imagecreatetruecolor')) {
            return null;
        }

        $disk = Storage::disk(StorageUsageService::DISK);
        if (! $disk->exists($file->path)) {
            return null;
        }

        // La clave cambia si el archivo cambia (tamaño o fecha), así no queda una miniatura vieja.
        $key = sha1($file->path.'|'.$file->size_bytes.'|'.optional($file->modified_at)->timestamp).'.jpg';
        $relative = self::DIR.'/'.$key;
        $cache = Storage::disk('local');

        if ($cache->exists($relative)) {
            return $cache->path($relative);
        }

        $jpeg = $this->render($disk->path($file->path));
        if ($jpeg === null) {
            return null;
        }

        $cache->makeDirectory(self::DIR);
        $cache->put($relative, $jpeg);

        return $cache->path($relative);
    }

    public function isImage(StorageFile $file): bool
    {
        $extension = strtolower(pathinfo($file->path, PATHINFO_EXTENSION));

        return in_array($extension, self::IMAGE_EXTENSIONS, true);
    }

    private function render(string $source): ?string
    {
        if (! is_file($source) || filesize($source) > self::MAX_SOURCE_BYTES) {
            return null;
        }

        $info = @getimagesize($source);
        if ($info === false || $info[0] * $info[1] > self::MAX_SOURCE_PIXELS) {
            return null;
        }

        // Decodificar una foto grande necesita memoria; se sube el límite solo para esta tarea.
        @ini_set('memory_limit', '256M');

        $contents = @file_get_contents($source);
        $image = $contents === false ? false : @imagecreatefromstring($contents);
        unset($contents);

        if ($image === false) {
            return null;
        }

        [$width, $height] = [imagesx($image), imagesy($image)];
        $scale = min(1, self::MAX_SIDE / max($width, $height));
        $thumbWidth = max(1, (int) round($width * $scale));
        $thumbHeight = max(1, (int) round($height * $scale));

        $thumb = imagecreatetruecolor($thumbWidth, $thumbHeight);
        // Fondo blanco: los PNG con transparencia no quedan negros al pasar a JPEG.
        imagefill($thumb, 0, 0, imagecolorallocate($thumb, 255, 255, 255));
        imagecopyresampled($thumb, $image, 0, 0, 0, 0, $thumbWidth, $thumbHeight, $width, $height);
        imagedestroy($image);

        ob_start();
        imagejpeg($thumb, null, 78);
        $jpeg = ob_get_clean();
        imagedestroy($thumb);

        return $jpeg === false ? null : $jpeg;
    }
}
