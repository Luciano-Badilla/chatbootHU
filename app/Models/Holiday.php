<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Feriado del calendario. Se carga desde la API pública (source = api) o a mano (source = manual).
 * Quitar un feriado es un soft delete: así una nueva carga desde la API no lo vuelve a agregar.
 */
class Holiday extends Model
{
    use SoftDeletes;

    public const SOURCE_API = 'api';
    public const SOURCE_MANUAL = 'manual';

    protected $fillable = ['date', 'name', 'source'];

    protected $casts = [
        'date' => 'date',
    ];
}
