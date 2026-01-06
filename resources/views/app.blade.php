<!DOCTYPE html>
<html lang="es">

<head>
    <meta charset="UTF-8" />
    <title>{{ env('APP_NAME') }}</title>

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
    @vite('resources/js/app.jsx')
</head>

<body>
    <!--
        Contenedor donde Inertia monta la aplicación React.
        data-page contiene el estado inicial enviado desde Laravel.
    -->
    <div id="app" data-page='@json($page)'></div>
</body>

</html>
