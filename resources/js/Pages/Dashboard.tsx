import { router, usePage } from "@inertiajs/react"
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
  Send,
  Settings,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from "lucide-react"

import { AppShell } from "../components/AppShell"
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
  incoming: number
  bot: number
  operator: number
  campaign: number
}

type DashboardProps = {
  auth?: {
    user?: { name?: string | null; role_name?: string | null } | null
    permissions?: Record<string, boolean>
  }
  period: { days: number; label: string; start: string; end: string }
  summary: SummaryCard[]
  message_activity: ActivityPoint[]
  work_queue: {
    total: number
    unread_messages: number
    items: Array<{
      id: number
      name: string
      phone?: string | null
      avatar?: string | null
      message: string
      message_at_human?: string | null
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
}

const summaryIcons = {
  active_chats: Users,
  incoming_messages: MessageSquare,
  pending_chats: Inbox,
  response_time: Clock3,
}

const activityColors: Record<keyof Omit<ActivityPoint, "date" | "label">, string> = {
  incoming: "bg-[#185e9c]",
  bot: "bg-emerald-500",
  operator: "bg-amber-500",
  campaign: "bg-violet-500",
}

const activityLabels = {
  incoming: "Contactos",
  bot: "Bot",
  operator: "Operadores",
  campaign: "Campañas",
}

function navigateTo(path: string) {
  window.location.href = `${APP_URL}${path}`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-AR").format(value)
}

function Trend({ card }: { card: SummaryCard }) {
  if (card.delta === null) {
    return <span className="text-slate-500">Sin período anterior comparable</span>
  }

  const Icon = card.delta_direction === "positive" ? ArrowUpRight : card.delta_direction === "negative" ? ArrowDownRight : Minus
  const color = card.delta_direction === "positive" ? "text-emerald-700" : card.delta_direction === "negative" ? "text-rose-700" : "text-slate-500"

  return (
    <span className={`inline-flex items-center gap-1 ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(card.delta)}% frente al período anterior
    </span>
  )
}

function MessageActivityChart({ points }: { points: ActivityPoint[] }) {
  const keys = Object.keys(activityLabels) as Array<keyof typeof activityLabels>
  const max = Math.max(1, ...points.flatMap((point) => keys.map((key) => point[key])))

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2">
        {keys.map((key) => (
          <div key={key} className="flex items-center gap-2 text-xs text-slate-600">
            <span className={`h-2.5 w-2.5 rounded-full ${activityColors[key]}`} />
            {activityLabels[key]}
          </div>
        ))}
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex h-64 min-w-[620px] items-end gap-2 border-b border-slate-200 px-1">
          {points.map((point) => (
            <div key={point.date} className="group flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="relative flex flex-1 items-end justify-center gap-0.5">
                {keys.map((key) => (
                  <div
                    key={key}
                    className={`w-full max-w-3 rounded-t-sm transition-opacity group-hover:opacity-80 ${activityColors[key]}`}
                    style={{ height: `${Math.max(point[key] > 0 ? 4 : 0, (point[key] / max) * 100)}%` }}
                    title={`${activityLabels[key]}: ${point[key]}`}
                  />
                ))}
                <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-slate-950 px-3 py-2 text-xs text-white shadow-xl group-hover:block">
                  <p className="mb-1 whitespace-nowrap font-semibold">{point.date}</p>
                  {keys.map((key) => <p key={key} className="whitespace-nowrap">{activityLabels[key]}: {point[key]}</p>)}
                </div>
              </div>
              <span className="mt-2 truncate text-center text-[10px] text-slate-500">{point.label}</span>
            </div>
          ))}
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
          <p className="mt-1 text-sm text-slate-500">Del {props.period.start} al {props.period.end}</p>
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

      <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[#013765]">Actividad de mensajes</CardTitle>
            <CardDescription>Volumen diario separado por origen. Pasá el cursor para ver el detalle.</CardDescription>
          </CardHeader>
          <CardContent><MessageActivityChart points={props.message_activity} /></CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-[#013765]">Cola de atención</CardTitle>
              <CardDescription>Conversaciones cuyo último mensaje es del contacto.</CardDescription>
            </div>
            <Badge className="shrink-0 bg-amber-100 text-amber-800 hover:bg-amber-100">{props.work_queue.total} pendientes</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
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
                  <p className="mt-1 text-[11px] text-slate-400">{item.operator_name ? `Asignado a ${item.operator_name}` : "Sin asignar"} · {item.message_at_human}</p>
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
            <CardDescription>Automatización y derivaciones del período seleccionado.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {[
              ["Chats con bot", props.bot.enabled_chats, "text-emerald-700", Bot],
              ["Bot pausado", props.bot.paused_chats, "text-amber-700", UserRoundCheck],
              ["Flujos activos", props.bot.active_flows, "text-[#185e9c]", GitBranch],
              ["Derivaciones", props.bot.handoffs, "text-violet-700", ArrowRight],
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
              <CardDescription>Resultados acumulados de difusión.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[#f4f8fb] p-4"><p className="text-2xl font-bold text-[#013765]">{props.campaigns.delivery_rate}%</p><p className="text-xs text-slate-500">Tasa de entrega</p></div>
                <div className="rounded-xl bg-[#f4f8fb] p-4"><p className="text-2xl font-bold text-[#013765]">{props.campaigns.read_rate}%</p><p className="text-xs text-slate-500">Tasa de lectura</p></div>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-600">
                <span>{formatNumber(props.campaigns.sent)} enviados</span>
                <span>{formatNumber(props.campaigns.delivered)} entregados</span>
                <span className={props.campaigns.failed > 0 ? "text-rose-700" : ""}>{formatNumber(props.campaigns.failed)} fallidos</span>
              </div>
              <Button variant="outline" className="mt-5 w-full border-[#185e9c]/30 text-[#013765]" onClick={() => navigateTo("/campaigns-panel")}>Ver campañas</Button>
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#013765]">Acciones rápidas</CardTitle>
            <CardDescription>Accesos disponibles para tu rol.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {quickActions.map((action) => {
              const Icon = action.icon
              return (
                <button key={action.path} type="button" onClick={() => navigateTo(action.path)} className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-[#185e9c]/40 hover:bg-[#f4f8fb]">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eaf2f8] text-[#185e9c]"><Icon className="h-4 w-4" /></div>
                  <span className="flex-1 text-sm font-medium text-[#013765]">{action.label}</span>
                  <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-[#185e9c]" />
                </button>
              )
            })}
          </CardContent>
        </Card>
      </section>

      <section className={`mt-6 grid grid-cols-1 gap-6 ${props.system_health ? "xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]" : ""}`}>
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

        {props.system_health ? (
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[#013765]"><HeartPulse className="h-5 w-5" /> Salud del sistema</CardTitle>
              <CardDescription>Comprobaciones locales y estado de configuración.</CardDescription>
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
              <p className="pt-2 text-[11px] leading-relaxed text-slate-400">“Configurado” valida credenciales presentes; no garantiza disponibilidad externa en tiempo real.</p>
            </CardContent>
          </Card>
        ) : null}
      </section>
    </AppShell>
  )
}
