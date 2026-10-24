import { router, usePage } from "@inertiajs/react"
import { useState } from "react"
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  GitBranch,
  HeartPulse,
  Inbox,
  Megaphone,
  MessageSquare,
  Minus,
  Settings,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { TooltipContentProps } from "recharts"

import { AppShell } from "../Components/AppShell"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"

const APP_URL = import.meta.env.VITE_APP_URL || ""

type SummaryCard = {
  key: string
  label: string
  value: string
  raw_value: number | null
  delta: number | null
  delta_direction: "positive" | "negative" | "neutral"
  description: string
}

type ActivityPoint = {
  date: string
  label: string
  incoming_whatsapp: number
  incoming_webchat: number
  bot_whatsapp: number
  operator_whatsapp: number
  campaign_whatsapp: number
  bot_webchat: number
  operator_webchat: number
  campaign_webchat: number
}

type ActivityKey =
  | "incoming_whatsapp"
  | "incoming_webchat"
  | "bot"
  | "operator"
  | "campaign"
  | "bot_whatsapp"
  | "operator_whatsapp"
  | "campaign_whatsapp"
  | "bot_webchat"
  | "operator_webchat"
  | "campaign_webchat"

type DashboardProps = {
  auth?: {
    user?: { name?: string | null; role_name?: string | null } | null
    permissions?: Record<string, boolean>
  }
  period: { days: number; label: string; start: string; end: string }
  webchat_conversion: {
    received_contacts: number
    entered_contacts: number
    unentered_contacts: number
    rate: number | null
  }
  summary: SummaryCard[]
  message_activity: ActivityPoint[]
  work_queue: {
    total: number
    unread_chats: number
    unread_messages: number
    items: Array<{
      id: number
      name: string
      phone?: string | null
      avatar?: string | null
      message: string
      message_at_human?: string | null
      channel: "whatsapp" | "webchat" | string
      operator_name?: string | null
      bot_enabled: boolean
      unread_count: number
    }>
  }
  bot: {
    enabled_chats: number
    paused_chats: number
    active_flows: number
    handoffs: number
    inactivity_resets: number
  }
  campaigns?: {
    sent: number
    delivered: number
    read: number
    failed: number
    active_count: number
    delivery_rate: number
    read_rate: number
    recent: Array<{
      id: number
      name: string
      status: string
      template?: string | null
      sent: number
      read: number
      failed: number
      created_at_human?: string | null
    }>
  } | null
  recent_activity: Array<{
    id: number
    scope?: string | null
    event?: string | null
    description: string
    causer_name?: string | null
    created_at_human?: string | null
  }>
  system_health?: Array<{
    key: string
    label: string
    status: "ok" | "warning" | "neutral"
    detail: string
  }> | null
  chat_snapshot: {
    open_total: number
    whatsapp: number
    webchat: number
    bot: number
    assigned: number
    pending_assignment: number
    archived: number
  }
  operations?: {
    appointments_created: number
    appointments_cancelled: number
    patients_created: number
    errors: number
  } | null
  alerts: Array<{
    severity: "warning" | "info"
    title: string
    detail: string
    path: string
  }>
}

const summaryIcons = {
  active_chats: Users,
  incoming_messages: MessageSquare,
  pending_chats: Inbox,
  response_time: Clock3,
}

const activityColors: Record<ActivityKey, string> = {
  incoming_whatsapp: "Recibidos WhatsApp",
  incoming_webchat: "Recibidos Webchat",
  bot: "#10b981",
  operator: "#f59e0b",
  campaign: "#8b5cf6",
  bot_whatsapp: "#10b981",
  operator_whatsapp: "#f59e0b",
  campaign_whatsapp: "#8b5cf6",
  bot_webchat: "#10b981",
  operator_webchat: "#f59e0b",
  campaign_webchat: "#8b5cf6",
}

const activityLabels: Record<ActivityKey, string> = {
  incoming_whatsapp: "Recibidos WhatsApp",
  incoming_webchat: "Recibidos Webchat",
  bot: "Bot",
  operator: "Operadores",
  campaign: "Campa\u00f1as",
  bot_whatsapp: "Bot",
  operator_whatsapp: "Operadores",
  campaign_whatsapp: "Campa\u00f1as",
  bot_webchat: "Bot",
  operator_webchat: "Operadores",
  campaign_webchat: "Campa\u00f1as",
}

function navigateTo(path: string) {
  window.location.href = `${APP_URL}${path}`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-AR").format(value)
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(year, month - 1, day))
}

function Trend({ card }: { card: SummaryCard }) {
  if (card.delta === null) {
    return <span className="text-slate-500">Sin período anterior comparable</span>
  }

  const Icon = card.delta > 0 ? ArrowUpRight : card.delta < 0 ? ArrowDownRight : Minus
  const color = card.delta_direction === "positive" ? "text-emerald-700" : card.delta_direction === "negative" ? "text-rose-700" : "text-slate-500"

  return (
    <span className={`inline-flex items-center gap-1 ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {card.delta > 0 ? "+" : ""}{card.delta}% frente al período anterior
    </span>
  )
}

function ActivityTooltip({ active, payload, label, keys }: Pick<Partial<TooltipContentProps<number, string>>, "active" | "payload" | "label"> & { keys: ActivityKey[] }) {
  const point = payload?.[0]?.payload as (ActivityPoint & Partial<Record<ActivityKey, number>>) | undefined

  if (!active || !point) return null

  const total = keys.reduce((sum, key) => sum + Number(point[key] ?? 0), 0)

  return (
    <div className="min-w-44 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-lg">
      <p className="mb-2 text-xs font-semibold text-slate-700">{typeof label === "string" ? formatDate(point.date) : label}</p>
      <div className="space-y-1.5">
        {keys.map((key) => (
          <div key={key} className="flex items-center justify-between gap-5 text-xs">
            <span className="flex items-center gap-2 text-slate-600"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: activityColors[key] }} />{activityLabels[key]}</span>
            <span className="font-semibold tabular-nums text-slate-800">{formatNumber(Number(point[key] ?? 0))}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-xs font-semibold text-slate-800">
        <span>Total</span><span className="tabular-nums">{formatNumber(total)}</span>
      </div>
    </div>
  )
}

function MessageActivityChart({ points }: { points: ActivityPoint[] }) {
  const [channel, setChannel] = useState<"all" | "whatsapp" | "webchat">("all")
  const keys: ActivityKey[] = channel === "all"
    ? ["incoming_whatsapp", "incoming_webchat", "bot", "operator", "campaign"]
    : [
      ("incoming_" + channel) as ActivityKey,
      ("bot_" + channel) as ActivityKey,
      ("operator_" + channel) as ActivityKey,
      ("campaign_" + channel) as ActivityKey,
    ]
  const chartPoints = points.map((point) => ({
    ...point,
    bot: point.bot_whatsapp + point.bot_webchat,
    operator: point.operator_whatsapp + point.operator_webchat,
    campaign: point.campaign_whatsapp + point.campaign_webchat,
  }))

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {keys.map((key) => (
            <div key={key} className="flex items-center gap-2 text-xs text-slate-600">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: activityColors[key] }} />
              {activityLabels[key]}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Canal</span>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Filtrar actividad por canal">
            {([
              ["all", "Todos"],
              ["whatsapp", "WhatsApp"],
              ["webchat", "Webchat"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={channel === value}
                onClick={() => setChannel(value)}
                className={"rounded-md px-2.5 py-1.5 text-xs font-medium transition " + (channel === value ? "bg-white text-[#013765] shadow-sm" : "text-slate-600 hover:text-slate-900")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="h-64 min-w-[620px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={14} />
              <YAxis allowDecimals={false} width={42} tickFormatter={(value) => formatNumber(Number(value))} tick={{ fill: "#94a3b8", fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<ActivityTooltip keys={keys} />} cursor={{ fill: "#f8fafc" }} />
              {keys.map((key) => (
                <Bar key={key} dataKey={key} name={activityLabels[key]} stackId="messages" fill={activityColors[key]} maxBarSize={24} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { props } = usePage<DashboardProps>()
  const userName = props.auth?.user?.name?.trim() || "usuario"
  const permissions = props.auth?.permissions ?? {}

  const quickActions = [
    { label: "Abrir mensajes", path: "/chat-panel", icon: MessageSquare },
    { label: "Gestionar campañas", path: "/campaigns-panel", icon: Megaphone, permission: "can_manage_campaigns" },
    { label: "Administrar flujos", path: "/bot/flows", icon: GitBranch, permission: "can_view_flows" },
    { label: "Configuración", path: "/settings-panel", icon: Settings, permission: "can_manage_settings" },
    { label: "Ver auditoría", path: "/audit-panel", icon: ShieldCheck, permission: "can_view_audit" },
  ].filter((action) => !action.permission || permissions[action.permission])

  return (
    <AppShell
      currentPath="/dashboard"
      title="Centro de operaciones"
      subtitle={`Hola, ${userName}.`}
      contentClassName="px-4 py-5 lg:px-6 lg:py-6"
      actions={
        <div className="flex rounded-xl border border-white/20 bg-white/10 p-1">
          {[1, 7, 30].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => router.get(`${APP_URL}/dashboard`, { period: days }, { preserveScroll: true })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${props.period.days === days ? "bg-white text-[#013765] shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
            >
              {days === 1 ? "Hoy" : `${days} días`}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#185e9c]">Resumen operativo</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[#013765]">{props.period.label}</h2>
          <p className="mt-1 text-sm text-slate-500">Del {formatDate(props.period.start)} al {formatDate(props.period.end)}</p>
        </div>
        <div className="flex flex-wrap gap-2 md:hidden">
          {[1, 7, 30].map((days) => (
            <Button key={days} size="sm" variant={props.period.days === days ? "default" : "outline"} onClick={() => router.get(`${APP_URL}/dashboard`, { period: days })}>
              {days === 1 ? "Hoy" : `${days} días`}
            </Button>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {props.summary.map((card) => {
          const Icon = summaryIcons[card.key as keyof typeof summaryIcons] || Activity
          return (
            <Card key={card.key} className="overflow-hidden border-slate-200 bg-white shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-600">{card.label}</p>
                    <p className="mt-2 text-3xl font-bold tracking-tight text-[#013765]">{card.value}</p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eaf2f8] text-[#185e9c]">
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">{card.description}</p>
                <div className="mt-3 border-t border-slate-100 pt-3 text-xs font-medium"><Trend card={card} /></div>
              </CardContent>
            </Card>
          )
        })}
      </section>

      <Card className="mt-4 border-[#185e9c]/20 bg-white shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#eaf2f8] text-[#185e9c]"><ArrowRight className="h-5 w-5" /></span>
            <div>
              <p className="font-semibold text-[#013765]">Conversi&oacute;n de WhatsApp a Webchat</p>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Total acumulado: clasifica por canal las conversaciones anteriores al seguimiento y suma las entradas registradas por enlace desde el 24/10/2026.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <div className="rounded-lg bg-[#f4f8fb] px-3 py-2.5">
              <p className="text-lg font-bold tabular-nums text-[#013765]">{formatNumber(props.webchat_conversion.received_contacts)}</p>
              <p className="text-[11px] text-slate-500">Total de chats</p>
            </div>
            <div className="rounded-lg bg-[#f4f8fb] px-3 py-2.5">
              <p className="text-lg font-bold tabular-nums text-[#013765]">{formatNumber(props.webchat_conversion.entered_contacts)}</p>
              <p className="text-[11px] text-slate-500">Entraron al Webchat</p>
            </div>
            <div className="rounded-lg bg-[#f4f8fb] px-3 py-2.5">
              <p className="text-lg font-bold tabular-nums text-[#013765]">{formatNumber(props.webchat_conversion.unentered_contacts)}</p>
              <p className="text-[11px] text-slate-500">No entraron</p>
            </div>
            <div className="rounded-lg bg-[#eaf2f8] px-3 py-2.5">
              <p className="text-lg font-bold tabular-nums text-[#185e9c]">{props.webchat_conversion.rate === null ? "\u2014" : `${formatNumber(props.webchat_conversion.rate)}%`}</p>
              <p className="text-[11px] text-slate-500">Conversi&oacute;n</p>
            </div>
          </div>
        </CardContent>
      </Card>
      {props.alerts.length > 0 ? (
        <section className="mt-4 space-y-2" aria-label="Alertas operativas">
          {props.alerts.map((alert) => (
            <button key={`${alert.title}-${alert.detail}`} type="button" onClick={() => navigateTo(alert.path)} className="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left transition hover:bg-amber-100">
              <CircleAlert className="h-5 w-5 shrink-0 text-amber-700" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-amber-900">{alert.title}</span><span className="block text-xs text-amber-800">{alert.detail}</span></span>
              <ArrowRight className="h-4 w-4 shrink-0 text-amber-700" />
            </button>
          ))}
        </section>
      ) : null}

      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Accesos rápidos">
        {quickActions.map((action) => {
          const Icon = action.icon
          return <Button key={action.path} variant="outline" size="sm" className="gap-2 border-slate-200 bg-white text-[#013765] hover:border-[#185e9c]/40 hover:bg-[#f4f8fb]" onClick={() => navigateTo(action.path)}><Icon className="h-4 w-4 text-[#185e9c]" />{action.label}</Button>
        })}
      </nav>

      <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[#013765]">Volumen de mensajes</CardTitle>
            <CardDescription>Filtr&aacute; por canal y pas&aacute; el cursor sobre una barra para ver el detalle.</CardDescription>
          </CardHeader>
          <CardContent><MessageActivityChart points={props.message_activity} /></CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-[#013765]">Pendientes de respuesta</CardTitle>
              <CardDescription>Conversaciones abiertas ordenadas por mayor espera.</CardDescription>
            </div>
            <Badge className="shrink-0 bg-amber-100 text-amber-800 hover:bg-amber-100">{formatNumber(props.work_queue.total)} chats</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-[#f4f8fb] px-3 py-2"><p className="text-lg font-bold text-[#013765]">{formatNumber(props.work_queue.unread_chats)}</p><p className="text-[11px] text-slate-500">Chats sin leer</p></div>
              <div className="rounded-lg bg-[#f4f8fb] px-3 py-2"><p className="text-lg font-bold text-[#013765]">{formatNumber(props.work_queue.unread_messages)}</p><p className="text-[11px] text-slate-500">Mensajes sin leer</p></div>
            </div>
            {props.work_queue.items.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-6 text-center">
                <CheckCircle2 className="h-9 w-9 text-emerald-500" />
                <p className="mt-3 font-medium text-[#013765]">Todo al día</p>
                <p className="mt-1 text-sm text-slate-500">No hay conversaciones esperando respuesta.</p>
              </div>
            ) : props.work_queue.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(`/chat-panel?chat=${item.id}`)}
                className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-[#185e9c]/40 hover:bg-[#f4f8fb]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eaf2f8] font-semibold text-[#185e9c]">{item.name.slice(0, 1).toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-[#013765]">{item.name}</p>
                    {item.unread_count > 0 ? <Badge className="h-5 min-w-5 justify-center rounded-full bg-[#185e9c] px-1.5 text-[10px]">{item.unread_count}</Badge> : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-600">{item.message}</p>
                  <p className="mt-1 truncate text-[11px] text-slate-500"><span className={item.channel === "webchat" ? "text-[#185e9c]" : "text-emerald-700"}>{item.channel === "webchat" ? "Webchat" : "WhatsApp"}</span><span className="text-slate-400"> · {item.operator_name ? `Asignado a ${item.operator_name}` : "Sin asignar"} · {item.message_at_human}</span></p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#185e9c]" />
              </button>
            ))}
            <Button variant="outline" className="w-full border-[#185e9c]/30 text-[#013765]" onClick={() => navigateTo("/chat-panel")}>Abrir panel de mensajes</Button>
          </CardContent>
        </Card>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#013765]"><Bot className="h-5 w-5" /> Estado del bot</CardTitle>
            <CardDescription>Chats y flujos abiertos ahora; actividad del período seleccionado.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ["Chats con bot", props.bot.enabled_chats, "text-emerald-700", Bot],
              ["Sin bot", props.bot.paused_chats, "text-amber-700", UserRoundCheck],
              ["Flujos activos", props.bot.active_flows, "text-[#185e9c]", GitBranch],
              ["Desactivaciones", props.bot.handoffs, "text-violet-700", ArrowRight],
              ["Acciones por inactividad", props.bot.inactivity_resets, "text-amber-700", Clock3],
            ].map(([label, value, color, Icon]) => {
              const MetricIcon = Icon as typeof Bot
              return (
                <div key={String(label)} className="surface-nested rounded-xl p-3">
                  <MetricIcon className={`h-4 w-4 ${color}`} />
                  <p className="mt-3 text-2xl font-bold text-[#013765]">{value as number}</p>
                  <p className="text-xs text-slate-500">{label as string}</p>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {props.campaigns ? (
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[#013765]"><Megaphone className="h-5 w-5" /> Campañas</CardTitle>
              <CardDescription>Envíos iniciados en el período; entrega y lectura actualizadas hasta hoy. Los fallos corresponden al período.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[#f4f8fb] p-4">
                  <p className="text-2xl font-bold text-[#013765]">{props.campaigns.delivery_rate}%</p>
                  <p className="text-xs text-slate-500">Entregados sobre enviados</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${props.campaigns.delivery_rate}%` }} /></div>
                </div>
                <div className="rounded-xl bg-[#f4f8fb] p-4">
                  <p className="text-2xl font-bold text-[#013765]">{props.campaigns.read_rate}%</p>
                  <p className="text-xs text-slate-500">Leídos sobre entregados</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-[#185e9c]" style={{ width: `${props.campaigns.read_rate}%` }} /></div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-lg border border-slate-100 p-2"><p className="font-semibold text-[#013765]">{formatNumber(props.campaigns.sent)}</p><p className="text-slate-500">Enviados</p></div>
                <div className="rounded-lg border border-slate-100 p-2"><p className="font-semibold text-[#013765]">{formatNumber(props.campaigns.delivered)}</p><p className="text-slate-500">Entregados</p></div>
                <div className="rounded-lg border border-slate-100 p-2"><p className="font-semibold text-[#013765]">{formatNumber(props.campaigns.read)}</p><p className="text-slate-500">Leídos</p></div>
                <div className="rounded-lg border border-slate-100 p-2"><p className={props.campaigns.failed > 0 ? "font-semibold text-rose-700" : "font-semibold text-[#013765]"}>{formatNumber(props.campaigns.failed)}</p><p className="text-slate-500">Fallidos</p></div>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-lg bg-violet-50 px-3 py-2 text-xs"><span className="text-slate-600">Campañas activas o programadas ahora</span><span className="font-bold text-violet-800">{formatNumber(props.campaigns.active_count)}</span></div>
              {props.campaigns.recent.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Últimas campañas</p>
                  {props.campaigns.recent.slice(0, 3).map((campaign) => (
                    <div key={campaign.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate font-medium text-[#013765]">{campaign.name}</span>
                      <span className="shrink-0 text-slate-500">{campaign.status === "running" ? "En curso" : campaign.status === "scheduled" ? "Programada" : campaign.status === "completed" ? "Finalizada" : campaign.status === "paused" ? "Pausada" : "Borrador"}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <Button variant="outline" className="mt-4 w-full border-[#185e9c]/30 text-[#013765]" onClick={() => navigateTo("/campaigns-panel")}>Ver campañas</Button>
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#013765]">Conversaciones abiertas</CardTitle>
            <CardDescription>Estado actual por canal y tipo de atención.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end justify-between rounded-xl bg-[#f4f8fb] p-4">
              <div><p className="text-xs font-medium text-slate-500">Abiertas ahora</p><p className="mt-1 text-3xl font-bold tracking-tight text-[#013765]">{formatNumber(props.chat_snapshot.open_total)}</p></div>
              <MessageSquare className="mb-1 h-6 w-6 text-[#185e9c]" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-100 p-3"><p className="text-lg font-bold text-emerald-700">{formatNumber(props.chat_snapshot.whatsapp)}</p><p className="text-xs text-slate-500">WhatsApp</p></div>
              <div className="rounded-lg border border-slate-100 p-3"><p className="text-lg font-bold text-[#185e9c]">{formatNumber(props.chat_snapshot.webchat)}</p><p className="text-xs text-slate-500">Webchat</p></div>
            </div>
            <div className="space-y-3">
              {[
                { label: "Atendidos por bot", value: props.chat_snapshot.bot, color: "bg-emerald-500" },
                { label: "Asignados a operador", value: props.chat_snapshot.assigned, color: "bg-[#185e9c]" },
                { label: "Pendientes de asignación", value: props.chat_snapshot.pending_assignment, color: "bg-amber-500" },
              ].map((item) => {
                const percent = props.chat_snapshot.open_total ? Math.round((item.value / props.chat_snapshot.open_total) * 100) : 0
                return <div key={item.label}><div className="mb-1 flex justify-between gap-2 text-xs"><span className="text-slate-600">{item.label}</span><span className="font-semibold text-[#013765]">{formatNumber(item.value)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${item.color}`} style={{ width: `${percent}%` }} /></div></div>
              })}
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="text-slate-600">Archivadas</span><span className="font-semibold text-slate-600">{formatNumber(props.chat_snapshot.archived)}</span></div>
            <Button variant="outline" className="w-full border-[#185e9c]/30 text-[#013765]" onClick={() => navigateTo("/chat-panel")}>Abrir panel de mensajes</Button>
          </CardContent>
        </Card>
      </section>

      <section className={`mt-6 grid grid-cols-1 gap-6 ${props.operations ? "xl:grid-cols-3" : props.system_health ? "xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]" : ""}`}>
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#013765]"><Activity className="h-5 w-5" /> Actividad reciente</CardTitle>
            <CardDescription>{permissions.can_view_audit ? "Últimos eventos registrados en el sistema." : "Tus últimas acciones registradas."}</CardDescription>
          </CardHeader>
          <CardContent>
            {props.recent_activity.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">Todavía no hay actividad para mostrar.</p> : (
              <div className="divide-y divide-slate-100">
                {props.recent_activity.map((event) => (
                  <div key={event.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#185e9c]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#013765]">{event.description}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{event.causer_name || "Sistema"} · {event.created_at_human}</p>
                    </div>
                    {event.scope ? <Badge variant="secondary" className="hidden bg-slate-100 text-[10px] text-slate-600 sm:inline-flex">{event.scope}</Badge> : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {props.operations ? (
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[#013765]"><Activity className="h-5 w-5" /> Gestiones en Alephoo</CardTitle>
              <CardDescription>Operaciones registradas durante el período seleccionado.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {[
                ["Turnos creados", props.operations.appointments_created],
                ["Turnos cancelados", props.operations.appointments_cancelled],
                ["Pacientes creados", props.operations.patients_created],
                ["Errores", props.operations.errors],
              ].map(([label, value]) => (
                <div key={String(label)} className="surface-nested rounded-xl p-3">
                  <p className={`text-2xl font-bold ${label === "Errores" && Number(value) > 0 ? "text-rose-700" : "text-[#013765]"}`}>{formatNumber(Number(value))}</p>
                  <p className="text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {props.system_health ? (
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[#013765]"><HeartPulse className="h-5 w-5" /> Servicios y configuración</CardTitle>
              <CardDescription>Estado local y credenciales; no consulta la conexión externa en tiempo real.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {props.system_health.map((service) => {
                const Icon = service.status === "ok" ? CheckCircle2 : service.status === "warning" ? CircleAlert : Activity
                const tone = service.status === "ok" ? "text-emerald-600 bg-emerald-50" : service.status === "warning" ? "text-amber-700 bg-amber-50" : "text-slate-500 bg-slate-100"
                return (
                  <div key={service.key} className="surface-nested flex items-center gap-3 rounded-xl p-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon className="h-4 w-4" /></div>
                    <div><p className="text-sm font-semibold text-[#013765]">{service.label}</p><p className="text-xs text-slate-500">{service.detail}</p></div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        ) : null}
      </section>
    </AppShell>
  )
}
