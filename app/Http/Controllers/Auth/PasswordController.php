<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Services\AuditService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

class PasswordController extends Controller
{
    public function __construct(private readonly AuditService $auditService) {}

    /**
     * Update the user's password.
     */
    public function update(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'current_password' => ['required', 'current_password'],
            'password' => ['required', Password::defaults(), 'confirmed'],
        ]);

        $request->user()->update([
            'password' => Hash::make($validated['password']),
            'requestsPassword' => false,
        ]);

        $user = $request->user();
        $this->auditService->record(
            'security',
            'password_changed',
            "Cambio su contrasena {$user->name}",
            $user,
            $user,
            [
                'meta' => [
                    'ip' => $request->ip(),
                ],
            ],
        );

        return back();
    }
}
