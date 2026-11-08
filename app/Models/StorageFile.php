<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Registro de un archivo del disco public. La papelera es lógica: al enviar a
 * papelera se marca deleted_at y el archivo queda en disco (sus URLs siguen
 * funcionando). El borrado permanente es el único paso que libera espacio.
 */
class StorageFile extends Model
{
    use SoftDeletes;

    protected $table = 'storage_files';

    protected $fillable = [
        'path',
        'category',
        'size_bytes',
        'mime',
        'modified_at',
    ];

    protected $casts = [
        'size_bytes' => 'integer',
        'modified_at' => 'datetime',
    ];
}
