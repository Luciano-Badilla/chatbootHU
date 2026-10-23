<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="@yield('description')">
    <meta name="robots" content="index,follow">
    <meta name="theme-color" content="#003f73">
    <title>@yield('title') · Hospital Universitario UNCUYO</title>
    <style>
        :root { color-scheme: light; --navy: #003f73; --navy-deep: #062d4d; --teal: #2caaa4; --ink: #243446; --muted: #5c6b7a; --line: #dce5ec; --paper: #fff; --wash: #f2f6f9; }
        * { box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body { margin: 0; background: var(--wash); color: var(--ink); font: 16px/1.7 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        a { color: var(--navy); text-decoration-thickness: 1px; text-underline-offset: 3px; }
        a:hover { color: #075a97; }
        a:focus-visible { outline: 3px solid #78c9c5; outline-offset: 3px; border-radius: 3px; }
        .skip { position: absolute; left: -9999px; top: 8px; z-index: 10; padding: 9px 14px; background: white; }
        .skip:focus { left: 8px; }
        .topbar { background: var(--paper); border-bottom: 1px solid var(--line); }
        .topbar-inner, .page, .footer-inner { width: min(1060px, calc(100% - 40px)); margin-inline: auto; }
        .topbar-inner { min-height: 74px; display: flex; align-items: center; justify-content: space-between; gap: 18px; }
        .brand { display: inline-flex; align-items: center; gap: 12px; color: var(--navy); text-decoration: none; }
        .brand-mark { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 12px; background: var(--navy); color: white; font-size: 13px; font-weight: 800; letter-spacing: .04em; }
        .brand-name { display: block; font-size: 14px; font-weight: 750; line-height: 1.3; }
        .brand-sub { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; line-height: 1.3; }
        .top-link { font-size: 13px; font-weight: 650; text-decoration: none; }
        .page { padding: 54px 0 80px; }
        .eyebrow { margin: 0 0 12px; color: var(--navy); font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
        h1 { max-width: 760px; margin: 0; color: var(--navy-deep); font-size: clamp(34px, 5vw, 52px); line-height: 1.12; letter-spacing: -.035em; }
        .lead { max-width: 760px; margin: 18px 0 0; color: var(--muted); font-size: 18px; line-height: 1.65; }
        .updated { display: inline-flex; align-items: center; gap: 8px; margin-top: 22px; color: #526477; font-size: 12px; }
        .updated::before { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); content: ""; }
        .notice { margin: 34px 0 30px; padding: 22px 24px; border: 1px solid #d5e6ed; border-left: 4px solid var(--teal); border-radius: 12px; background: #fff; }
        .notice strong { color: var(--navy-deep); }
        .notice p { margin: 5px 0 0; color: var(--muted); font-size: 14px; }
        .content-grid { display: grid; grid-template-columns: 225px minmax(0, 1fr); align-items: start; gap: 38px; }
        .contents { position: sticky; top: 24px; padding: 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); }
        .contents h2 { margin: 0 0 10px; color: var(--navy-deep); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
        .contents ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
        .contents a { color: #526477; font-size: 12px; line-height: 1.45; text-decoration: none; }
        .contents a:hover { color: var(--navy); text-decoration: underline; }
        .document { min-width: 0; padding: 34px clamp(22px, 5vw, 48px); border: 1px solid var(--line); border-radius: 14px; background: var(--paper); box-shadow: 0 12px 34px rgba(19, 52, 79, .045); }
        .document section + section { margin-top: 34px; padding-top: 30px; border-top: 1px solid var(--line); }
        .document h2 { margin: 0 0 11px; color: var(--navy-deep); font-size: 20px; line-height: 1.35; letter-spacing: -.01em; scroll-margin-top: 20px; }
        .document h3 { margin: 20px 0 6px; color: var(--navy-deep); font-size: 15px; }
        .document p { margin: 9px 0; color: #425367; font-size: 14px; }
        .document ul, .document ol { margin: 10px 0 0; padding-left: 21px; color: #425367; font-size: 14px; }
        .document li + li { margin-top: 7px; }
        .document strong { color: #273d53; }
        .contact-box { margin-top: 16px; padding: 16px 18px; border-radius: 10px; background: #f2f7fa; }
        .contact-box p:first-child { margin-top: 0; }
        .contact-box p:last-child { margin-bottom: 0; }
        .footer { border-top: 1px solid var(--line); background: #fff; }
        .footer-inner { display: flex; justify-content: space-between; gap: 18px; padding: 24px 0; color: var(--muted); font-size: 12px; }
        .footer-inner p { margin: 0; }
        @media (max-width: 760px) {
            .topbar-inner, .page, .footer-inner { width: min(100% - 28px, 620px); }
            .topbar-inner { min-height: 66px; }
            .top-link { font-size: 12px; }
            .page { padding-top: 38px; }
            .lead { font-size: 16px; }
            .content-grid { grid-template-columns: 1fr; gap: 18px; }
            .contents { position: static; }
            .contents ul { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .document { padding: 26px 20px; }
        }
        @media (max-width: 430px) {
            .brand-mark { width: 38px; height: 38px; }
            .brand-name { font-size: 12px; }
            .brand-sub { font-size: 10px; }
            .top-link { max-width: 105px; text-align: right; }
            .contents ul { grid-template-columns: 1fr; }
            .notice { padding: 18px; }
            .footer-inner { flex-direction: column; }
        }
        @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
    </style>
</head>
<body>
    <a class="skip" href="#contenido">Saltar al contenido</a>
    <header class="topbar">
        <div class="topbar-inner">
            <a class="brand" href="https://hospital.uncuyo.edu.ar/" aria-label="Hospital Universitario de la UNCUYO">
                <span class="brand-mark" aria-hidden="true">HU</span>
                <span><span class="brand-name">Hospital Universitario</span><span class="brand-sub">Universidad Nacional de Cuyo</span></span>
            </a>
            <a class="top-link" href="{{ route('webchat') }}">Volver al webchat <span aria-hidden="true">↗</span></a>
        </div>
    </header>
    <main id="contenido" class="page">
        @yield('content')
    </main>
    <footer class="footer">
        <div class="footer-inner">
            <p>Hospital Universitario · Universidad Nacional de Cuyo · Mendoza, Argentina</p>
            <p><a href="mailto:info@hospital.uncu.edu.ar">info@hospital.uncu.edu.ar</a></p>
        </div>
    </footer>
</body>
</html>
