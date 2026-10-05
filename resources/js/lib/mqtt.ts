/**
 * Construye la URL pública del broker MQTT para los clientes del navegador.
 * Los valores por defecto mantienen el entorno de desarrollo actual.
 */
export const mqttWebSocketUrl = (): string | null => {
  const host = import.meta.env.VITE_MOSQUITTO_HOST?.trim()
  if (!host) return null

  const protocol = (import.meta.env.VITE_MQTT_WS_PROTOCOL || "ws").trim()
  const configuredPort = (import.meta.env.VITE_MQTT_WS_PORT || "9001").trim()
  const configuredPath = (import.meta.env.VITE_MQTT_WS_PATH || "").trim()
  const path = configuredPath
    ? `/${configuredPath.replace(/^\/+/, "")}`
    : ""

  return `${protocol}://${host}${configuredPort ? `:${configuredPort}` : ""}${path}`
}
