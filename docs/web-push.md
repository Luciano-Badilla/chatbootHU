# Notificaciones Web Push

El proyecto envía avisos push a los operadores cuando entra un mensaje de un contacto y a quien inició una conversación de webchat cuando llega una respuesta. El texto de los avisos no incluye el contenido del mensaje.

## Configuración inicial

1. Serví la aplicación con HTTPS.
2. Generá un par VAPID con `php artisan webpush:generate-keys`.
3. Configurá `WEBPUSH_VAPID_PUBLIC_KEY`, `WEBPUSH_VAPID_PRIVATE_KEY` y `WEBPUSH_VAPID_SUBJECT` en el entorno de Laravel. Usá un subject de contacto estable, por ejemplo `mailto:soporte@tu-dominio`.
4. Ejecutá `php artisan migrate`.
5. Confirmá que un worker procese la cola `default`; los jobs de push se agregan ahí.
6. Reconstruí los assets del frontend para publicar los controles de suscripción.

Las claves VAPID identifican a la aplicación ante los servicios push. Conservá el mismo par de claves; reemplazarlas invalida las suscripciones existentes. No guardes la clave privada en el repositorio ni la incluyas en el frontend.

## Activación

Cada operador activa los avisos desde el botón de campana en el panel de mensajes. La persona que usa el webchat los activa desde la campana del encabezado después de iniciar una conversación. Ambos pueden desactivarlos desde el mismo lugar.

En iPhone y iPad, el webchat debe agregarse a la pantalla de inicio y abrirse desde su ícono antes de permitir notificaciones. La aplicación necesita ejecutarse en iOS/iPadOS 16.4 o posterior.

Las suscripciones guardan cifrados el endpoint y los datos de cifrado del navegador. Al recibir una respuesta 404 o 410 del servicio push, la suscripción se elimina automáticamente.
