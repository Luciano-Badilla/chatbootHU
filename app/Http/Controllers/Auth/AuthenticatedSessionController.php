<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Providers\RouteServiceProvider;
use App\Services\AuditService;
use App\Services\ChatAssignmentService;
use App\Services\OperatorAvailabilityService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Inertia\Response;
use PhpMqtt\Client\MqttClient;

class AuthenticatedSessionController extends Controller
{
    public function __construct(
        private readonly AuditService $auditService,
        private readonly ChatAssignmentService $chatAssignmentService,
        private readonly OperatorAvailabilityService $operatorAvailabilityService,
    ) {}

    /**
     * Display the login view.
     */
    public function create(): Response
    {
        return Inertia::render('Auth/Login', [
            'canResetPassword' => Route::has('password.request'),
            'status' => session('status'),
        ]);
    }

    /**
     * Handle an incoming authentication request.
     */
    public function store(LoginRequest $request): RedirectResponse
    {
        $request->authenticate();

        $request->session()->regenerate();

        $user = $request->user();
        $user->loadMissing('role');
        if ($user->canHandleChats()) {
            $user->update(['operator_availability' => 'available', 'current_chat_id' => null, 'last_operator_activity_at' => now()]);
            $this->chatAssignmentService->assignAllPending();
            $this->publishOperatorControlUpdate(['type' => 'availability', 'operator_id' => $user->id, 'availability' => 'available']);
        }
        $this->auditService->record(
            'security',
            'login',
            "Inicio sesion {$user->name}",
            $user,
            $user,
            [
                'meta' => [
                    'ip' => $request->ip(),
                ],
            ],
        );

        return redirect('/dashboard');
    }

    /**
     * Destroy an authenticated session.
     */
    public function destroy(Request $request): RedirectResponse
    {
        $user = $request->user();
        if ($user) {
            $user->loadMissing('role');
            $releasedChats = collect();
            if ($user->canHandleChats()) {
                $user->update(['operator_availability' => 'unavailable', 'current_chat_id' => null]);
                $releasedChats = $this->operatorAvailabilityService->releaseOpenChats($user);
                foreach ($releasedChats as $chat) {
                    $this->auditService->recordChatAction('operator_logout_released', 'Libero el chat por cierre de sesión', $chat, $user, [
                        'meta' => ['previous_operator_id' => $user->id, 'reassigned_operator_id' => $chat->operator_id],
                    ]);
                }
                $this->publishOperatorControlUpdate(['type' => 'availability', 'operator_id' => $user->id, 'availability' => 'unavailable']);
            }

            $this->auditService->record(
                'security',
                'logout',
                "Cerro sesion {$user->name}",
                $user,
                $user,
                [
                    'meta' => [
                        'ip' => $request->ip(),
                        'released_chats_count' => $releasedChats->count(),
                    ],
                ],
            );
        }

        Auth::guard('web')->logout();

        $request->session()->invalidate();

        $request->session()->regenerateToken();

        return redirect('/');
    }

    private function publishOperatorControlUpdate(array $payload): void
    {
        $host = env('MQTT_HOST') ?: env('VITE_MOSQUITTO_HOST');
        if (! $host) return;

        try {
            $mqtt = new MqttClient((string) $host, 1883, 'laravel_operator_session_'.uniqid());
            $mqtt->connect();
            $mqtt->publish('operator-control/update', json_encode($payload), 0);
            $mqtt->disconnect();
        } catch (\Throwable $exception) {
            Log::warning('MQTT Error (operator session): '.$exception->getMessage());
        }
    }
}
