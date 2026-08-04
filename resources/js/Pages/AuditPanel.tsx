import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ChevronDown, FileText, GitBranch, Loader2, Megaphone, MessageSquare, RefreshCcw, ShieldCheck } from "lucide-react"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"
import { Input } from "shadcn/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "shadcn/components/ui/select"
import { cn } from "shadcn/lib/utils"
import { toast } from "sonner"
import { AppShell, AppShellBackButton } from "../components/AppShell"

interface AuditEntry {
  id: number
  log_name?: string | null
  event?: string | null
  description: string
  created_at?: string | null
  created_at_human?: string | null
  causer_name?: string | null
  causer_email?: string | null
  properties?: {
    context?: string
    changed_keys?: string[]
    target_user?: {
      id?: number
      name?: string
      email?: string
    }
    chat?: {
      id?: number
      contact_name?: string
      contact_number?: string
      bot_enabled?: boolean
      operator_id?: number | null
      operator_name?: string | null
    }
    flow?: {
      id?: number
      name?: string
      is_active?: boolean
      is_default?: boolean
      start_node_id?: number | null
      start_node_key?: string | null
    } | null
    node?: {
      id?: number
      flow_id?: number
      flow_name?: string
      key?: string | null
      type?: string | null
      next_node_id?: number | null
      next_node_key?: string | null
    } | null
    changes_human?: Array<{
      key?: string
      label: string
      before?: string | null
      after?: string | null
      value?: string | null
    } | null>
    before?: Record<string, unknown>
    after?: Record<string, unknown>
    meta?: Record<string, unknown>
  }
}

interface AuditPanelProps {
  configurationAuditLogs?: AuditEntry[]
  messageAuditLogs?: AuditEntry[]
  flowAuditLogs?: AuditEntry[]
  campaignAuditLogs?: AuditEntry[]
  logTail?: {
    path?: string
    updated_at?: string | null
    lines?: string[]
  }
}

type AuditScope = "configuration" | "messages" | "flows" | "campaigns" | "logs"

const API_BASE = import.meta.env.VITE_API_BASE_URL || ""
const AUDIT_PAGE_SIZE = 10
const AUDIT_FIELD_LABELS: Record<string, string> = {
  timezone: "Zona horaria",
  language: "Idioma",
  token: "Token de WhatsApp",
  phone_number_id: "Phone number ID",
  webhook_verify_token: "Webhook verify token",
  base_url: "Base URL de Alephoo",
  api_key: "API key de Alephoo",
  timeout: "Timeout de Alephoo",
  enabled_endpoints: "Endpoints habilitados",
  first_name: "Nombre",
  last_name: "Apellido",
  formatted_name: "Nombre visible",
  phone: "Telefono",
  organization: "Organizacion",
  title: "Cargo",
  email: "Correo electronico",
  template: "Plantilla",
  total_count: "Destinatarios totales",
  valid_count: "Destinatarios validos",
  invalid_count: "Destinatarios invalidos",
  duplicate_count: "Destinatarios duplicados",
  variable_keys: "Variables",
  default_flow_id: "Flujo por defecto",
  default_flow_name: "Nombre del flujo por defecto",
  inactivity_timeout_minutes: "Tiempo de inactividad",
  inactivity_timeout_message: "Mensaje de inactividad",
  role: "Rol",
  flow_id: "ID del flujo",
  flow_name: "Flujo",
  name: "Nombre",
  description: "Descripcion",
  is_active: "Activo",
  is_default: "Flujo por defecto",
  start_node_id: "Nodo inicial",
  start_node_key: "Clave del nodo inicial",
  key: "Clave",
  type: "Tipo",
  body: "Contenido",
  settings: "Configuracion del nodo",
  "settings.auto_advance": "Auto-disparar siguiente mensaje",
  "settings.auto_advance_delay_ms": "Demora del auto-disparo",
  "settings.auto_advance_max_hops": "Maximo de saltos automaticos",
  "settings.canvas_position": "Posicion en canvas",
  "settings.source_kind": "Origen del archivo",
  "settings.source": "Archivo",
  "settings.filename": "Nombre del archivo",
  "settings.variable": "Variable capturada",
  "settings.validation_regex": "Regex de validacion",
  "settings.error_message": "Mensaje de error",
  "settings.response_mode": "Tipo de respuesta",
  "settings.button_text": "Texto del boton de lista",
  "settings.section_title": "Titulo de la seccion",
  "settings.dni_variable": "Variable con DNI",
  "settings.not_found_message": "Mensaje si no se encuentra",
  "settings.not_found_next_node_id": "Siguiente nodo si no se encuentra",
  "settings.error_next_node_id": "Siguiente nodo si hay error",
  next_node_id: "Siguiente nodo",
  next_node_key: "Siguiente nodo",
  deleted_at: "Fecha de eliminacion",
  deleted_nodes_count: "Nodos eliminados",
  replacement_default_flow_id: "Flujo por defecto reemplazante",
  replacement_node_id: "Nodo reemplazante",
}

function getAuditFieldLabel(key: string): string {
  if (AUDIT_FIELD_LABELS[key]) return AUDIT_FIELD_LABELS[key]

  const buttonMatch = key.match(/^settings\.buttons\.(\d+)\.(.+)$/)
  if (buttonMatch) {
    return `Boton ${Number(buttonMatch[1]) + 1} - ${getAuditFieldLabel(buttonMatch[2])}`
  }

  const rowMatch = key.match(/^settings\.rows\.(\d+)\.(.+)$/)
  if (rowMatch) {
    return `Opcion ${Number(rowMatch[1]) + 1} - ${getAuditFieldLabel(rowMatch[2])}`
  }

  const leafLabels: Record<string, string> = {
    id: "ID interno",
    title: "Texto",
    description: "Descripcion",
    next_node_id: "Siguiente nodo",
    x: "X",
    y: "Y",
  }

  return leafLabels[key] ?? key.replace(/\./g, " - ").replace(/_/g, " ")
}

const scopeMeta: Record<Exclude<AuditScope, "logs">, { title: string; description: string; icon: typeof ShieldCheck }> = {
  configuration: {
    title: "Configuracion",
    description: "Cambios administrativos sobre settings, usuarios, seguridad, perfiles y agenda.",
    icon: ShieldCheck,
  },
  messages: {
    title: "Mensajes",
    description: "Acciones operativas relacionadas con mensajes y conversaciones del chat panel.",
    icon: MessageSquare,
  },
  flows: {
    title: "Flujos",
    description: "Cambios sobre el builder, flujos del bot y sus nodos.",
    icon: GitBranch,
  },
  campaigns: {
    title: "Campañas",
    description: "Creación, ejecución, pausa y sincronización de plantillas de campañas.",
    icon: Megaphone,
  },
}

export default function AuditPanel({
  configurationAuditLogs = [],
  messageAuditLogs = [],
  flowAuditLogs = [],
  campaignAuditLogs = [],
  logTail,
}: AuditPanelProps) {
  const [activeScope, setActiveScope] = useState<AuditScope>("configuration")
  const [auditByScope, setAuditByScope] = useState<Record<Exclude<AuditScope, "logs">, AuditEntry[]>>({
    configuration: configurationAuditLogs,
    messages: messageAuditLogs,
    flows: flowAuditLogs,
    campaigns: campaignAuditLogs,
  })
  const [logTailState, setLogTailState] = useState(logTail ?? { path: "", updated_at: null, lines: [] })
  const [loadingAudit, setLoadingAudit] = useState(false)
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [expandedAuditId, setExpandedAuditId] = useState<number | null>(null)
  const [auditSearch, setAuditSearch] = useState("")
  const [auditActorFilter, setAuditActorFilter] = useState("all")
  const [auditPage, setAuditPage] = useState(1)
  const logsViewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setAuditByScope({
      configuration: configurationAuditLogs,
      messages: messageAuditLogs,
      flows: flowAuditLogs,
      campaigns: campaignAuditLogs,
    })
    setLogTailState(logTail ?? { path: "", updated_at: null, lines: [] })
  }, [campaignAuditLogs, configurationAuditLogs, flowAuditLogs, logTail, messageAuditLogs])

  useEffect(() => {
    if (activeScope !== "logs") {
      setExpandedAuditId(null)
      setAuditPage(1)
      setAuditSearch("")
      setAuditActorFilter("all")
    }
  }, [activeScope])

  useEffect(() => {
    if (!logsViewportRef.current || activeScope !== "logs") return
    logsViewportRef.current.scrollTop = logsViewportRef.current.scrollHeight
  }, [activeScope, logTailState])

  const activeAuditLogs = activeScope === "logs" ? [] : auditByScope[activeScope]

  const auditActorOptions = useMemo(() => {
    return Array.from(
      new Set(
        activeAuditLogs
          .map((entry) => String(entry.causer_name ?? "Sistema").trim())
          .filter((value) => value !== ""),
      ),
    )
  }, [activeAuditLogs])

  const filteredAuditLogs = useMemo(() => {
    const normalizedSearch = auditSearch.trim().toLowerCase()

    return activeAuditLogs.filter((entry) => {
      const actor = String(entry.causer_name ?? "Sistema")
      const targetUserName = String(entry.properties?.target_user?.name ?? "")
      const targetUserEmail = String(entry.properties?.target_user?.email ?? "")
      const chatContactName = String(entry.properties?.chat?.contact_name ?? "")
      const chatContactNumber = String(entry.properties?.chat?.contact_number ?? "")
      const flowName = String(entry.properties?.flow?.name ?? entry.properties?.node?.flow_name ?? "")
      const nodeKey = String(entry.properties?.node?.key ?? "")
      const changedKeyLabels = (entry.properties?.changed_keys ?? []).map((key) => getAuditFieldLabel(key))
      const humanChanges = (entry.properties?.changes_human ?? []).filter((change) => change !== null).flatMap((change) => [
        change.label ?? "",
        change.before ?? "",
        change.after ?? "",
        change.value ?? "",
      ])
      const haystack = [
        entry.description,
        actor,
        entry.causer_email ?? "",
        targetUserName,
        targetUserEmail,
        chatContactName,
        chatContactNumber,
        flowName,
        nodeKey,
        entry.event ?? "",
        ...(entry.properties?.changed_keys ?? []),
        ...changedKeyLabels,
        ...humanChanges,
      ]
        .join(" ")
        .toLowerCase()

      if (auditActorFilter !== "all" && actor !== auditActorFilter) {
        return false
      }

      if (normalizedSearch !== "" && !haystack.includes(normalizedSearch)) {
        return false
      }

      return true
    })
  }, [activeAuditLogs, auditActorFilter, auditSearch])

  const auditTotalPages = Math.max(1, Math.ceil(filteredAuditLogs.length / AUDIT_PAGE_SIZE))
  const paginatedAuditLogs = useMemo(() => {
    const start = (auditPage - 1) * AUDIT_PAGE_SIZE
    return filteredAuditLogs.slice(start, start + AUDIT_PAGE_SIZE)
  }, [auditPage, filteredAuditLogs])
  const auditRangeStart = filteredAuditLogs.length === 0 ? 0 : (auditPage - 1) * AUDIT_PAGE_SIZE + 1
  const auditRangeEnd = Math.min(auditPage * AUDIT_PAGE_SIZE, filteredAuditLogs.length)

  useEffect(() => {
    setAuditPage(1)
    setExpandedAuditId(null)
  }, [auditSearch, auditActorFilter])

  useEffect(() => {
    if (auditPage > auditTotalPages) {
      setAuditPage(auditTotalPages)
    }
  }, [auditPage, auditTotalPages])

  const handleRefreshAuditLogs = async () => {
    if (activeScope === "logs") return

    setLoadingAudit(true)

    try {
      const res = await fetch(`${API_BASE}/api/audit/logs?scope=${activeScope}&limit=50`, {
        headers: {
          Accept: "application/json",
        },
      })

      if (!res.ok) {
        toast.error("No se pudo actualizar la auditoria", {
          description: "Intenta nuevamente en unos segundos.",
        })
        return
      }

      const payload = await res.json()
      setAuditByScope((prev) => ({
        ...prev,
        [activeScope]: payload.logs ?? [],
      }))
      toast.success("Auditoria actualizada", {
        description: `Se refresco la vista de ${scopeMeta[activeScope].title.toLowerCase()}.`,
      })
    } catch (err) {
      console.error("Error de red consultando auditoria:", err)
      toast.error("Error de red", {
        description: "No se pudo consultar la auditoria.",
      })
    } finally {
      setLoadingAudit(false)
    }
  }

  const handleRefreshAppLogs = async () => {
    setLoadingLogs(true)

    try {
      const res = await fetch(`${API_BASE}/api/audit/logs/tail?lines=120`, {
        headers: {
          Accept: "application/json",
        },
      })

      if (!res.ok) {
        toast.error("No se pudieron actualizar los logs", {
          description: "Intenta nuevamente en unos segundos.",
        })
        return
      }

      const payload = await res.json()
      setLogTailState(payload.tail ?? { path: "", updated_at: null, lines: [] })
    } catch (err) {
      console.error("Error de red consultando logs:", err)
      toast.error("Error de red", {
        description: "No se pudieron consultar los logs tecnicos.",
      })
    } finally {
      setLoadingLogs(false)
    }
  }

  const activeMeta = activeScope !== "logs" ? scopeMeta[activeScope] : null

  return (
    <AppShell
      currentPath="/audit-panel"
      title="Auditoria"
      subtitle="Modulo central para revisar trazabilidad operativa, tecnica y administrativa."
      leading={<AppShellBackButton onClick={() => window.history.back()} />}
      contentClassName="container mx-auto flex flex-col gap-6 px-6 py-8"
    >
        <Card className="border-[#dbe5ef] bg-white">
          <CardHeader className="space-y-4">
            <div>
              <CardTitle className="text-[#013765]">Fuentes de auditoria</CardTitle>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ["configuration", "Configuracion", ShieldCheck],
                ["messages", "Mensajes", MessageSquare],
                ["flows", "Flujos", GitBranch],
                ["campaigns", "Campañas", Megaphone],
                ["logs", "Logs tecnicos", FileText],
              ] as const).map(([scope, label, Icon]) => (
                <Button
                  key={scope}
                  variant="outline"
                  className={cn(
                    "border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]",
                    activeScope === scope ? "bg-[#013765] text-white hover:bg-[#024a8a] hover:text-white" : "",
                  )}
                  onClick={() => setActiveScope(scope)}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {label}
                </Button>
              ))}
            </div>
          </CardHeader>
        </Card>

        {activeScope !== "logs" ? (
          <Card className="border-[#dbe5ef] bg-white">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-[#013765]">
                    <activeMeta.icon className="h-5 w-5" />
                    {activeMeta.title}
                  </CardTitle>
                  <CardDescription className="text-[#013765]/70">{activeMeta.description}</CardDescription>
                </div>
                <Button
                  variant="outline"
                  className="border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]"
                  onClick={handleRefreshAuditLogs}
                  disabled={loadingAudit}
                >
                  {loadingAudit ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="mr-2 h-4 w-4" />
                  )}
                  Actualizar auditoria
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-xl border border-[#dbe5ef] overflow-hidden">
                <div className="grid grid-cols-1 gap-3 border-b border-[#dbe5ef] bg-slate-50 px-4 py-3 md:grid-cols-[minmax(0,1fr)_180px]">
                  <Input
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Buscar por descripcion, usuario o clave..."
                    className="bg-white"
                  />
                  <Select value={auditActorFilter} onValueChange={setAuditActorFilter}>
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder="Filtrar por usuario" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los usuarios</SelectItem>
                      {auditActorOptions.map((actor) => (
                        <SelectItem key={actor} value={actor}>
                          {actor}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-[180px_minmax(0,1.6fr)_90px] gap-3 border-b border-[#dbe5ef] bg-[#013765]/[0.03] px-4 py-3 text-xs font-medium text-[#013765]/70">
                  <span>Usuario</span>
                  <span>Evento</span>
                  <span className="text-right">Detalle</span>
                </div>

                {filteredAuditLogs.length > 0 ? (
                  paginatedAuditLogs.map((entry) => {
                    const isExpanded = expandedAuditId === entry.id

                    return (
                      <div key={entry.id} className="border-b border-[#dbe5ef] last:border-b-0">
                        <button
                          type="button"
                          className="grid w-full grid-cols-[180px_minmax(0,1.6fr)_90px] gap-3 px-4 py-3 text-left hover:bg-slate-50"
                          onClick={() => setExpandedAuditId(isExpanded ? null : entry.id)}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm text-slate-700">{entry.causer_name ?? "Sistema"}</p>
                            <p className="truncate text-xs text-slate-500">{entry.causer_email ?? ""}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[#013765]">{entry.description}</p>
                            {entry.properties?.target_user?.name ? (
                              <p className="mt-1 truncate text-xs text-slate-600">
                                Usuario afectado: {entry.properties.target_user.name}
                                {entry.properties?.target_user?.email ? ` · ${entry.properties.target_user.email}` : ""}
                              </p>
                            ) : null}
                            {entry.properties?.chat?.contact_name || entry.properties?.chat?.contact_number ? (
                              <p className="mt-1 truncate text-xs text-slate-600">
                                Chat: {entry.properties.chat?.contact_name ?? "Sin nombre"}
                                {entry.properties?.chat?.contact_number ? ` · ${entry.properties.chat.contact_number}` : ""}
                              </p>
                            ) : null}
                            {entry.properties?.flow?.name || entry.properties?.node?.flow_name ? (
                              <p className="mt-1 truncate text-xs text-slate-600">
                                Flujo: {entry.properties?.flow?.name ?? entry.properties?.node?.flow_name}
                                {entry.properties?.node?.key ? ` · Nodo: ${entry.properties.node.key}` : ""}
                              </p>
                            ) : null}
                            <p className="mt-1 truncate text-xs text-[#013765]/65">
                              {entry.created_at_human ?? entry.created_at ?? "sin fecha"}
                            </p>
                          </div>
                          <div className="flex items-center justify-end gap-3 pl-2">
                            <span className="hidden text-[11px] text-[#013765]/60 md:inline">
                              {(entry.properties?.changed_keys ?? []).length}
                            </span>
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 shrink-0 text-[#013765]/70 transition-transform",
                                isExpanded ? "rotate-180" : "",
                              )}
                            />
                          </div>
                        </button>

                        {isExpanded ? (
                          <div className="border-t border-[#dbe5ef] bg-slate-50/70 px-4 py-3">
                            {entry.properties?.changed_keys?.length ? (
                              <div className="mb-3 flex flex-wrap gap-2">
                                {entry.properties.changed_keys.map((key) => (
                                  <Badge key={key} variant="secondary" className="bg-amber-100 text-amber-800">
                                    {getAuditFieldLabel(key)}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}

                            {entry.properties?.changes_human?.some((change) => change !== null) ? (
                              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  <span>Campo</span>
                                  <span>Antes</span>
                                  <span>Despues</span>
                                </div>
                                {entry.properties.changes_human.filter((change) => change !== null).map((change, index) => {
                                  const hasBeforeAfter = change.before !== undefined || change.after !== undefined

                                  return (
                                    <div
                                      key={`${entry.id}-${change.key ?? change.label}-${index}`}
                                      className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0"
                                    >
                                      <div className="font-medium text-slate-700">{change.label}</div>
                                      {hasBeforeAfter ? (
                                        <>
                                          <div className="text-slate-600">{change.before ?? "—"}</div>
                                          <div className="text-slate-900">{change.after ?? "—"}</div>
                                        </>
                                      ) : (
                                        <>
                                          <div className="text-slate-400">—</div>
                                          <div className="text-slate-900">{change.value ?? "—"}</div>
                                        </>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            ) : (entry.properties?.before || entry.properties?.after || entry.properties?.meta) ? (
                              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                {entry.properties?.before ? (
                                  <div className="rounded-xl bg-white p-3">
                                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                      Antes
                                    </p>
                                    <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-700">
                                      {JSON.stringify(entry.properties.before, null, 2)}
                                    </pre>
                                  </div>
                                ) : null}
                                {entry.properties?.after ? (
                                  <div className="rounded-xl bg-white p-3">
                                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                      Despues
                                    </p>
                                    <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-700">
                                      {JSON.stringify(entry.properties.after, null, 2)}
                                    </pre>
                                  </div>
                                ) : null}
                                {!entry.properties?.before && !entry.properties?.after && entry.properties?.meta ? (
                                  <div className="rounded-xl bg-white p-3 lg:col-span-2">
                                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                      Meta
                                    </p>
                                    <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-700">
                                      {JSON.stringify(entry.properties.meta, null, 2)}
                                    </pre>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                ) : (
                  <div className="px-4 py-6 text-sm text-slate-500">
                    {activeScope === "configuration"
                      ? "No hay eventos de auditoria para los filtros actuales."
                      : "Todavia no hay eventos registrados para esta fuente. La conectaremos en el siguiente paso."}
                  </div>
                )}

                {filteredAuditLogs.length > 0 ? (
                  <div className="flex flex-col gap-3 border-t border-[#dbe5ef] bg-slate-50 px-4 py-3 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
                    <p>
                      Mostrando {auditRangeStart}-{auditRangeEnd} de {filteredAuditLogs.length} eventos
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]"
                        onClick={() => setAuditPage((page) => Math.max(1, page - 1))}
                        disabled={auditPage === 1}
                      >
                        Anterior
                      </Button>
                      <span className="min-w-[92px] text-center text-xs font-medium text-[#013765]/70">
                        Pagina {auditPage} de {auditTotalPages}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]"
                        onClick={() => setAuditPage((page) => Math.min(auditTotalPages, page + 1))}
                        disabled={auditPage === auditTotalPages}
                      >
                        Siguiente
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-[#dbe5ef] bg-white">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-[#013765]">Logs tecnicos</CardTitle>
                  <CardDescription className="text-[#013765]/70">
                    Visor tipo terminal con las ultimas lineas del `laravel.log`.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]"
                  onClick={() => void handleRefreshAppLogs()}
                  disabled={loadingLogs}
                >
                  {loadingLogs ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="mr-2 h-4 w-4" />
                  )}
                  Refrescar logs
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#013765]/65">
                <span className="truncate">Archivo: {logTailState?.path || "storage/logs/laravel.log"}</span>
                <span>Actualizado: {logTailState?.updated_at ?? "sin datos"}</span>
              </div>
              <div
                ref={logsViewportRef}
                className="max-h-[520px] overflow-auto rounded-xl bg-slate-950 px-4 py-3 font-mono text-[12px] leading-5 text-emerald-300 shadow-inner"
              >
                {(logTailState?.lines ?? []).length > 0 ? (
                  (logTailState?.lines ?? []).map((line, index) => (
                    <div key={`${index}-${line.slice(0, 16)}`} className="whitespace-pre-wrap break-words">
                      {line || " "}
                    </div>
                  ))
                ) : (
                  <div className="text-slate-400">No hay lineas disponibles para mostrar.</div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
    </AppShell>
  )
}
