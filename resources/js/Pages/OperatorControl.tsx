import { useEffect, useMemo, useState } from "react"
import mqtt from "mqtt"
import { AppShell, AppShellBackButton } from "../components/AppShell"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "shadcn/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "shadcn/components/ui/select"
import { cn } from "shadcn/lib/utils"
import { AlertTriangle, BarChart3, ChevronRight, CircleAlert, Clock3, Headset, MessageCircle, Pause, PauseCircle, Play, RefreshCw, UserCheck, UserX, Users } from "lucide-react"
import { toast } from "sonner"

type Availability = "available" | "paused" | "disconnected"
type Period = "today" | "week" | "month"
type Chat = { id: number; name: string; assigned_at?: string | null; last_contact_at?: string | null; waiting_response: boolean; waiting_minutes: number }
type Metric = { closed: number; avg_attention_minutes: number; avg_first_response_minutes: number }
type Operator = { id: number; name: string; email: string; availability: Availability; assigned_count: number; capacity: number; archived_today: number; unread_count: number; waiting_count: number; oldest_waiting_minutes: number; current_chat?: { id: number; name: string } | null; last_activity_at?: string | null; assigned_chats: Chat[]; period_metrics: Record<Period, Metric> }
type Snapshot = { operators: Operator[]; pendingCount: number; maxAssignedChats: number; availableSlots: number }
type TimelineEvent = { id: number; event: string; description: string; created_at?: string | null }
type Filter = "all" | "available" | "paused" | "full" | "attention" | "inactive"

const API_BASE = import.meta.env.VITE_API_BASE_URL || ""
const states: Record<Availability, { label: string; className: string }> = {
  available: { label: "Disponible", className: "bg-emerald-50 text-emerald-700 hover:bg-emerald-50" },
  paused: { label: "Pausado", className: "bg-amber-50 text-amber-800 hover:bg-amber-50" },
  disconnected: { label: "Desconectado", className: "bg-red-50 text-red-700 hover:bg-red-50" },
}

function timeAgo(value?: string | null) {
  if (!value) return "Sin actividad registrada"
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return "Ahora"
  if (minutes < 60) return `Hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `Hace ${hours} h` : `Hace ${Math.floor(hours / 24)} d`
}

function minutes(value: number) {
  if (!value) return "—"
  return value < 60 ? `${value} min` : `${Math.floor(value / 60)} h ${value % 60} min`
}

function IconButton({ label, children, disabled, onClick, tone = "outline" }: { label: string; children: React.ReactNode; disabled?: boolean; onClick: () => void; tone?: "outline" | "primary" | "danger" }) {
  return <span className="group relative inline-flex"><Button size="icon" variant={tone === "outline" ? "outline" : "default"} aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cn("h-8 w-8", tone === "primary" && "bg-[#013765] text-white hover:bg-[#024a8a]", tone === "danger" && "bg-amber-600 text-white hover:bg-amber-700")} >{children}</Button><span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-xl border border-[#013765] bg-[#013765] px-2.5 py-1 text-[11px] font-medium text-white shadow-lg group-hover:block">{label}</span></span>
}

export default function OperatorControl({ operators: initialOperators, pendingCount, availableSlots: initialSlots = 0 }: Snapshot) {
  const [operators, setOperators] = useState(initialOperators)
  const [pending, setPending] = useState(pendingCount)
  const [availableSlots, setAvailableSlots] = useState(initialSlots)
  const [filter, setFilter] = useState<Filter>("all")
  const [period, setPeriod] = useState<Period>("today")
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Operator | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [loadingTimeline, setLoadingTimeline] = useState(false)
  const [reassignmentChat, setReassignmentChat] = useState<Chat | null>(null)
  const [reassignmentTarget, setReassignmentTarget] = useState("automatic")
  const [reassigning, setReassigning] = useState(false)
  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.getAttribute("content")
  const refresh = async () => {
    const response = await fetch(`${API_BASE}/api/operator-control/snapshot`)
    if (!response.ok) return
    const data: Snapshot = await response.json()
    setOperators(data.operators ?? [])
    setPending(data.pendingCount ?? 0)
    setAvailableSlots(data.availableSlots ?? 0)
    setSelected((current) => current ? data.operators.find((item) => item.id === current.id) ?? null : null)
  }

  useEffect(() => {
    const host = import.meta.env.VITE_MOSQUITTO_HOST
    const polling = window.setInterval(() => void refresh(), 30000)
    if (!host) return () => window.clearInterval(polling)
    const client = mqtt.connect(`ws://${host}:9001`)
    let timer: number | undefined
    client.on("connect", () => client.subscribe("operator-control/update"))
    client.on("message", () => { window.clearTimeout(timer); timer = window.setTimeout(() => void refresh(), 150) })
    return () => { window.clearTimeout(timer); window.clearInterval(polling); client.end(true) }
  }, [])

  const toggleAssignment = async (operator: Operator) => {
    if (operator.availability === "disconnected") return
    const availability: Availability = operator.availability === "available" ? "paused" : "available"
    setUpdatingId(operator.id)
    try {
      const response = await fetch(`${API_BASE}/api/operators/${operator.id}/availability`, { method: "PUT", headers: { "Content-Type": "application/json", ...(csrf() ? { "X-CSRF-TOKEN": csrf()! } : {}) }, body: JSON.stringify({ availability }) })
      if (!response.ok) throw new Error()
      await refresh()
      toast.success(availability === "paused" ? "Asignación pausada" : "Asignación reanudada")
    } catch { toast.error("No se pudo actualizar la asignación") } finally { setUpdatingId(null) }
  }

  const openDetail = async (operator: Operator) => {
    setSelected(operator); setTimeline([]); setLoadingTimeline(true)
    try { const res = await fetch(`${API_BASE}/api/operator-control/operators/${operator.id}/timeline`); if (res.ok) setTimeline((await res.json()).events ?? []) } finally { setLoadingTimeline(false) }
  }

  const submitReassignment = async () => {
    if (!reassignmentChat) return
    setReassigning(true)
    try {
      const automatic = reassignmentTarget === "automatic"
      const res = await fetch(`${API_BASE}/api/operators/chats/${reassignmentChat.id}/reassign`, { method: "POST", headers: { "Content-Type": "application/json", ...(csrf() ? { "X-CSRF-TOKEN": csrf()! } : {}) }, body: JSON.stringify(automatic ? { automatic: true } : { operator_id: Number(reassignmentTarget) }) })
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.message) }
      const data = await res.json()
      toast.success(data.pending ? "Sin cupo disponible: el chat quedó pendiente de asignación automática" : "Chat reasignado")
      setReassignmentChat(null); await refresh()
    } catch (error) { toast.error(error instanceof Error && error.message ? error.message : "No se pudo reasignar el chat") } finally { setReassigning(false) }
  }

  const now = Date.now()
  const inactive = (operator: Operator) => !operator.last_activity_at || now - new Date(operator.last_activity_at).getTime() > 10 * 60 * 1000
  const visibleOperators = useMemo(() => operators.filter((operator) => filter === "all" || (filter === "available" && operator.availability === "available") || (filter === "paused" && operator.availability === "paused") || (filter === "full" && operator.assigned_count >= operator.capacity) || (filter === "attention" && (operator.waiting_count > 0 || operator.unread_count > 0)) || (filter === "inactive" && inactive(operator))), [operators, filter])
  const counts = { available: operators.filter((item) => item.availability === "available").length, paused: operators.filter((item) => item.availability === "paused").length, disconnected: operators.filter((item) => item.availability === "disconnected").length, full: operators.filter((item) => item.assigned_count >= item.capacity).length, attention: operators.filter((item) => item.waiting_count || item.unread_count).length }
  const alerts = [pending > availableSlots ? { text: `La cola supera la capacidad libre por ${pending - availableSlots} chats.`, tone: "text-red-700 bg-red-50" } : null, ...operators.filter((item) => item.waiting_count > 0).map((item) => ({ text: `${item.name}: ${item.waiting_count} chat(s) esperando respuesta${item.oldest_waiting_minutes ? ` · el más antiguo hace ${minutes(item.oldest_waiting_minutes)}` : ""}.`, tone: "text-amber-800 bg-amber-50" }))].filter(Boolean) as { text: string; tone: string }[]

  return <AppShell currentPath="/operator-control" title="Control de operadores" subtitle="Supervisión de disponibilidad, carga y atención en curso." leading={<AppShellBackButton onClick={() => { window.location.href = `${import.meta.env.VITE_APP_URL}/dashboard` }} />} contentClassName="px-4 py-5 lg:px-6 lg:py-6" actions={<Button variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => void refresh()}><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button>}>
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Card><CardContent className="flex items-center gap-3 p-4"><Users className="h-10 w-10 rounded-xl bg-[#eaf2f8] p-2 text-[#185e9c]" /><div><p className="text-2xl font-bold text-[#013765]">{availableSlots}</p><p className="text-sm text-slate-600">Cupos libres</p></div></CardContent></Card><Card><CardContent className="flex items-center gap-3 p-4"><Headset className="h-10 w-10 rounded-xl bg-sky-50 p-2 text-sky-700" /><div><p className="text-2xl font-bold text-[#013765]">{operators.reduce((total, operator) => total + operator.assigned_count, 0)}</p><p className="text-sm text-slate-600">Chats asignados</p></div></CardContent></Card><Card><CardContent className="flex items-center gap-3 p-4"><PauseCircle className="h-10 w-10 rounded-xl bg-amber-50 p-2 text-amber-700" /><div><p className="text-2xl font-bold text-[#013765]">{pending}</p><p className="text-sm text-slate-600">En chats cola</p></div></CardContent></Card></section>
    <section className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="flex items-center gap-2 border-r border-slate-200 pr-5"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eaf2f8] text-[#185e9c]"><Users className="h-4 w-4" /></div><span className="text-sm font-semibold text-[#013765]">Estado del equipo</span></div><div className="flex items-center gap-2 text-sm text-slate-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /><strong className="text-[#013765]">{counts.available}</strong> disponibles</div><div className="flex items-center gap-2 text-sm text-slate-600"><span className="h-2 w-2 rounded-full bg-amber-500" /><strong className="text-[#013765]">{counts.paused}</strong> pausados</div><div className="flex items-center gap-2 text-sm text-slate-600"><span className="h-2 w-2 rounded-full bg-red-500" /><strong className="text-[#013765]">{counts.disconnected}</strong> desconectados</div><div className="flex items-center gap-2 text-sm text-slate-600"><span className="h-2 w-2 rounded-full bg-[#185e9c]" /><strong className="text-[#013765]">{counts.full}</strong> con cupo completo</div></section>
    <section className="mt-6"><Card className="border-slate-200"><CardHeader className="border-b border-slate-100 pb-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-[#013765]">Equipo de atención</CardTitle><CardDescription>Estado operativo y carga actual por operador.</CardDescription></div><div className="flex flex-wrap gap-1">{([['all','Todos'],['available','Disponibles'],['paused','Pausados'],['full','Cupo completo'],['attention','Sin responder'],['inactive','Inactivos']] as const).map(([key,label]) => <Button key={key} size="sm" variant={filter === key ? "default" : "outline"} className={cn("h-7 text-xs", filter === key && "bg-[#013765]")} onClick={() => setFilter(key)}>{label}</Button>)}</div></div></CardHeader><CardContent className="p-0"><div className="hidden grid-cols-[minmax(190px,1.3fr)_110px_120px_115px] gap-3 border-b bg-slate-50 px-5 py-3 text-xs font-medium text-slate-500 md:grid"><span>Operador</span><span>Estado</span><span>Carga</span><span>Acciones</span></div>{visibleOperators.map((operator) => { const AssignmentIcon = operator.availability === "paused" ? Play : Pause; const assignmentLabel = operator.availability === "disconnected" ? "Operador desconectado" : operator.availability === "available" ? "Pausar asignación" : "Reanudar asignación"; return <div key={operator.id} className="grid gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0 md:grid-cols-[minmax(190px,1.3fr)_110px_120px_115px] md:items-center md:gap-3 md:px-5"><button type="button" onClick={() => void openDetail(operator)} className="min-w-0 text-left"><p className="truncate text-sm font-semibold text-[#013765]">{operator.name}</p><p className="truncate text-xs text-slate-500">{operator.email}</p></button><div><Badge className={states[operator.availability].className}>{states[operator.availability].label}</Badge></div><div><p className="text-sm font-semibold text-[#013765]">{operator.assigned_count} <span className="font-normal text-slate-400">/ {operator.capacity}</span></p><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full", operator.assigned_count >= operator.capacity ? "bg-amber-500" : "bg-[#2b5f90]")} style={{ width: `${Math.min(100, Math.round(operator.assigned_count / Math.max(operator.capacity, 1) * 100))}%` }} /></div></div><div className="flex gap-1"><IconButton label={assignmentLabel} disabled={operator.availability === "disconnected" || updatingId === operator.id} onClick={() => void toggleAssignment(operator)}><AssignmentIcon className="h-4 w-4" /></IconButton><IconButton label={operator.current_chat ? "Ir a conversación actual" : "Sin conversación activa"} tone="primary" disabled={!operator.current_chat} onClick={() => { if (operator.current_chat) window.location.href = `${import.meta.env.VITE_APP_URL}/chat-panel?chat=${operator.current_chat.id}` }}><MessageCircle className="h-4 w-4" /></IconButton><IconButton label="Ver detalle" onClick={() => void openDetail(operator)}><ChevronRight className="h-4 w-4" /></IconButton></div></div> })}{!visibleOperators.length ? <div className="p-10 text-center text-sm text-slate-500"><UserX className="mx-auto mb-2 h-7 w-7 text-slate-300" />No hay operadores para este filtro.</div> : null}</CardContent></Card>
    </section>
    {selected ? <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30" onMouseDown={() => setSelected(null)}><aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><p className="text-xl font-bold text-[#013765]">{selected.name}</p><p className="text-sm text-slate-500">{selected.email} · {timeAgo(selected.last_activity_at)}</p></div><Button variant="outline" size="sm" onClick={() => setSelected(null)}>Cerrar</Button></div><div className="mt-5 flex gap-1">{([['today','Hoy'],['week','Semana'],['month','Mes']] as const).map(([key,label]) => <Button key={key} size="sm" variant={period === key ? "default" : "outline"} className={period === key ? "bg-[#013765]" : ""} onClick={() => setPeriod(key)}>{label}</Button>)}</div><div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-[#013765]">{selected.period_metrics[period]?.closed ?? 0}</p><p className="text-xs text-slate-500">Finalizados</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-[#013765]">{minutes(selected.period_metrics[period]?.avg_first_response_minutes ?? 0)}</p><p className="text-xs text-slate-500">1ª respuesta</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-[#013765]">{minutes(selected.period_metrics[period]?.avg_attention_minutes ?? 0)}</p><p className="text-xs text-slate-500">Atención media</p></div></div><section className="mt-6"><h3 className="flex items-center gap-2 font-semibold text-[#013765]"><Headset className="h-4 w-4" />Chats asignados ({selected.assigned_chats.length})</h3><div className="mt-2 space-y-2">{selected.assigned_chats.length ? selected.assigned_chats.sort((a,b) => Number(b.waiting_response) - Number(a.waiting_response) || b.waiting_minutes - a.waiting_minutes).map((chat) => <div key={chat.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><button type="button" className="min-w-0 text-left" onClick={() => { window.location.href = `${import.meta.env.VITE_APP_URL}/chat-panel?chat=${chat.id}` }}><p className="truncate text-sm font-medium text-[#013765]">{chat.name}</p><p className={cn("text-xs", chat.waiting_response ? "text-amber-700" : "text-slate-500")}>{chat.waiting_response ? `Esperando respuesta · ${minutes(chat.waiting_minutes)}` : "Sin espera de respuesta"}</p></button><IconButton label="Reasignar chat" onClick={() => { setReassignmentTarget("automatic"); setReassignmentChat(chat) }}><RefreshCw className="h-4 w-4" /></IconButton></div>) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No tiene chats asignados.</p>}</div></section><section className="mt-6"><h3 className="flex items-center gap-2 font-semibold text-[#013765]"><BarChart3 className="h-4 w-4" />Actividad reciente</h3><div className="mt-2 space-y-2">{loadingTimeline ? <p className="text-sm text-slate-500">Cargando historial…</p> : timeline.length ? timeline.map((event) => <div key={event.id} className="border-l-2 border-slate-200 pl-3"><p className="text-sm text-slate-700">{event.description}</p><p className="text-xs text-slate-400">{timeAgo(event.created_at)}</p></div>) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Sin actividad auditada reciente.</p>}</div></section></aside></div> : null}
    <Dialog open={Boolean(reassignmentChat)} onOpenChange={(open) => { if (!open && !reassigning) setReassignmentChat(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#013765]">Reasignar conversación</DialogTitle>
          <DialogDescription>Elegí un operador con cupo o delegá la decisión al asignador automático.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{reassignmentChat?.name}</p>
          <Select value={reassignmentTarget} onValueChange={setReassignmentTarget} disabled={reassigning}>
            <SelectTrigger><SelectValue placeholder="Seleccioná una opción" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="automatic">Asignación automática</SelectItem>
              {operators.map((operator) => <SelectItem key={operator.id} value={String(operator.id)} disabled={operator.availability !== "available" || operator.assigned_count >= operator.capacity}>{operator.name} · {operator.assigned_count}/{operator.capacity}{operator.availability !== "available" ? " · no disponible" : operator.assigned_count >= operator.capacity ? " · sin cupo" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500">Si elegís asignación automática, se usa el mismo criterio de menor carga. Sin cupo disponible, el chat queda pendiente hasta que se libere uno.</p>
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setReassignmentChat(null)} disabled={reassigning}>Cancelar</Button><Button className="bg-[#013765] hover:bg-[#024a8a]" onClick={() => void submitReassignment()} disabled={reassigning}>{reassigning ? "Reasignando…" : "Confirmar reasignación"}</Button></div>
      </DialogContent>
    </Dialog>
  </AppShell>
}
