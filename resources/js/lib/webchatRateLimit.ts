const CLIENT_ID_KEY = "hu.webchat.client_id"
let memoryClientId: string | null = null

function createClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function webchatRateLimitHeaders(resumeToken?: string): Record<string, string> {
  if (typeof window === "undefined") return {}

  try {
    const storedClientId = window.localStorage.getItem(CLIENT_ID_KEY)
    const clientId = storedClientId || memoryClientId || createClientId()
    memoryClientId = clientId
    if (!storedClientId) window.localStorage.setItem(CLIENT_ID_KEY, clientId)
    return {
      "X-Webchat-Client-ID": clientId,
      ...(resumeToken ? { "X-Webchat-Resume-Token": resumeToken } : {}),
    }
  } catch {
    memoryClientId ??= createClientId()
    return {
      "X-Webchat-Client-ID": memoryClientId,
      ...(resumeToken ? { "X-Webchat-Resume-Token": resumeToken } : {}),
    }
  }
}
