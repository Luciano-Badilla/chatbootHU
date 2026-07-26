# Chatbot WhatsApp HU

Sistema Laravel + React/Inertia para gestionar conversaciones de WhatsApp, flujos automatizados de bot, agenda de contactos, medios, ubicaciones, auditoria y configuraciones operativas.

## Requisitos

- PHP `8.1` o superior.
- Composer.
- Node.js `18+` recomendado y npm.
- MySQL o MariaDB.
- Servidor web apuntando a `public/`.
  - Desarrollo: Laragon, XAMPP, Apache, Nginx o virtual host local.
  - Produccion: Apache o Nginx con document root en `public/`.
- Mosquitto MQTT:
  - TCP `1883` para Laravel.
  - WebSocket `9001` para el frontend.
- Cuenta de Meta/WhatsApp Cloud API:
  - Access token.
  - Phone number ID.
  - Verify token del webhook.
- Scheduler de Laravel activo para ejecutar el job de inactividad:
  - Desarrollo: `php artisan schedule:work`.
  - Produccion Linux: cron ejecutando `php artisan schedule:run` cada minuto.
  - Produccion Windows: tarea programada ejecutando `php artisan schedule:run` cada minuto.

## Scheduler e inactividad del bot

La verificacion de inactividad es necesaria para que el sistema reactive el bot cuando una conversacion queda abandonada o pausada por atencion de operador.

Configuracion actual en `app/Console/Kernel.php`:

```php
$schedule->command('bot:expire-inactive-chats')
    ->everyMinute()
    ->withoutOverlapping();
```

Comando manual:

```bash
php artisan bot:expire-inactive-chats
```

Dry-run para ver cuantos chats vencerian sin procesarlos:

```bash
php artisan bot:expire-inactive-chats --dry-run
```

### Como funciona

- Lee `bot.inactivity_timeout_minutes` desde configuracion.
- El valor esta en minutos.
- El minimo permitido es `1`.
- El maximo permitido es `10080` minutos, equivalente a 7 dias.
- El default es `1440` minutos, equivalente a 24 horas.
- Busca chats con `last_user_message_at` vencido, flujo activo y progreso pendiente.
- Si corresponde, envia el mensaje de inactividad, reinicia el chat al nodo inicial del flujo activo/default y reactiva el bot.

Logica principal:

```text
app/Services/BotInactivityService.php
app/Console/Commands/ExpireInactiveBotChats.php
```

### Desarrollo

Para probar el scheduler en desarrollo:

Linux/macOS:

```bash
php artisan schedule:work
```

Windows CMD:

```cmd
php artisan schedule:work
```

Dejar ese proceso corriendo en una terminal aparte mientras se prueba la inactividad.

### Produccion

En Linux, agregar un cron cada minuto:

```cron
* * * * * cd /ruta/al/proyecto && php artisan schedule:run >> /dev/null 2>&1
```

En Windows Server, usar el Programador de tareas ejecutando cada minuto desde la carpeta del proyecto:

```cmd
php artisan schedule:run
```

## Instalacion en desarrollo

### Linux/macOS

```bash
composer install
npm install
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan storage:link
npm run dev
```

### Windows CMD

```cmd
composer install
npm install
copy .env.example .env
php artisan key:generate
php artisan migrate
php artisan storage:link
npm run dev
```

La aplicacion debe servirse desde Apache/Nginx/Laragon apuntando a la carpeta `public/`.

Ejemplo local con subcarpeta:

```env
APP_URL=http://172.22.115.103/chatbot/public
VITE_APP_URL=http://172.22.115.103/chatbot/public
VITE_API_BASE_URL=/chatbot/public
VITE_DEV_SERVER=http://172.22.115.103:5173
```

Actualmente no hay seeders obligatorios. Si se agregan datos iniciales en el futuro:

```bash
php artisan db:seed
```

## Instalacion en produccion

1. Subir el codigo al servidor.
2. Instalar dependencias PHP optimizadas:

```bash
composer install --no-dev --optimize-autoloader
```

3. Compilar assets:

```bash
npm ci
npm run build
```

Si el servidor de produccion no tiene Node.js, compilar en otro entorno y desplegar tambien `public/build`.

4. Crear y configurar `.env`.

Linux/macOS:

```bash
cp .env.example .env
php artisan key:generate
```

Windows CMD:

```cmd
copy .env.example .env
php artisan key:generate
```

5. Configurar el servidor web para que el document root apunte a:

```text
/ruta/al/proyecto/public
```

6. Dar permisos de escritura a:

```text
storage/
bootstrap/cache/
```

7. Ejecutar migraciones:

```bash
php artisan migrate --force
php artisan storage:link
```

8. Optimizar Laravel:

```bash
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

9. Confirmar que el scheduler de Laravel quede activo como se indica en la seccion `Scheduler e inactividad del bot`.

## Plantilla .env

Copia de referencia sin valores sensibles:

```env
APP_NAME="chatbot"
APP_ENV=
APP_KEY=
APP_DEBUG=
APP_URL=

LOG_CHANNEL=stack
LOG_DEPRECATIONS_CHANNEL=null
LOG_LEVEL=debug

DB_CONNECTION=mysql
DB_HOST=
DB_PORT=3306
DB_DATABASE=
DB_USERNAME=
DB_PASSWORD=

CACHE_DRIVER=file
FILESYSTEM_DISK=local
QUEUE_CONNECTION=sync
SESSION_DRIVER=file
SESSION_LIFETIME=120

MEMCACHED_HOST=

REDIS_HOST=
REDIS_PASSWORD=
REDIS_PORT=6379

MAIL_MAILER=smtp
MAIL_HOST=
MAIL_PORT=
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_ENCRYPTION=
MAIL_FROM_ADDRESS=
MAIL_FROM_NAME="${APP_NAME}"

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=us-east-1
AWS_BUCKET=
AWS_USE_PATH_STYLE_ENDPOINT=false

BROADCAST_DRIVER=pusher
PUSHER_APP_ID=
PUSHER_APP_KEY=
PUSHER_APP_SECRET=
PUSHER_HOST=
PUSHER_PORT=
PUSHER_SCHEME=
PUSHER_APP_CLUSTER=mt1

VITE_APP_NAME="${APP_NAME}"
VITE_PUSHER_APP_KEY="${PUSHER_APP_KEY}"
VITE_PUSHER_HOST="${PUSHER_HOST}"
VITE_PUSHER_PORT="${PUSHER_PORT}"
VITE_PUSHER_SCHEME="${PUSHER_SCHEME}"
VITE_PUSHER_APP_CLUSTER="${PUSHER_APP_CLUSTER}"
VITE_DEV_SERVER=
VITE_API_BASE_URL=
VITE_APP_URL=

MQTT_HOST=
VITE_MOSQUITTO_HOST=

WHATSAPP_API_URL=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_ID=
```

Notas:

- `APP_KEY` se genera con `php artisan key:generate`.
- En produccion usar `APP_ENV=production` y `APP_DEBUG=false`.
- `APP_URL`, `VITE_APP_URL` y `VITE_API_BASE_URL` deben coincidir con la URL real.
- Los datos de WhatsApp tambien pueden configurarse desde el panel de configuracion; el sistema prioriza `system_settings` y usa `.env` como fallback.

## MQTT / Mosquitto

El chat usa MQTT para actualizar mensajes, estado del bot, operador y estados de entrega en tiempo real.

Configuracion minima sugerida de Mosquitto:

```conf
listener 1883
protocol mqtt

listener 9001
protocol websockets
```

Variables relacionadas:

```env
MQTT_HOST=
VITE_MOSQUITTO_HOST=
```

Despues de cambiar variables de entorno:

Linux/macOS:

```bash
php artisan config:clear
php artisan cache:clear
```

Windows CMD:

```cmd
php artisan config:clear
php artisan cache:clear
```

## WhatsApp Cloud API

Webhook del proyecto:

```text
GET/POST {APP_URL}/api/webhook
```

En Meta configurar:

- Callback URL: `{APP_URL}/api/webhook`.
- Verify token: el mismo valor de `WHATSAPP_VERIFY_TOKEN` o el guardado en configuracion.
- Suscripcion al campo `messages`.

Variables/env o configuracion equivalente:

```env
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_ID=
WHATSAPP_VERIFY_TOKEN=
```

## Queues / jobs

El proyecto incluye tablas de jobs, pero por defecto usa:

```env
QUEUE_CONNECTION=sync
```

Con `sync` no hace falta correr workers. Si se cambia a `database`, `redis` u otro driver, levantar un worker:

Linux/macOS:

```bash
php artisan queue:work
```

Windows CMD:

```cmd
php artisan queue:work
```

En produccion conviene administrar el worker con Supervisor, systemd, PM2, NSSM o una herramienta equivalente.

## Comandos utiles

### Linux/macOS

```bash
php artisan optimize:clear
php artisan route:list
php artisan test
npm run build
```

### Windows CMD

```cmd
php artisan optimize:clear
php artisan route:list
php artisan test
npm run build
```

## Estructura principal

- `resources/js/Pages/Chat`: panel de conversaciones.
- `resources/js/Pages/BotFlowBuilder.tsx`: constructor visual de flujos.
- `resources/js/Pages/AgendaPanel.tsx`: agenda interna de contactos.
- `resources/js/Pages/SettingsPanel.tsx`: configuraciones generales, WhatsApp, Alephoo e inactividad.
- `resources/js/Pages/AuditPanel.tsx`: auditoria.
- `app/Http/Controllers/WhatsAppController.php`: webhook y envios de WhatsApp.
- `app/Services/BotInactivityService.php`: reinicio por inactividad.
- `app/Console/Commands/ExpireInactiveBotChats.php`: comando del scheduler.

## Notas de operacion

- Si los mensajes llegan a Meta pero no al sistema, revisar que el webhook configurado en Meta apunte a este proyecto.
- Si el chat no actualiza en vivo, revisar Mosquitto, `MQTT_HOST`, `VITE_MOSQUITTO_HOST` y limpiar cache de configuracion.
- Si los medios no abren, confirmar `php artisan storage:link` y permisos de `storage/`.
- Si se usa una URL con subcarpeta como `/chatbot/public`, mantener consistentes `APP_URL`, `VITE_APP_URL` y `VITE_API_BASE_URL`.
