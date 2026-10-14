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
      title={enabled ? "Notificaciones activadas. Toca para desactivar." : "Activar notificaciones push"}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-[#013765]/45 hover:bg-[#e8f0f6] hover:text-[#013765] disabled:opacity-50"
    >
      {enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
    </button>
  )
}
