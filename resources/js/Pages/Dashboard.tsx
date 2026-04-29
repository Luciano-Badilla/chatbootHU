import { usePage } from "@inertiajs/react"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"
import { Bell, Bot, FileText, GitBranch, MessageSquare, Plus, ShieldCheck, Users } from "lucide-react"

import { AppShell } from "../components/AppShell"

const APP_URL = import.meta.env.VITE_APP_URL || ""

const quickActions = [
  {
    label: "Abrir panel de mensajes",
    href: `${APP_URL}/chat-panel`,
    icon: MessageSquare,
    tone: "primary",
  },
  {
    label: "Administrar flujos del bot",
    href: `${APP_URL}/bot/flows`,
    icon: GitBranch,
    tone: "secondary",
  },
  {
    label: "Abrir configuracion",
    href: `${APP_URL}/settings-panel`,
    icon: ShieldCheck,
    tone: "outline",
  },
  {
    label: "Revisar auditoria",
    href: `${APP_URL}/audit-panel`,
    icon: FileText,
    tone: "outline",
  },
]

const summaryCards = [
  {
    label: "Mensajes totales",
    value: "2,847",
    description: "+12% respecto del ultimo mes",
    icon: MessageSquare,
  },
  {
    label: "Chats activos",
    value: "156",
    description: "+8% respecto de la ultima semana",
    icon: Users,
  },
  {
    label: "Bots en ejecucion",
    value: "23",
    description: "3 flujos con alta actividad ahora",
    icon: Bot,
  },
  {
    label: "Tiempo promedio",
    value: "4.2m",
    description: "Mejora de 2% en tiempo de respuesta",
    icon: FileText,
  },
]

function navigateTo(href: string) {
  window.location.href = href
}

export default function Dashboard() {
  const { props } = usePage<{ auth?: { user?: { name?: string | null } | null } }>()
  const userName = props.auth?.user?.name?.trim() || "usuario"

  return (
    <AppShell
      currentPath="/dashboard"
      title="Dashboard"
      subtitle={`Bienvenido de vuelta, ${userName}`}
      contentClassName="px-4 py-4 lg:px-6 lg:py-6"
    >
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => {
          const Icon = card.icon

          return (
            <Card key={card.label} className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-[#013765]">{card.label}</CardTitle>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-[#013765]">
                  <Icon className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-[#013765]">{card.value}</div>
                <p className="mt-1 text-xs text-slate-600">{card.description}</p>
              </CardContent>
            </Card>
          )
        })}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#013765]">Acciones rapidas</CardTitle>
            <CardDescription className="text-slate-600">
              Atajos preparados para abrir los modulos clave del escritorio.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {quickActions.map((action) => {
              const Icon = action.icon
              const className =
                action.tone === "primary"
                  ? "bg-[#013765] text-white hover:bg-[#024a8a]"
                  : action.tone === "secondary"
                    ? "bg-[#185e9c] text-white hover:bg-[#024a8a]"
                    : "border-[#013765] text-[#013765] hover:bg-[#013765]/[0.04]"

              return (
                <Button
                  key={action.label}
                  variant={action.tone === "outline" ? "outline" : "default"}
                  className={`h-auto min-h-[84px] justify-start rounded-xl px-5 py-4 text-left ${className}`}
                  onClick={() => navigateTo(action.href)}
                >
                  <Icon className="mr-3 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-medium">{action.label}</p>
                    <p className={`mt-1 text-xs ${action.tone === "outline" ? "text-[#013765]/70" : "text-white/75"}`}>
                      Acceso directo sin pasar por menus intermedios.
                    </p>
                  </div>
                </Button>
              )
            })}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#013765]">Actividad reciente</CardTitle>
            <CardDescription className="text-slate-600">Ultimas acciones visibles en el sistema.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              ["Nuevo chat iniciado", "hace 2 minutos", "Chat", "bg-emerald-500"],
              ["Flujo principal actualizado", "hace 6 minutos", "Bot", "bg-[#013765]"],
              ["Rol de usuario modificado", "hace 12 minutos", "Seguridad", "bg-amber-500"],
              ["Export de configuracion", "hace 18 minutos", "Auditoria", "bg-violet-500"],
            ].map(([title, time, type, dot]) => (
              <div key={title} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <div className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#013765]">{title}</p>
                  <p className="text-xs text-slate-600">{time}</p>
                </div>
                <Badge variant="secondary" className="bg-[#013765]/10 text-[#013765]">
                  {type}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="mt-6">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-[#013765]">Estado del sistema</CardTitle>
            <CardDescription className="text-slate-600">
              Monitoreo rapido de componentes operativos y servicios criticos.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              ["API de mensajes", "Operativo", "bg-emerald-500"],
              ["Base de datos", "Operativo", "bg-emerald-500"],
              ["Procesamiento IA", "Carga alta", "bg-amber-500"],
            ].map(([label, status, dot]) => (
              <div key={label} className="rounded-xl border border-slate-200 px-4 py-4">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${dot}`} />
                  <div>
                    <p className="text-sm font-medium text-[#013765]">{label}</p>
                    <p className="text-xs text-slate-600">{status}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </AppShell>
  )
}
