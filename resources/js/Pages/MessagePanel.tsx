import { usePage } from "@inertiajs/react"
import { CircleCheck, PauseCircle } from "lucide-react"
import { useState } from "react"

import { AppShell, AppShellBackButton } from "../Components/AppShell"
import { ChatPanel } from "./Chat/ChatPanel"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "shadcn/components/ui/select"

type Availability = "available" | "paused"

const statusOptions: Record<Availability, { label: string; icon: typeof CircleCheck; className: string }> = {
  available: { label: "Disponible", icon: CircleCheck, className: "text-emerald-300" },
  paused: { label: "Pausado", icon: PauseCircle, className: "text-amber-300" },
}

function OperatorStatusSelect() {
  const { props } = usePage<{ auth?: { user?: { role_name?: string; operator_availability?: Availability } } }>()
  const user = props.auth?.user
  const [availability, setAvailability] = useState<Availability>(user?.operator_availability ?? "available")
  const [saving, setSaving] = useState(false)
  if (!["operator", "admin"].includes(user?.role_name ?? "")) return null

  const changeAvailability = async (value: Availability) => {
    setSaving(true)
    try {
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content")
      const response = await fetch(`${import.meta.env.VITE_APP_URL}/api/operators/me/availability`, { method: "POST", headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-TOKEN": csrfToken } : {}) }, body: JSON.stringify({ availability: value }) })
      if (!response.ok) throw new Error()
      setAvailability(value)
    } finally { setSaving(false) }
  }

  return <Select value={availability} onValueChange={(value) => void changeAvailability(value as Availability)} disabled={saving}><SelectTrigger className="h-9 w-44 border-white/20 bg-white/10 text-sm text-white hover:bg-white/15"><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(statusOptions) as Availability[]).map((value) => { const option = statusOptions[value]; const Icon = option.icon; return <SelectItem key={value} value={value}><span className="flex items-center gap-2"><Icon className={`h-4 w-4 ${option.className.replace("300", "600")}`} />{option.label}</span></SelectItem> })}</SelectContent></Select>
}

export default function MessagePanel() {
  const { props } = usePage<{ chats?: any[] }>()
  const chats = props.chats || []

  return (
    <AppShell
      currentPath="/chat-panel"
      title="Panel de Mensajes"
      subtitle="Atencion en tiempo real de conversaciones y derivaciones."
      leading={<AppShellBackButton onClick={() => (window.location.href = `${import.meta.env.VITE_APP_URL}/dashboard`)} />}
      actions={<OperatorStatusSelect />}
      contentClassName="flex-1 min-h-0 p-0"
      fullHeight
    >
      <ChatPanel chats={chats} />
    </AppShell>
  )
}
