<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Support\Providers\RouteServiceProvider as ServiceProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

class RouteServiceProvider extends ServiceProvider
{
    /**
     * The path to your application's "home" route.
     *
     * Typically, users are redirected here after authentication.
     *
     * @var string
     */
    public const HOME = '/';

    /**
     * Define your route model bindings, pattern filters, and other route configuration.
     */
    public function boot(): void
    {
        RateLimiter::for('api', function (Request $request) {
            return Limit::perMinute(300)->by($this->rateLimitIdentity($request));
        });

        RateLimiter::for('webchat-presence', fn (Request $request) =>
            Limit::perMinute(30)->by($this->rateLimitIdentity($request))
        );
        RateLimiter::for('webchat-push-write', fn (Request $request) =>
            Limit::perMinute(20)->by($this->rateLimitIdentity($request))
        );
        RateLimiter::for('webchat-push-status', fn (Request $request) =>
            Limit::perMinute(30)->by($this->rateLimitIdentity($request))
        );
        RateLimiter::for('public-push-key', fn (Request $request) =>
            Limit::perMinute(30)->by($this->rateLimitIdentity($request))
        );
        RateLimiter::for('operator-push-write', fn (Request $request) =>
            Limit::perMinute(20)->by('user:'.($request->user()?->getAuthIdentifier() ?? $this->rateLimitIdentity($request)))
        );
        RateLimiter::for('operator-push-status', fn (Request $request) =>
            Limit::perMinute(30)->by('user:'.($request->user()?->getAuthIdentifier() ?? $this->rateLimitIdentity($request)))
        );

        $this->routes(function () {
            Route::middleware('api')
                ->prefix('api')
                ->group(base_path('routes/api.php'));

            Route::middleware('web')
                ->group(base_path('routes/web.php'));
        });
    }

    private function rateLimitIdentity(Request $request): string
    {
        if ($userId = $request->user()?->getAuthIdentifier()) {
            return 'user:'.$userId;
        }

        $resumeToken = $request->input('resume_token') ?: $request->header('X-Webchat-Resume-Token');
        if (is_string($resumeToken) && $resumeToken !== '') {
            return 'webchat-token:'.hash('sha256', $resumeToken);
        }

        $clientId = $request->header('X-Webchat-Client-ID');
        if (is_string($clientId) && $clientId !== '') {
            return 'webchat-client:'.hash('sha256', $clientId);
        }

        return 'ip:'.$request->ip();
    }
}
