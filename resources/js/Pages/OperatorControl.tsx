import { useEffect, useMemo, useState } from "react"
import mqtt from "mqtt"
import { mqttWebSocketUrl } from "../lib/mqtt"
import { AppShell, AppShellBackButton } from "../Components/AppShell"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "shadcn/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "shadcn/components/ui/select"
import { cn } from "shadcn/lib/utils"
import { AlertTriangle, BarChart3, ChevronRight, CircleAlert, Clock3, Headset, MessageCircle, Pause, PauseCircle, Pencil, Play, Plus, RefreshCw, UserCheck, UserX, Users, XCircle } from "lucide-react"
import { Input } from "shadcn/components/ui/input"
import { toast } from "sonner"

type Availability = "available" | "paused" | "disconnected"
type Period = "today" | "week" | "month"
type Chat = { id: number; name: string; assigned_at?: string | null; last_contact_at?: string | null; waiting_response: boolean; waiting_minutes: number }
type MetricChat = { id: number; name: string; number?: string | null; channel?: string | null; closed_at?: string | null; attention_minutes: number | null; first_response_minutes: number | null }
type Metric = { closed: number; avg_attention_minutes: number | null; attention_samples: number; avg_first_response_minutes: number | null; first_response_samples: number; chat_samples: MetricChat[] }
type AssignmentSpecialty = { specialty_id: string; name: string; aliases: string[]; priority: number }
type Operator = { id: number; name: string; email: string; assignment_specialties: AssignmentSpecialty[]; availability: Availability; assigned_count: number; capacity: number; archived_today: number; unread_count: number; waiting_count: number; oldest_waiting_minutes: number; current_chat?: { id: number; name: string } | null; last_activity_at?: string | null; assigned_chats: Chat[]; period_metrics: Record<Period, Metric> }
type Snapshot = { operators: Operator[]; pendingCount: number; maxAssignedChats: number; availableSlots: number; canManageUsers?: boolean }
type TimelineEvent = { id: number; event: string; description: string; created_at?: string | null; chat_id?: number | null; chat_name?: string | null; chat_number?: string | null }
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

function minutes(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  if (value < 1) return "<1 min"
  return value < 60 ? `${value} min` : `${Math.floor(value / 60)} h ${value % 60} min`
}

function IconButton({ label, children, disabled, onClick, tone = "outline" }: { label: string; children: React.ReactNode; disabled?: boolean; onClick: () => void; tone?: "outline" | "primary" | "danger" }) {
  return <span className="group relative inline-flex"><Button size="icon" variant={tone === "outline" ? "outline" : "default"} aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cn("h-8 w-8", tone === "primary" && "bg-[#013765] text-white hover:bg-[#024a8a]", tone === "danger" && "bg-amber-600 text-white hover:bg-amber-700")} >{children}</Button><span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-xl border border-[#013765] bg-[#013765] px-2.5 py-1 text-[11px] font-medium text-white shadow-lg group-hover:block">{label}</span></span>
}

export default function OperatorControl({ operators: initialOperators, pendingCount, availableSlots: initialSlots = 0, canManageUsers: initialCanManageUsers = false }: Snapshot) {
  const [operators, setOperators] = useState(initialOperators)
  const [pending, setPending] = useState(pendingCount)
  const [availableSlots, setAvailableSlots] = useState(initialSlots)
  const [canManageUsers, setCanManageUsers] = useState(initialCanManageUsers)
  const [filter, setFilter] = useState<Filter>("all")
  const [period, setPeriod] = useState<Period>("today")
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Operator | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [loadingTimeline, setLoadingTimeline] = useState(false)
  const [reassignmentChat, setReassignmentChat] = useState<Chat | null>(null)
  const [reassignmentTarget, setReassignmentTarget] = useState("automatic")
  const [reassigning, setReassigning] = useState(false)
  const [specialtyDialogOperator, setSpecialtyDialogOperator] = useState<Operator | null>(null)
  const [specialties, setSpecialties] = useState<AssignmentSpecialty[]>([])
  const [specialtyDraft, setSpecialtyDraft] = useState({ specialty_id: "", name: "", aliases: "", priority: "1" })
  const [savingSpecialties, setSavingSpecialties] = useState(false)
  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.getAttribute("content")
  const refresh = async () => {
    const response = await fetch(`${API_BASE}/api/operator-control/snapshot`)
    if (!response.ok) return
    const data: Snapshot = await response.json()
    setOperators(data.operators ?? [])
    setPending(data.pendingCount ?? 0)
    setAvailableSlots(data.availableSlots ?? 0)
    setCanManageUsers(data.canManageUsers ?? false)
    setSelected((current) => current ? data.operators.find((item) => item.id === current.id) ?? null : null)
  }

  useEffect(() => {
    const brokerUrl = mqttWebSocketUrl()
    const polling = window.setInterval(() => void refresh(), 30000)
    if (!brokerUrl) return () => window.clearInterval(polling)
    const client = mqtt.connect(brokerUrl)
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

  const openSpecialtyEditor = (operator: Operator) => {
    setSpecialties(operator.assignment_specialties ?? [])
    setSpecialtyDraft({ specialty_id: "", name: "", aliases: "", priority: "1" })
    setSpecialtyDialogOperator(operator)
  }

  const addSpecialty = () => {
    const name = specialtyDraft.name.trim()
    if (!name) return
    const specialty: AssignmentSpecialty = {
      specialty_id: specialtyDraft.specialty_id.trim(),
      name,
      aliases: specialtyDraft.aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
      priority: Math.max(1, Math.min(10, Number(specialtyDraft.priority) || 1)),
    }
    setSpecialties((current) => [
      ...current.filter((item) => `${item.specialty_id}|${item.name}`.toLowerCase() !== `${specialty.specialty_id}|${specialty.name}`.toLowerCase()),
      specialty,
    ])
    setSpecialtyDraft({ specialty_id: "", name: "", aliases: "", priority: "1" })
  }

  const updateSpecialty = (index: number, patch: Partial<AssignmentSpecialty>) => {
    setSpecialties((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  const saveSpecialties = async () => {
    if (!specialtyDialogOperator) return
    setSavingSpecialties(true)
    try {
      const response = await fetch(`${API_BASE}/api/settings/users/${specialtyDialogOperator.id}/specialties`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(csrf() ? { "X-CSRF-TOKEN": csrf()! } : {}) },
        body: JSON.stringify({ assignment_specialties: specialties }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message ?? "No se pudieron guardar las especialidades.")
      const savedSpecialties = payload.assignment_specialties ?? specialties
      setOperators((current) => current.map((operator) => operator.id === specialtyDialogOperator.id ? { ...operator, assignment_specialties: savedSpecialties } : operator))
      setSelected((current) => current?.id === specialtyDialogOperator.id ? { ...current, assignment_specialties: savedSpecialties } : current)
      setSpecialtyDialogOperator(null)
      toast.success("Especialidades actualizadas")
    } catch (error) {
      toast.error("No se pudieron guardar las especialidades", { description: error instanceof Error ? error.message : undefined })
    } finally {
      setSavingSpecialties(false)
    }
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
    {selected ? <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30" onMouseDown={() => setSelected(null)}><aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><p className="text-xl font-bold text-[#013765]">{selected.name}</p><p className="text-sm text-slate-500">{selected.email} · {timeAgo(selected.last_activity_at)}</p></div><Button variant="outline" size="sm" onClick={() => setSelected(null)}>Cerrar</Button></div><div className="mt-5 flex gap-1">{([['today','Hoy'],['week','Semana'],['month','Mes']] as const).map(([key,label]) => <Button key={key} size="sm" variant={period === key ? "default" : "outline"} className={period === key ? "bg-[#013765]" : ""} onClick={() => setPeriod(key)}>{label}</Button>)}</div><div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-[#013765]">{selected.period_metrics[period]?.closed ?? 0}</p><p className="text-xs text-slate-500">Finalizados</p><p className="mt-1 text-[10px] text-slate-400">Chats cerrados</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-[#013765]">{minutes(selected.period_metrics[period]?.avg_first_response_minutes)}</p><p className="text-xs text-slate-500">1ª respuesta</p><p className="mt-1 text-[10px] text-slate-400">En {selected.period_metrics[period]?.first_response_samples ?? 0} chats</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-[#013765]">{minutes(selected.period_metrics[period]?.avg_attention_minutes)}</p><p className="text-xs text-slate-500">Atención media</p><p className="mt-1 text-[10px] text-slate-400">En {selected.period_metrics[period]?.attention_samples ?? 0} chats</p></div></div><details className="group mt-3 rounded-lg border border-slate-200"><summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-[#013765] marker:hidden">Conversaciones incluidas en las estadísticas <span className="text-slate-400">· últimos {Math.min(5, selected.period_metrics[period]?.closed ?? 0)} de {selected.period_metrics[period]?.closed ?? 0}</span></summary><div className="max-h-48 overflow-y-auto border-t border-slate-100 p-1.5">{selected.period_metrics[period]?.chat_samples?.length ? selected.period_metrics[period].chat_samples.map((chat) => <button key={chat.id} type="button" onClick={() => { window.location.href = `${import.meta.env.VITE_APP_URL}/chat-panel?chat=${chat.id}` }} className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition hover:bg-slate-50"><span className="min-w-0"><span className="block truncate text-xs font-medium text-[#013765]">{chat.name}</span><span className="block truncate text-[10px] text-slate-400">{chat.channel === "webchat" ? "Webchat" : chat.number ?? `Chat #${chat.id}`} · {timeAgo(chat.closed_at)}</span></span><span className="shrink-0 text-right text-[10px] text-slate-500">1ª resp. {minutes(chat.first_response_minutes)}<br />Atención {minutes(chat.attention_minutes)}</span><ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#185e9c]" /></button>) : <p className="px-2 py-3 text-xs text-slate-500">No hay chats finalizados en este período.</p>}</div></details><section className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="font-semibold text-[#013765]">Especialidades para derivación</h3><p className="mt-1 text-xs text-slate-500">La prioridad 1 es la más alta; los empates se resuelven por menor carga.</p></div>
        {canManageUsers ? <Button type="button" size="sm" variant="outline" onClick={() => openSpecialtyEditor(selected)}><Pencil className="mr-2 h-3.5 w-3.5" />Editar</Button> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {selected.assignment_specialties?.length ? selected.assignment_specialties.map((specialty, index) => <div key={`${specialty.specialty_id}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-sm font-medium text-[#013765]">{specialty.name}{specialty.specialty_id ? <span className="ml-1 text-xs font-normal text-slate-500">· ID {specialty.specialty_id}</span> : null}</p>
          <p className="text-xs text-slate-500">Prioridad {specialty.priority}{specialty.aliases?.length ? ` · Alias: ${specialty.aliases.join(", ")}` : ""}</p>
        </div>) : <p className="w-full rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Sin especialidades configuradas.</p>}
      </div>
    </section>
    <section className="mt-6">
      <h3 className="flex items-center gap-2 font-semibold text-[#013765]"><Headset className="h-4 w-4" />Chats asignados ({selected.assigned_chats.length})</h3>
      <div className="mt-2 space-y-2">
        {selected.assigned_chats.length ? selected.assigned_chats.sort((a,b) => Number(b.waiting_response) - Number(a.waiting_response) || b.waiting_minutes - a.waiting_minutes).map((chat) => <div key={chat.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><button type="button" className="min-w-0 text-left" onClick={() => { window.location.href = `${import.meta.env.VITE_APP_URL}/chat-panel?chat=${chat.id}` }}><p className="truncate text-sm font-medium text-[#013765]">{chat.name}</p><p className={cn("text-xs", chat.waiting_response ? "text-amber-700" : "text-slate-500")}>{chat.waiting_response ? `Esperando respuesta · ${minutes(chat.waiting_minutes)}` : "Sin espera de respuesta"}</p></button><IconButton label="Reasignar chat" onClick={() => { setReassignmentTarget("automatic"); setReassignmentChat(chat) }}><RefreshCw className="h-4 w-4" /></IconButton></div>) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No tiene chats asignados.</p>}
      </div>
    </section>
    <section className="mt-6">
      <h3 className="flex items-center gap-2 font-semibold text-[#013765]"><BarChart3 className="h-4 w-4" />Actividad reciente</h3>
      <div className="mt-2 space-y-2">
        {loadingTimeline ? <p className="text-sm text-slate-500">Cargando historial…</p> : timeline.length ? timeline.map((event) => (
          <div key={event.id} className="border-l-2 border-slate-200 pl-3">
            {event.chat_id ? (
              <button
                type="button"
                aria-label={`Abrir chat ${event.chat_name ?? event.chat_id}`}
                onClick={() => { window.location.href = `${import.meta.env.VITE_APP_URL}/chat-panel?chat=${event.chat_id}` }}
                className="w-full rounded-r-md py-0.5 text-left transition hover:bg-slate-50"
              >
                <p className="text-sm text-slate-700">{event.description}</p>
                <p className="mt-0.5 truncate text-xs font-medium text-[#185e9c]">{event.chat_name ?? `Chat #${event.chat_id}`}{event.chat_number ? ` · ${event.chat_number}` : ` · #${event.chat_id}`}</p>
                <p className="text-xs text-slate-400">{timeAgo(event.created_at)}</p>
              </button>
            ) : (
              <div className="py-0.5">
                <p className="text-sm text-slate-700">{event.description}</p>
                <p className="text-xs text-slate-400">{timeAgo(event.created_at)}</p>
              </div>
            )}
          </div>
        )) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Sin actividad auditada reciente.</p>}
      </div>
    </section></aside></div> : null}
    <Dialog open={Boolean(specialtyDialogOperator)} onOpenChange={(open) => { if (!open && !savingSpecialties) setSpecialtyDialogOperator(null) }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[#013765]">Especialidades para derivación</DialogTitle>
          <DialogDescription>{specialtyDialogOperator?.name}. Agregá especialidades, alias e ID de Alephoo. La prioridad 1 es la más alta; también se reconocen prefijos desde 4 letras. Usá alias para sinónimos.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {specialties.map((specialty, index) => <div key={`${specialty.specialty_id}-${index}`} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[minmax(120px,1fr)_minmax(100px,0.8fr)_minmax(130px,1.2fr)_80px_40px] sm:items-end">
            <div className="space-y-1"><label className="text-[10px] font-medium text-slate-500">Especialidad</label><Input value={specialty.name} onChange={(event) => updateSpecialty(index, { name: event.target.value })} placeholder="Ej. Dermatología" className="h-9 text-xs" /></div>
            <div className="space-y-1"><label className="text-[10px] font-medium text-slate-500">ID Alephoo</label><Input value={specialty.specialty_id} onChange={(event) => updateSpecialty(index, { specialty_id: event.target.value })} placeholder="Opcional" className="h-9 text-xs" /></div>
            <div className="space-y-1"><label className="text-[10px] font-medium text-slate-500">Alias separados por coma</label><Input value={specialty.aliases.join(", ")} onChange={(event) => updateSpecialty(index, { aliases: event.target.value.split(",").map((alias) => alias.trim()).filter(Boolean) })} placeholder="derma, piel" className="h-9 text-xs" /></div>
            <label className="space-y-1 text-[10px] font-medium text-slate-500">Prioridad<Input type="number" min={1} max={10} value={specialty.priority} onChange={(event) => updateSpecialty(index, { priority: Math.max(1, Math.min(10, Number(event.target.value) || 1)) })} className="h-9 text-xs" /></label>
            <Button type="button" variant="outline" size="icon" title="Quitar especialidad" onClick={() => setSpecialties((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="h-9 w-9 text-slate-500"><XCircle className="h-4 w-4" /></Button>
          </div>)}
          <div className="grid gap-2 rounded-lg border border-dashed border-slate-300 p-3 sm:grid-cols-[minmax(120px,1fr)_minmax(100px,0.8fr)_minmax(130px,1.2fr)_80px_auto] sm:items-end">
            <div className="space-y-1"><label className="text-[10px] font-medium text-slate-500">Especialidad</label><Input value={specialtyDraft.name} onChange={(event) => setSpecialtyDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. Dermatología" className="h-9 text-xs" /></div>
            <div className="space-y-1"><label className="text-[10px] font-medium text-slate-500">ID Alephoo</label><Input value={specialtyDraft.specialty_id} onChange={(event) => setSpecialtyDraft((current) => ({ ...current, specialty_id: event.target.value }))} placeholder="Opcional" className="h-9 text-xs" /></div>
            <div className="space-y-1"><label className="text-[10px] font-medium text-slate-500">Alias separados por coma</label><Input value={specialtyDraft.aliases} onChange={(event) => setSpecialtyDraft((current) => ({ ...current, aliases: event.target.value }))} placeholder="derma, piel" className="h-9 text-xs" /></div>
            <div className="space-y-1"><label className="text-[10px] font-medium text-slate-500">Prioridad</label><Input type="number" min={1} max={10} value={specialtyDraft.priority} onChange={(event) => setSpecialtyDraft((current) => ({ ...current, priority: event.target.value }))} className="h-9 text-xs" /></div>
            <Button type="button" variant="outline" onClick={addSpecialty} disabled={!specialtyDraft.name.trim()} className="h-9 border-[#cbd8e5] text-[#013765]"><Plus className="mr-1.5 h-3.5 w-3.5" />Agregar</Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setSpecialtyDialogOperator(null)} disabled={savingSpecialties}>Cancelar</Button>
          <Button type="button" className="bg-[#013765] text-white hover:bg-[#024a8a]" onClick={() => void saveSpecialties()} disabled={savingSpecialties}>{savingSpecialties ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
