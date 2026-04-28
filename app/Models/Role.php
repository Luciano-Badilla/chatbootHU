<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Role extends Model
{
    use HasFactory;

    protected $table = 'roles';
    protected $fillable = ['name'];

    public function normalizedName(): string
    {
        return match (strtolower(trim((string) $this->name))) {
            'admin', 'administrador', 'administradora' => 'admin',
            'supervisor', 'supervisora' => 'supervisor',
            'operator', 'operador', 'operadora' => 'operator',
            default => '',
        };
    }

    public function displayName(): string
    {
        return match ($this->normalizedName()) {
            'admin' => 'Administrador',
            'supervisor' => 'Supervisor',
            'operator' => 'Operador',
            default => (string) $this->name,
        };
    }
}
