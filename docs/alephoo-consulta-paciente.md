# Integración de consulta de pacientes con Alephoo v3

Este documento describe el contrato que **consume actualmente este proyecto** para buscar una persona/paciente por DNI desde el nodo `person_lookup`. Está basado en el código del repositorio; no es una especificación oficial de Alephoo. Los ejemplos de respuesta son esquemáticos y deben contrastarse con una respuesta real del ambiente destino antes de implementar un cliente independiente.

## Resumen

| Propiedad | Valor usado por el proyecto |
| --- | --- |
| Sistema | Alephoo API v3 |
| Base URL predeterminada | `https://universitario.alephoo.com/api/v3` |
| Método | `GET` |
| Ruta | `/admin/personas` |
| Identificador de búsqueda | DNI/documento |
| Autenticación | HTTP Basic Authentication |
| Formato esperado | JSON:API (`application/vnd.api+json`) |
| Timeout predeterminado | 30 segundos (configurable; acotado a 1–300 s) |
| Límite solicitado | `limit=1`, `offset=0` |
| Body de petición | No tiene |

La consulta la ejecuta el backend Laravel directamente contra Alephoo. El navegador/webchat no llama a Alephoo ni recibe las credenciales. En otro sistema conviene conservar ese diseño: hacer la llamada desde un backend confiable y nunca exponer usuario/contraseña en el cliente.

## Endpoint de búsqueda

```http
GET https://universitario.alephoo.com/api/v3/admin/personas?filter%5Bdocumento%5D=12345678&limit=1&offset=0
Accept: application/vnd.api+json
Authorization: Basic <base64(username:password)>
```

Los parámetros de query sin codificar son:

| Parámetro | Ejemplo | Descripción |
| --- | --- | --- |
| `filter[documento]` | `12345678` | DNI normalizado, solo dígitos. |
| `limit` | `1` | Se pide como máximo un resultado. |
| `offset` | `0` | Se comienza desde el primer resultado. |

El DNI se obtiene de una variable del flujo (por omisión `dni`) y se normaliza eliminando cualquier carácter que no sea un dígito. El lookup solo comprueba que el resultado no esté vacío; la validación de longitud que existe en el nodo de alta de paciente **no se aplica aquí**.

### Headers

| Header | Valor |
| --- | --- |
| `Accept` | `application/vnd.api+json` |
| `Authorization` | Basic Auth con el usuario y contraseña configurados para Alephoo v3. |

En el nodo de búsqueda no se envía `Content-Type` porque la petición es GET y no tiene body.

## Respuesta esperada

El parser espera una respuesta JSON con una propiedad superior `data`, de acuerdo con JSON:API. Acepta tanto un objeto como una lista de objetos; cuando recibe una lista toma el primer elemento.

Ejemplo **ilustrativo** de respuesta con una persona:

```json
{
  "data": [
    {
      "id": "98765",
      "attributes": {
        "nombres": "María Elena",
        "apellidos": "Pérez",
        "documento": "12345678",
        "fechaNacimiento": "1985-04-23",
        "email": "maria@example.com",
        "celular": "2615550101"
      }
    }
  ]
}
```

Forma de objeto individual que también acepta el código:

```json
{
  "data": {
    "id": "98765",
    "attributes": {
      "nombres": "María Elena",
      "apellidos": "Pérez",
      "documento": "12345678",
      "fechaNacimiento": "1985-04-23",
      "email": "maria@example.com",
      "celular": "2615550101"
    }
  }
}
```

Ejemplo esquemático sin coincidencias:

```json
{
  "data": []
}
```

La estructura de error de Alephoo no se parsea en detalle: para estados distintos de 404 y no exitosos, la aplicación guarda un estado genérico `error` y usa el mensaje de error del nodo.

## Mapeo de campos

| Respuesta Alephoo | Variable del flujo | Tratamiento |
| --- | --- | --- |
| `data[0].id` (o `data.id`) | `persona_id` | Se copia como identificador. |
| `data[0].attributes.nombres` | `persona_nombres` | Se copia sin transformación. |
| `data[0].attributes.apellidos` | `persona_apellidos` | Se copia sin transformación. |
| `data[0].attributes.documento` | `persona_documento` | Se copia sin transformación. |
| `data[0].attributes.fechaNacimiento` | `persona_fecha_nacimiento` | Si empieza con una fecha válida `YYYY-MM-DD`, se muestra como `DD/MM/YYYY`; en otro caso se conserva el valor recibido. |
| `data[0].attributes.email` | `persona_email` | Se copia sin transformación. |
| `data[0].attributes.celular` | `persona_contacto_telefono` | Se copia sin transformación. |

También se inicializan estas variables en `null` o valores vacíos durante cada consulta: `persona_genero`, `persona_obra_social`, `persona_obra_social_id`, `persona_plan_id`, `persona_contacto_telefono_2` y `persona_planes_activos`. El lookup actual **no las completa**, aunque el recurso de Alephoo pudiera incluir esos datos.

Al encontrar una persona, `persona_encontrada=true` y `persona_lookup_status=found`. Si `data` está vacío, no es un objeto/lista con `attributes`, o Alephoo responde 404, el flujo usa `persona_lookup_status=not_found`. Por lo tanto, un 2xx con formato inesperado puede tratarse como “no encontrado”, no como error de protocolo.

## Estados y manejo de errores

| Condición | Estado del flujo | Comportamiento |
| --- | --- | --- |
| DNI vacío luego de normalizar | `missing_dni` | No llama a Alephoo; toma `error_message` y `error_next_node_id` del nodo. |
| Endpoint bloqueado por allowlist | `endpoint_disabled` | No llama a Alephoo. |
| Falta base URL, usuario o contraseña | `misconfigured` | No llama a Alephoo. |
| 2xx con `data` y `attributes` válidos | `found` | Guarda los campos mapeados y usa el texto principal del nodo (`body`). |
| 2xx con estructura vacía/inesperada | `not_found` | Usa `not_found_message` y `not_found_next_node_id`. |
| HTTP 404 | `not_found` | Usa el mismo camino de “no encontrado”. |
| Otro estado HTTP no exitoso | `error` | Registra advertencia y usa `error_message`/`error_next_node_id`. |
| Timeout, error TLS/DNS o excepción | `error` | Registra error y usa `error_message`/`error_next_node_id`. |

La llamada HTTP usa el timeout configurado para Alephoo v3, por omisión 30 segundos. Las excepciones se capturan dentro del nodo y no se propagan al webhook conversacional.

### Observabilidad y datos personales

El código actual escribe el DNI en los logs de aplicación para respuestas exitosas, respuestas de error y excepciones; en el caso de una respuesta HTTP no exitosa también puede registrar el body recibido de Alephoo. Ese comportamiento sirve para diagnosticar la integración, pero puede dejar datos personales o información sensible en logs. Al portar la integración, conviene conservar estado HTTP, duración e identificadores de correlación, y enmascarar/eliminar el DNI y cualquier body que pueda incluir datos clínicos o identificatorios.

## Configuración

Variables de entorno reconocidas en `config/services.php`:

```dotenv
ALEPHOO_V3_BASE_URL=https://universitario.alephoo.com/api/v3
ALEPHOO_V3_USERNAME=<usuario>
ALEPHOO_V3_PASSWORD=<secreto>
ALEPHOO_V3_TIMEOUT=30
ALEPHOO_V3_TIMEZONE=America/Argentina/Buenos_Aires
```

La aplicación permite configurar Alephoo también desde `system_settings`. Para estos valores, la prioridad efectiva es:

1. Valor no vacío guardado en `integrations.alephoo_v3.*` en la base de datos.
2. Valor de configuración cargado desde `ALEPHOO_V3_*`.
3. Base URL predeterminada para `ALEPHOO_V3_BASE_URL`.

`ALEPHOO_V3_TIMEZONE` se usa en otras operaciones de turnos; el lookup de persona no aplica conversión horaria a la fecha de nacimiento.

### Habilitación del endpoint

El nodo verifica `integrations.alephoo.enabled_endpoints` (la allowlist histórica de la integración Alephoo) buscando exactamente `/admin/personas`, o una regla con comodín como `/admin/*`. Si la lista está vacía, el código permite el endpoint. Si la lista contiene rutas de la API antigua, por ejemplo `/personas/{dni}`, eso **no habilita automáticamente** `/admin/personas`.

Esto es distinto de la configuración de credenciales v3 (`integrations.alephoo_v3.*`). Para una instalación nueva, revisar ambas configuraciones.

## Ejemplo de cliente HTTP

Ejemplo con `curl` (usar un DNI de prueba autorizado; evitar guardarlo en historial compartido):

```bash
curl --fail-with-body --silent --show-error \
  --user "$ALEPHOO_V3_USERNAME:$ALEPHOO_V3_PASSWORD" \
  --header 'Accept: application/vnd.api+json' \
  --get "$ALEPHOO_V3_BASE_URL/admin/personas" \
  --data-urlencode 'filter[documento]=12345678' \
  --data-urlencode 'limit=1' \
  --data-urlencode 'offset=0'
```

En producción, leer credenciales de un gestor de secretos o variables seguras del servidor, validar TLS y no incluir usuario, contraseña, DNI completo ni payload con datos personales en logs.

## Integración en otro sistema

Una implementación compatible debería:

1. Recibir el DNI como dato de entrada y normalizarlo a dígitos según la regla actual.
2. Rechazar el valor vacío antes de llamar al upstream.
3. Enviar GET a `BASE_URL + /admin/personas` con `filter[documento]`, `limit=1` y `offset=0`.
4. Aplicar Basic Auth y `Accept: application/vnd.api+json` desde el backend.
5. Parsear JSON:API tolerando `data` como objeto o lista; mapear el primer recurso y sus `attributes`.
6. Diferenciar “no encontrado” (404 o lista vacía) de fallo técnico (401/403, 5xx, timeout, TLS/DNS).
7. Mantener separados los datos personales de logs generales y controlar acceso, retención y auditoría conforme a la política de datos de salud del nuevo sistema.

No reutilizar el ejemplo con credenciales reales ni probar con DNI de pacientes reales fuera del entorno autorizado.

## Diferencia con la API antigua y otras operaciones

El repositorio conserva otra configuración `integrations.alephoo.*` con header `X-API-KEY` y rutas históricas como `/personas/{dni}`, `/especialidades` y `/turnos/...`. **El nodo actual `person_lookup` no usa ese endpoint antiguo**: usa Alephoo v3, Basic Auth y `/admin/personas`.

La consulta de turnos usa otro recurso v3 (`/admision/turnos`) y la creación de paciente usa `POST /admin/personas` con un body JSON:API distinto. Esas operaciones no forman parte del contrato GET documentado aquí. La prueba de conectividad v3 de la pantalla de configuración consulta `/admision/turnos`, por lo que una prueba exitosa allí confirma credenciales/conectividad generales, pero no garantiza por sí sola permiso de lectura sobre `/admin/personas`.

## Referencias en este repositorio

- `app/Http/Controllers/WhatsAppController.php`: `sendPersonLookupNode`, `alephooV3BaseUrl`, `alephooV3Username`, `alephooV3Password`, `alephooV3Timeout`, `isAlephooEndpointEnabled`.
- `config/services.php`: configuración `alephoo_v3`.
- `.env.example`: variables `ALEPHOO_V3_*`.
- `app/Http/Controllers/SettingsController.php`: lectura/guardado y prueba de integración.
