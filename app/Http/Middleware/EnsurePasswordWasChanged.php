<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsurePasswordWasChanged
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || ! $user->requestsPassword) {
            return $next($request);
        }

        if ($request->routeIs('profile.edit', 'password.update', 'logout')) {
            return $next($request);
        }

        if ($request->expectsJson()) {
            return response()->json(['message' => 'Debes cambiar tu contraseña provisoria antes de continuar.'], 423);
        }

        return redirect()->route('profile.edit')->with('status', 'Debes cambiar tu contraseña provisoria antes de continuar.');
    }
}
