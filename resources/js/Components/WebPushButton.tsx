import { useEffect, useState } from "react"
import { Bell, BellOff } from "lucide-react"
import { toast } from "sonner"
import { isWebPushSubscriptionEnabled, subscribeToWebPush, unsubscribeFromWebPush } from "../lib/webPush"

export default function WebPushButton() {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    isWebPushSubscriptionEnabled("/api/push/subscriptions/status")
      .then((isEnabled) => { if (active) setEnabled(isEnabled) })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (enabled) {
        await unsubscribeFromWebPush("/api/push/subscriptions")
        setEnabled(false)
        toast.success("Notificaciones desactivadas")
      } else {
        await subscribeToWebPush("/api/push/subscriptions")
        setEnabled(true)
        toast.success("Notificaciones activadas", { description: "Te avisaremos cuando llegue un mensaje nuevo." })
      }
    } catch (error) {
      toast.error("No se pudieron actualizar las notificaciones", {
        description: error instanceof Error ? error.message : "Probá nuevamente desde el navegador.",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-label={enabled ? "Desactivar notificaciones" : "Activar notificaciones"}
      aria-pressed={enabled}
      title={enabled ? "Notificaciones activadas. Tocá para desactivar." : "Activar notificaciones push"}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-50"
    >
      {enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
    </button>
  )
}
