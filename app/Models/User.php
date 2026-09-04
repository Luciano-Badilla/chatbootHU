<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
        'remember_token',
        'validated',
        'requestsPassword',
        'role_id',
        'is_active',
        'deactivated_at',
        'deactivated_by',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var array<int, string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'email_verified_at' => 'datetime',
        'password' => 'hashed',
        'validated' => 'boolean',
        'requestsPassword' => 'boolean',
        'is_active' => 'boolean',
        'deactivated_at' => 'datetime',
    ];

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class, 'role_id');
    }

    public function roleName(): string
    {
        $roleName = $this->role?->normalizedName() ?? '';
        if ($roleName !== '') {
            return $roleName;
        }

        return match ((int) $this->role_id) {
            1 => 'admin',
            2 => 'supervisor',
            3 => 'operator',
            default => 'operator',
        };
    }

    public function hasRole(string ...$roles): bool
    {
        return in_array($this->roleName(), array_map('strtolower', $roles), true);
    }

    public function roleLabel(): string
    {
        if ($this->role) {
            return $this->role->displayName();
        }

        return match ($this->roleName()) {
            'admin' => 'Administrador',
            'supervisor' => 'Supervisor',
            default => 'Operador',
        };
    }

    public function permissions(): array
    {
        return match ($this->roleName()) {
            'admin' => [
                'can_manage_settings' => true,
                'can_manage_integrations' => true,
                'can_manage_flows' => true,
                'can_view_audit' => true,
                'can_view_flows' => true,
                'can_view_all_chats' => true,
                'can_assign_chats' => true,
                'can_toggle_bot' => true,
                'can_manage_users' => true,
                'can_manage_campaigns' => true,
            ],
            'supervisor' => [
                'can_manage_settings' => false,
                'can_manage_integrations' => false,
                'can_manage_flows' => false,
                'can_view_audit' => true,
                'can_view_flows' => true,
                'can_view_all_chats' => true,
                'can_assign_chats' => true,
                'can_toggle_bot' => true,
                'can_manage_users' => false,
                'can_manage_campaigns' => true,
            ],
            default => [
                'can_manage_settings' => false,
                'can_manage_integrations' => false,
                'can_manage_flows' => false,
                'can_view_audit' => false,
                'can_view_flows' => false,
                'can_view_all_chats' => false,
                'can_assign_chats' => true,
                'can_toggle_bot' => true,
                'can_manage_users' => false,
                'can_manage_campaigns' => false,
            ],
        };
    }

    public function hasPermission(string $permission): bool
    {
        return (bool) ($this->permissions()[$permission] ?? false);
    }
}
