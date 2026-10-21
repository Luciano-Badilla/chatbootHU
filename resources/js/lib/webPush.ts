import { webchatRateLimitHeaders } from "./webchatRateLimit"

const appUrl = String(import.meta.env.VITE_APP_URL ?? "").replace(/\/$/, "")

const base64UrlToBytes = (value: string) => {
  const padded = value + "=".repeat((4 - value.length % 4) % 4)
  const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

const csrfHeaders = () => {
  const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content")
  return token ? { "X-CSRF-TOKEN": token } : {}
}

export const getWebPushSubscription = async () => {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null
  const registration = await navigator.serviceWorker.getRegistration("/")
  return registration?.pushManager.getSubscription() ?? null
}

export const subscribeToWebPush = async (path: string, extra: Record<string, string> = {}) => {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Este navegador no admite notificaciones push.")
  }

  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission()
  if (permission !== "granted") throw new Error("No se otorgó permiso para las notificaciones.")

  const keyResponse = await fetch(`${appUrl}/api/push/vapid-public-key`, { headers: { Accept: "application/json", ...webchatRateLimitHeaders(extra.resume_token) } })
  const keyData = await keyResponse.json().catch(() => ({}))
  if (!keyResponse.ok || !keyData.enabled || !keyData.public_key) {
    throw new Error("Las notificaciones push todavía no están configuradas en el servidor.")
  }

  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" })
  await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(keyData.public_key),
    })
  }

  const saveResponse = await fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...csrfHeaders(), ...webchatRateLimitHeaders(extra.resume_token) },
    body: JSON.stringify({ ...extra, subscription: subscription.toJSON() }),
  })
  const saveData = await saveResponse.json().catch(() => ({}))
  if (!saveResponse.ok) throw new Error(saveData.message || "No se pudo guardar la suscripción push.")

  return subscription
}

export const isWebPushSubscriptionEnabled = async (path: string, extra: Record<string, string> = {}) => {
  const subscription = await getWebPushSubscription()
  if (!subscription || Notification.permission !== "granted") return false

  const response = await fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...csrfHeaders(), ...webchatRateLimitHeaders(extra.resume_token) },
    body: JSON.stringify({ ...extra, endpoint: subscription.endpoint }),
  })
  if (!response.ok) return false
  const data = await response.json().catch(() => ({}))
  return data.enabled === true
}

export const unsubscribeFromWebPush = async (path: string, extra: Record<string, string> = {}) => {
  const subscription = await getWebPushSubscription()
  if (!subscription) return

  const response = await fetch(`${appUrl}${path}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...csrfHeaders(), ...webchatRateLimitHeaders(extra.resume_token) },
    body: JSON.stringify({ ...extra, endpoint: subscription.endpoint }),
  })
  if (!response.ok) throw new Error("No se pudo desactivar la suscripción push.")
  await subscription.unsubscribe()
}
