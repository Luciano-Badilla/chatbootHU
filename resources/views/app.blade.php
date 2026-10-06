<!DOCTYPE html>
<html lang="es">

<head>
    <meta charset="UTF-8" />
    <title>{{ env('APP_NAME') }}</title>
    <link rel="icon" type="image/png" href="{{ asset('storage/webchat/logos/of0tyT0w2q0PiPPYFiwwHSUsQvVYwERqqDHJIEJW.png') }}">
    <link rel="icon" type="image/png" sizes="32x32" href="{{ asset('storage/webchat/logos/of0tyT0w2q0PiPPYFiwwHSUsQvVYwERqqDHJIEJW.png') }}">
    <link rel="icon" type="image/png" sizes="48x48" href="{{ asset('storage/webchat/logos/of0tyT0w2q0PiPPYFiwwHSUsQvVYwERqqDHJIEJW.png') }}">
    <link rel="manifest" href="{{ asset('manifest.webmanifest') }}">
    <meta name="theme-color" content="#003f73">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="HUni Chat">
    <link rel="apple-touch-icon" sizes="180x180" href="{{ asset('storage/webchat/logos/of0tyT0w2q0PiPPYFiwwHSUsQvVYwERqqDHJIEJW.png') }}">

    <script src="https://cdn.tailwindcss.com"></script>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <!-- Token necesario para las solicitudes desde Inertia/React -->
    <meta name="csrf-token" content="{{ csrf_token() }}">

    <!--
        Expone las rutas de Laravel al frontend (Ziggy).
        Permite usar route('nombre') directamente en React.
    -->
    @routes

    <!-- Habilita recarga en caliente en modo desarrollo para React + Vite -->
    @viteReactRefresh

    <!--
        Carga el punto de entrada de la SPA en React.
        Aquí se monta Inertia y toda la app del frontend.
    -->
    @vite('resources/js/app.tsx')
</head>

<body>
    <!--
        Contenedor donde Inertia monta la aplicación React.
        data-page contiene el estado inicial enviado desde Laravel.
    -->
    <div id="app" data-page='@json($page)'></div>
</body>

</html>
