<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Providers\RouteServiceProvider;
use App\Services\AuditService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class EmailVerificationNotificationController extends Controller
{
    public function __construct(private readonly AuditService $auditService)
    {
    }

    /**
     * Send a new email verification notification.
     */
    public function store(Request $request): RedirectResponse
    {
        if ($request->user()->hasVerifiedEmail()) {
            return redirect()->intended(RouteServiceProvider::HOME);
        }

        $request->user()->sendEmailVerificationNotification();
        $this->auditService->record(
            'security',
            'email_verification_resent',
            'Reenvio el correo de verificacion',
            $request->user(),
            $request->user(),
        );

        return back()->with('status', 'verification-link-sent');
    }
}
