import { useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  Info,
  Loader2,
  Megaphone,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Upload,
} from "lucide-react"
import { toast } from "sonner"

import { AppShell, AppShellBackButton } from "../components/AppShell"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "shadcn/components/ui/dialog"
import { Input } from "shadcn/components/ui/input"
import { Label } from "shadcn/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "shadcn/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "shadcn/components/ui/select"
import { cn } from "shadcn/lib/utils"

const API_BASE = import.meta.env.VITE_API_BASE_URL || ""
const PHONE_HEADERS = ["telefono", "phone", "celular", "whatsapp", "numero", "numero_telefono"]

interface CampaignTemplate {
  id: number
  meta_template_id?: string | null
  name: string
  language: string
  category: string
  status: string
  body: string
  is_supported: boolean
  variable_keys: string[]
  created_by?: string | null
  created_at?: string | null
  synced_at?: string | null
}

interface Campaign {
  id: number
  name: string
  status: string
  source_filename?: string | null
  total_count: number
  valid_count: number
  invalid_count: number
  duplicate_count: number
  sent_count: number
  delivered_count: number
  read_count: number
  failed_count: number
  import_errors?: Array<{ row: number; message: string }>
  template?: Pick<CampaignTemplate, "id" | "name" | "language" | "status"> | null
  created_by?: string | null
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
}

interface ImportedRow {
  row_number: number
  phone: string
  values: Record<string, string>
  raw: Record<string, string>
}

interface Recipient {
  id: number
  row_number?: number | null
  phone: string
  name?: string | null
  rendered_body?: string | null
  status: string
  error_message?: string | null
}

interface CampaignsPanelProps {
  campaigns?: Campaign[]
  templates?: CampaignTemplate[]
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function detectCsvDelimiter(content: string): "," | ";" {
  let commas = 0
  let semicolons = 0
  let inQuotes = false

  for (let index = 0; index < content.length; index++) {
    const character = content[index]

    if (character === "\"") {
      if (inQuotes && content[index + 1] === "\"") {
        index++
      } else {
        inQuotes = !inQuotes
      }
    } else if (!inQuotes && (character === "\n" || character === "\r")) {
      break
    } else if (!inQuotes && character === ",") {
      commas++
    } else if (!inQuotes && character === ";") {
      semicolons++
    }
  }

  return semicolons > commas ? ";" : ","
}

function parseCsv(content: string): string[][] {
  const sanitizedContent = content.replace(/^\uFEFF/, "")
  const delimiter = detectCsvDelimiter(sanitizedContent)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false

  for (let index = 0; index < sanitizedContent.length; index++) {
    const character = sanitizedContent[index]

    if (character === "\"") {
      if (inQuotes && sanitizedContent[index + 1] === "\"") {
        cell += "\""
        index++
      } else {
        inQuotes = !inQuotes
      }
    } else if (character === delimiter && !inQuotes) {
      row.push(cell)
      cell = ""
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""

      if (character === "\r" && sanitizedContent[index + 1] === "\n") {
        index++
      }
    } else {
      cell += character
    }
  }

  if (inQuotes) {
    throw new Error("El CSV contiene comillas sin cerrar")
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows.filter((csvRow) => csvRow.some((value) => value.trim() !== ""))
}

function displayCellValue(value: unknown, header = ""): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) {
    if (header.includes("hora") || header.includes("time") || value.getFullYear() < 1902) {
      return new Intl.DateTimeFormat("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(value)
    }
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(value)
  }
  if (typeof value === "number" && value >= 0 && value < 1 && (header.includes("hora") || header.includes("time"))) {
    const totalMinutes = Math.round(value * 24 * 60)
    const hours = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0")
    const minutes = String(totalMinutes % 60).padStart(2, "0")
    return `${hours}:${minutes}`
  }
  return String(value).trim()
}

function statusLabel(status: string) {
  return {
    draft: "Borrador",
    running: "En ejecución",
    paused: "Pausada",
    completed: "Finalizada",
    pending: "Pendiente",
    queued: "En cola",
    processing: "Procesando",
    sent: "Enviado",
    delivered: "Entregado",
    read: "Leído",
    failed: "Fallido",
  }[status] ?? status
}

function statusClass(status: string) {
  if (["completed", "read", "APPROVED"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (["running", "sent", "delivered"].includes(status)) return "border-blue-200 bg-blue-50 text-blue-700"
  if (["failed", "REJECTED", "DISABLED"].includes(status)) return "border-red-200 bg-red-50 text-red-700"
  if (["paused", "PENDING", "PAUSED"].includes(status)) return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-slate-200 bg-slate-50 text-slate-700"
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json()
    const errors = payload?.errors ? Object.values(payload.errors).flat() : []
    return String(errors[0] ?? payload?.message ?? fallback)
  } catch {
    return fallback
  }
}

export default function CampaignsPanel({
  campaigns: initialCampaigns = [],
  templates: initialTemplates = [],
}: CampaignsPanelProps) {
  const [section, setSection] = useState<"campaigns" | "templates">("campaigns")
  const [campaignSearch, setCampaignSearch] = useState("")
  const [campaignStatusFilter, setCampaignStatusFilter] = useState("all")
  const [templateSearch, setTemplateSearch] = useState("")
  const [campaigns, setCampaigns] = useState(initialCampaigns)
  const [templates, setTemplates] = useState(initialTemplates)
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false)
  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null)
  const [campaignToLaunch, setCampaignToLaunch] = useState<Campaign | null>(null)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [campaignName, setCampaignName] = useState("")
  const [templateId, setTemplateId] = useState("")
  const [sourceFilename, setSourceFilename] = useState("")
  const [headers, setHeaders] = useState<string[]>([])
  const [importedRows, setImportedRows] = useState<ImportedRow[]>([])
  const [fileLoading, setFileLoading] = useState(false)
  const [creatingCampaign, setCreatingCampaign] = useState(false)
  const [busyCampaignId, setBusyCampaignId] = useState<number | null>(null)
  const [syncingTemplates, setSyncingTemplates] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const approvedTemplates = useMemo(
    () => templates.filter((template) => template.status === "APPROVED" && template.is_supported),
    [templates],
  )
  const selectedTemplate = useMemo(
    () => templates.find((template) => String(template.id) === templateId) ?? null,
    [templateId, templates],
  )
  const phoneHeader = useMemo(() => PHONE_HEADERS.find((header) => headers.includes(header)) ?? null, [headers])
  const missingHeaders = useMemo(() => {
    if (!selectedTemplate) return []
    return selectedTemplate.variable_keys.filter((key) => !headers.includes(normalizeHeader(key)))
  }, [headers, selectedTemplate])
  const previewRows = importedRows.slice(0, 8)
  const filteredCampaigns = useMemo(() => {
    const query = campaignSearch.trim().toLowerCase()
    return campaigns.filter((campaign) => {
      const matchesStatus = campaignStatusFilter === "all"
        || (campaignStatusFilter === "with_errors" ? campaign.failed_count > 0 : campaign.status === campaignStatusFilter)
      const searchable = [
        campaign.name,
        campaign.template?.name,
        campaign.source_filename,
        campaign.created_by,
      ].filter(Boolean).join(" ").toLowerCase()
      return matchesStatus && (query === "" || searchable.includes(query))
    })
  }, [campaignSearch, campaignStatusFilter, campaigns])
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase()
    if (query === "") return templates
    return templates.filter((template) => [
      template.name,
      template.language,
      template.category,
      template.status,
      template.body,
    ].join(" ").toLowerCase().includes(query))
  }, [templateSearch, templates])

  const refreshData = async () => {
    const response = await fetch(`${API_BASE}/api/campaigns`)
    if (!response.ok) throw new Error(await responseMessage(response, "No se pudo actualizar campañas"))
    const payload = await response.json()
    setCampaigns(Array.isArray(payload.campaigns) ? payload.campaigns : [])
    setTemplates(Array.isArray(payload.templates) ? payload.templates : [])
  }

  const resetCampaignForm = () => {
    setCampaignName("")
    setTemplateId("")
    setSourceFilename("")
    setHeaders([])
    setImportedRows([])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const readCsv = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Usá un archivo en formato .csv")
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("El archivo supera el máximo permitido de 10 MB")
      return
    }

    setFileLoading(true)
    try {
      const csvRows = parseCsv(await file.text())
      if (csvRows.length < 2) throw new Error("El CSV no contiene filas para importar")

      const normalizedHeaders = csvRows[0].map((value) => normalizeHeader(displayCellValue(value)))

      const duplicateHeaders = normalizedHeaders.filter(
        (header, index) => header !== "" && normalizedHeaders.indexOf(header) !== index,
      )
      if (duplicateHeaders.length > 0) {
        throw new Error(`Hay columnas duplicadas: ${Array.from(new Set(duplicateHeaders)).join(", ")}`)
      }

      const rows: ImportedRow[] = []
      csvRows.slice(1).forEach((row, index) => {
        const rowNumber = index + 2
        const raw: Record<string, string> = {}
        normalizedHeaders.forEach((header, columnIndex) => {
          if (header) raw[header] = displayCellValue(row[columnIndex], header)
        })
        if (Object.values(raw).every((value) => value === "")) return

        const detectedPhoneHeader = PHONE_HEADERS.find((header) => normalizedHeaders.includes(header))
        rows.push({
          row_number: rowNumber,
          phone: detectedPhoneHeader ? raw[detectedPhoneHeader] ?? "" : "",
          values: raw,
          raw,
        })
      })
      if (rows.length > 5000) throw new Error("La primera versión admite hasta 5000 destinatarios por campaña")

      setSourceFilename(file.name)
      setHeaders(normalizedHeaders.filter(Boolean))
      setImportedRows(rows)
      toast.success(`${rows.length} filas leídas desde ${file.name}`)
    } catch (error) {
      console.error("Error leyendo CSV:", error)
      setSourceFilename("")
      setHeaders([])
      setImportedRows([])
      toast.error(error instanceof Error ? error.message : "No se pudo leer el archivo")
    } finally {
      setFileLoading(false)
    }
  }

  const createCampaign = async () => {
    if (!campaignName.trim()) return toast.error("Ingresá un nombre para la campaña")
    if (!selectedTemplate) return toast.error("Seleccioná una plantilla aprobada")
    if (!phoneHeader) return toast.error("El CSV debe incluir una columna llamada telefono")
    if (missingHeaders.length > 0) return toast.error(`Faltan columnas: ${missingHeaders.join(", ")}`)
    if (importedRows.length === 0) return toast.error("Importá un CSV con destinatarios")

    setCreatingCampaign(true)
    try {
      const response = await fetch(`${API_BASE}/api/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: campaignName.trim(),
          whatsapp_template_id: selectedTemplate.id,
          source_filename: sourceFilename,
          rows: importedRows.map((row) => ({
            row_number: row.row_number,
            phone: row.phone,
            values: row.raw,
          })),
        }),
      })
      if (!response.ok) throw new Error(await responseMessage(response, "No se pudo crear la campaña"))
      const payload = await response.json()
      setCampaigns((current) => [payload.campaign, ...current])
      setCampaignDialogOpen(false)
      resetCampaignForm()
      toast.success("Campaña creada en borrador")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear la campaña")
    } finally {
      setCreatingCampaign(false)
    }
  }

  const changeCampaignStatus = async (campaign: Campaign, action: "launch" | "pause") => {
    setBusyCampaignId(campaign.id)
    try {
      const response = await fetch(`${API_BASE}/api/campaigns/${campaign.id}/${action}`, {
        method: "POST",
        headers: { Accept: "application/json" },
      })
      if (!response.ok) throw new Error(await responseMessage(response, "No se pudo actualizar la campaña"))
      const payload = await response.json()
      setCampaigns((current) => current.map((item) => (item.id === campaign.id ? payload.campaign : item)))
      toast.success(action === "launch" ? "Campaña iniciada" : "Campaña pausada")
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar la campaña")
      return false
    } finally {
      setBusyCampaignId(null)
    }
  }

  const openCampaignDetail = async (campaign: Campaign) => {
    setDetailCampaign(campaign)
    setRecipients([])
    setDetailLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/campaigns/${campaign.id}`)
      if (!response.ok) throw new Error(await responseMessage(response, "No se pudo cargar el detalle"))
      const payload = await response.json()
      setDetailCampaign(payload.campaign)
      setRecipients(Array.isArray(payload.recipients?.data) ? payload.recipients.data : [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar el detalle")
    } finally {
      setDetailLoading(false)
    }
  }

  const syncTemplates = async () => {
    setSyncingTemplates(true)
    try {
      const response = await fetch(`${API_BASE}/api/campaign-templates/sync`, {
        method: "POST",
        headers: { Accept: "application/json" },
      })
      if (!response.ok) throw new Error(await responseMessage(response, "No se pudieron sincronizar las plantillas"))
      const payload = await response.json()
      await refreshData()
      const summary = payload.summary ?? {}
      toast.success(`Meta sincronizado: ${summary.created ?? 0} nuevas y ${summary.updated ?? 0} actualizadas`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron sincronizar las plantillas")
    } finally {
      setSyncingTemplates(false)
    }
  }

  const draftCampaigns = campaigns.filter((campaign) => campaign.status === "draft").length
  const activeCampaigns = campaigns.filter((campaign) => ["running", "paused"].includes(campaign.status)).length
  const completedCampaigns = campaigns.filter((campaign) => campaign.status === "completed").length
  const campaignsWithErrors = campaigns.filter((campaign) => campaign.failed_count > 0).length

  return (
    <AppShell
      currentPath="/campaigns-panel"
      title="Campañas"
      subtitle="Módulo central para gestionar difusiones manuales y plantillas aprobadas de WhatsApp."
      leading={<AppShellBackButton onClick={() => window.history.back()} />}
      contentClassName="container mx-auto flex flex-col gap-6 px-6 py-8"
    >
      <Card className="border-[#dbe5ef] bg-white">
        <CardHeader className="space-y-4">
          <div>
            <CardTitle className="text-[#013765]">Gestión de campañas</CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className={cn(
                "border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]",
                section === "campaigns" ? "bg-[#013765] text-white hover:bg-[#024a8a] hover:text-white" : "",
              )}
              onClick={() => setSection("campaigns")}
            >
              <Megaphone className="mr-2 h-4 w-4" />
              Campañas
            </Button>
            <Button
              variant="outline"
              className={cn(
                "border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]",
                section === "templates" ? "bg-[#013765] text-white hover:bg-[#024a8a] hover:text-white" : "",
              )}
              onClick={() => setSection("templates")}
            >
              <Send className="mr-2 h-4 w-4" />
              Plantillas
            </Button>
          </div>
        </CardHeader>
      </Card>

      {section === "campaigns" ? (
        <Card className="border-[#dbe5ef] bg-white">
          <CardHeader>
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <CardTitle className="flex items-center gap-2 text-[#013765]">
                  <Megaphone className="h-5 w-5" />
                  Campañas de difusión
                </CardTitle>
                <CardDescription className="text-[#013765]/70">
                  Importación manual, confirmación de envío y seguimiento de entrega.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]"
                  onClick={() => void refreshData().catch(() => toast.error("No se pudo actualizar"))}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Actualizar
                </Button>
                <Button className="bg-[#013765] text-white hover:bg-[#024a8a]" onClick={() => setCampaignDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Nueva campaña
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <SummaryStat label="Total" value={campaigns.length} />
              <SummaryStat label="Borradores" value={draftCampaigns} />
              <SummaryStat label="En curso" value={activeCampaigns} />
              <SummaryStat label="Finalizadas" value={completedCampaigns} />
              <SummaryStat label="Con errores" value={campaignsWithErrors} />
            </div>

            <div className="surface-nested overflow-hidden rounded-xl border border-[#cbd8e5] bg-white shadow-sm">
              <div className="grid grid-cols-1 gap-3 border-b border-[#dbe5ef] bg-slate-50 px-4 py-3 md:grid-cols-[minmax(0,1fr)_190px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#013765]/45" />
                  <Input
                    value={campaignSearch}
                    onChange={(event) => setCampaignSearch(event.target.value)}
                    placeholder="Buscar por campaña, plantilla o archivo..."
                    className="bg-white pl-9"
                  />
                </div>
                <Select value={campaignStatusFilter} onValueChange={setCampaignStatusFilter}>
                  <SelectTrigger className="bg-white"><SelectValue placeholder="Filtrar por estado" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los estados</SelectItem>
                    <SelectItem value="draft">Borrador</SelectItem>
                    <SelectItem value="running">En ejecución</SelectItem>
                    <SelectItem value="paused">Pausada</SelectItem>
                    <SelectItem value="completed">Finalizada</SelectItem>
                    <SelectItem value="with_errors">Con errores</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="hidden grid-cols-[minmax(250px,1.5fr)_130px_minmax(270px,1fr)_220px] gap-3 border-b border-[#dbe5ef] bg-[#013765]/[0.03] px-4 py-3 text-xs font-medium text-[#013765]/70 lg:grid">
                <span>Campaña</span>
                <span>Estado</span>
                <span>Resultados</span>
                <span className="text-right">Acciones</span>
              </div>

              {filteredCampaigns.length === 0 ? (
                <EmptyState
                  title={campaigns.length === 0 ? "Todavía no hay campañas" : "No hay resultados"}
                  description={campaigns.length === 0
                    ? "Creá una campaña, seleccioná una plantilla e importá los destinatarios desde CSV."
                    : "Probá cambiando la búsqueda o el filtro de estado."}
                />
              ) : filteredCampaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="grid gap-3 border-b border-[#dbe5ef] px-4 py-4 last:border-b-0 hover:bg-slate-50 lg:grid-cols-[minmax(250px,1.5fr)_130px_minmax(270px,1fr)_220px] lg:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#013765]">{campaign.name}</p>
                    <p className="mt-1 truncate text-xs text-slate-600">
                      {campaign.template?.name ?? "Sin plantilla"} · {campaign.source_filename ?? "Sin archivo"}
                    </p>
                    <p className="mt-1 text-xs text-[#013765]/60">
                      {campaign.valid_count} destinatarios válidos
                      {campaign.invalid_count + campaign.duplicate_count > 0
                        ? ` · ${campaign.invalid_count + campaign.duplicate_count} observados`
                        : ""}
                    </p>
                  </div>
                  <div>
                    <Badge variant="outline" className={statusClass(campaign.status)}>
                      {statusLabel(campaign.status)}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <ResultValue label="Enviados" value={campaign.sent_count} />
                    <ResultValue label="Entregados" value={campaign.delivered_count} />
                    <ResultValue label="Leídos" value={campaign.read_count} />
                    <ResultValue label="Fallidos" value={campaign.failed_count} danger={campaign.failed_count > 0} />
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                    <Button
                      variant="outline"
                      className="border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]"
                      onClick={() => void openCampaignDetail(campaign)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      Detalle
                    </Button>
                    {campaign.status === "running" ? (
                      <Button
                        variant="outline"
                        className="border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]"
                        onClick={() => void changeCampaignStatus(campaign, "pause")}
                        disabled={busyCampaignId === campaign.id}
                      >
                        {busyCampaignId === campaign.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-4 w-4" />}
                        Pausar
                      </Button>
                    ) : campaign.status === "draft" || campaign.status === "paused" ? (
                      <Button
                        className="bg-[#013765] text-white hover:bg-[#024a8a]"
                        onClick={() => setCampaignToLaunch(campaign)}
                        disabled={busyCampaignId === campaign.id}
                      >
                        {busyCampaignId === campaign.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                        {campaign.status === "paused" ? "Reanudar" : "Iniciar"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-[#dbe5ef] bg-white">
          <CardHeader>
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <CardTitle className="flex items-center gap-2 text-[#013765]">
                  <Send className="h-5 w-5" />
                  Plantillas preaprobadas
                </CardTitle>
                <CardDescription className="text-[#013765]/70">
                  Catálogo de solo lectura obtenido directamente desde Meta.
                </CardDescription>
              </div>
              <Button
                className="bg-[#013765] text-white hover:bg-[#024a8a]"
                onClick={() => void syncTemplates()}
                disabled={syncingTemplates}
              >
                <RefreshCw className={cn("mr-2 h-4 w-4", syncingTemplates && "animate-spin")} />
                Sincronizar con Meta
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="surface-nested overflow-hidden rounded-xl border border-[#cbd8e5] bg-white shadow-sm">
              <div className="border-b border-[#dbe5ef] bg-slate-50 px-4 py-3">
                <div className="relative max-w-xl">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#013765]/45" />
                  <Input
                    value={templateSearch}
                    onChange={(event) => setTemplateSearch(event.target.value)}
                    placeholder="Buscar por nombre, idioma, categoría o contenido..."
                    className="bg-white pl-9"
                  />
                </div>
              </div>
              <div className="hidden grid-cols-[minmax(220px,1fr)_180px_minmax(320px,1.5fr)] gap-3 border-b border-[#dbe5ef] bg-[#013765]/[0.03] px-4 py-3 text-xs font-medium text-[#013765]/70 lg:grid">
                <span>Plantilla</span>
                <span>Estado y compatibilidad</span>
                <span>Contenido y variables</span>
              </div>
              {filteredTemplates.length === 0 ? (
                <EmptyState
                  title={templates.length === 0 ? "No hay plantillas registradas" : "No hay resultados"}
                  description={templates.length === 0
                    ? "Sincronizá el catálogo para obtener las plantillas disponibles en Meta."
                    : "Probá con otro término de búsqueda."}
                />
              ) : filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  className="grid gap-3 border-b border-[#dbe5ef] px-4 py-4 last:border-b-0 hover:bg-slate-50 lg:grid-cols-[minmax(220px,1fr)_180px_minmax(320px,1.5fr)] lg:items-start"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#013765]">{template.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{template.language} · {template.category}</p>
                  </div>
                  <div>
                    <Badge variant="outline" className={statusClass(template.status)}>{template.status}</Badge>
                    <p className={cn("mt-2 text-xs", template.is_supported ? "text-emerald-700" : "text-amber-700")}>
                      {template.is_supported ? "Compatible con campañas" : "Componentes no soportados"}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-2 whitespace-pre-wrap text-sm text-slate-700">{template.body}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {template.variable_keys.length === 0 ? (
                        <span className="text-xs text-slate-500">Sin variables</span>
                      ) : template.variable_keys.map((key, index) => (
                        <Badge key={key} variant="secondary" className="font-normal">{`{{${index + 1}}} → ${key}`}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={campaignDialogOpen} onOpenChange={(open) => {
        setCampaignDialogOpen(open)
        if (!open) resetCampaignForm()
      }}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto border-[#dbe5ef]">
          <DialogHeader>
            <DialogTitle className="text-[#013765]">Nueva campaña manual</DialogTitle>
            <DialogDescription className="text-[#013765]/70">Importá un CSV, revisá los datos y guardá la campaña como borrador.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="space-y-4 rounded-xl border border-[#dbe5ef] bg-slate-50/60 p-4">
              <div className="space-y-2">
                <Label>Nombre de la campaña</Label>
                <Input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Recordatorio de turnos - Julio" />
              </div>
              <div className="space-y-2">
                <Label>Plantilla aprobada</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar plantilla" /></SelectTrigger>
                  <SelectContent>
                    {approvedTemplates.map((template) => (
                      <SelectItem key={template.id} value={String(template.id)}>
                        {template.name} · {template.language}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedTemplate ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{selectedTemplate.body}</p>
                  <p className="mt-3 text-xs font-medium text-slate-500">
                    Columnas requeridas: telefono{selectedTemplate.variable_keys.length ? `, ${selectedTemplate.variable_keys.join(", ")}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Columna opcional para identificar al destinatario: nombre.</p>
                </div>
              ) : null}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label>Archivo CSV</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="rounded-full text-[#013765]/55 transition-colors hover:text-[#013765] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#013765]/30"
                        aria-label="Ver formato requerido del archivo CSV"
                      >
                        <Info className="h-4 w-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="z-[200] w-80 space-y-3 border-slate-200 bg-white text-slate-900 shadow-2xl"
                      align="start"
                      sideOffset={8}
                    >
                      <div>
                        <p className="font-semibold text-[#013765]">Formato del archivo</p>
                        <p className="mt-1 text-slate-600">Exportalo como CSV UTF-8, separado por coma o punto y coma.</p>
                      </div>
                      <ul className="list-disc space-y-1 pl-4 text-slate-600">
                        <li>La primera fila debe contener los encabezados.</li>
                        <li><span className="font-medium text-slate-700">telefono</span> es obligatorio y debe incluir código de país sin + ni 9".</li>
                        <li><span className="font-medium text-slate-700">nombre</span> es opcional.</li>
                        <li>Agregá una columna por cada variable requerida por la plantilla.</li>
                        <li>Máximo 5000 destinatarios y 10 MB.</li>
                      </ul>
                      <div className="rounded-lg bg-slate-50 p-2 font-mono text-xs text-slate-700">
                        telefono,nombre<br />
                        5491100000000,Paciente de ejemplo
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void readCsv(file)
                  }}
                />
                <Button variant="outline" className="w-full border-dashed border-[#dbe5ef] bg-white py-8 text-[#013765] hover:bg-[#013765]/[0.04]" onClick={() => fileInputRef.current?.click()} disabled={fileLoading}>
                  {fileLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Upload className="mr-2 h-5 w-5" />}
                  {sourceFilename || "Seleccionar archivo .csv"}
                </Button>
              </div>
              {headers.length > 0 ? (
                <div className="space-y-2 text-sm">
                  <ValidationLine valid={Boolean(phoneHeader)} text={phoneHeader ? `Teléfono detectado en “${phoneHeader}”` : "Falta la columna telefono"} />
                  <ValidationLine valid={missingHeaders.length === 0} text={missingHeaders.length === 0 ? "Variables de plantilla completas" : `Faltan: ${missingHeaders.join(", ")}`} />
                  <ValidationLine valid={importedRows.length > 0} text={`${importedRows.length} filas con datos`} />
                </div>
              ) : null}
            </div>

            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between">
                <Label>Previsualización</Label>
                {importedRows.length > 0 ? <Badge variant="secondary">{importedRows.length} filas</Badge> : null}
              </div>
              <div className="max-h-[430px] overflow-auto rounded-xl border border-[#dbe5ef]">
                {previewRows.length === 0 ? (
                  <div className="flex min-h-56 flex-col items-center justify-center p-6 text-center text-slate-500">
                    <FileSpreadsheet className="mb-3 h-10 w-10 text-slate-300" />
                    <p className="text-sm">La previsualización aparecerá cuando importes el CSV.</p>
                  </div>
                ) : (
                  <table className="w-full min-w-[620px] text-left text-xs">
                    <thead className="sticky top-0 bg-[#013765]/[0.04] text-[#013765]/70">
                      <tr>
                        <th className="px-3 py-2">Fila</th>
                        {headers.map((header) => <th key={header} className="px-3 py-2">{header}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row) => (
                        <tr key={row.row_number} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-400">{row.row_number}</td>
                          {headers.map((header) => <td key={header} className="max-w-48 truncate px-3 py-2">{row.raw[header]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-500">Se muestran hasta 8 filas.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="outline" className="border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]" onClick={() => setCampaignDialogOpen(false)}>Cancelar</Button>
            <Button className="bg-[#013765] text-white hover:bg-[#024a8a]" onClick={() => void createCampaign()} disabled={creatingCampaign}>
              {creatingCampaign ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
              Crear borrador
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detailCampaign)} onOpenChange={(open) => {
        if (!open) {
          setDetailCampaign(null)
          setRecipients([])
        }
      }}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto border-[#dbe5ef]">
          <DialogHeader>
            <DialogTitle className="text-[#013765]">{detailCampaign?.name ?? "Detalle de campaña"}</DialogTitle>
            <DialogDescription className="text-[#013765]/70">Seguimiento de importación y entrega por destinatario.</DialogDescription>
          </DialogHeader>
          {detailLoading || !detailCampaign ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-[#013765]" /></div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <SmallMetric label="Válidos" value={detailCampaign.valid_count} />
                <SmallMetric label="Enviados" value={detailCampaign.sent_count} />
                <SmallMetric label="Entregados" value={detailCampaign.delivered_count} />
                <SmallMetric label="Leídos" value={detailCampaign.read_count} />
                <SmallMetric label="Fallidos" value={detailCampaign.failed_count} />
                <SmallMetric label="Inválidos" value={detailCampaign.invalid_count + detailCampaign.duplicate_count} />
              </div>

              {(detailCampaign.import_errors?.length ?? 0) > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="mb-2 text-sm font-semibold text-amber-800">Observaciones de importación</p>
                  <div className="max-h-32 space-y-1 overflow-y-auto text-xs text-amber-700">
                    {detailCampaign.import_errors?.map((error, index) => <p key={`${error.row}-${index}`}>Fila {error.row}: {error.message}</p>)}
                  </div>
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-xl border border-[#dbe5ef]">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[#013765]/[0.04] text-xs text-[#013765]/70">
                    <tr>
                      <th className="px-3 py-2">Fila</th>
                      <th className="px-3 py-2">Destinatario</th>
                      <th className="px-3 py-2">Teléfono</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Mensaje / error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.map((recipient) => (
                      <tr key={recipient.id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2 text-slate-400">{recipient.row_number}</td>
                        <td className="px-3 py-2">{recipient.name || "Sin nombre"}</td>
                        <td className="px-3 py-2">{recipient.phone}</td>
                        <td className="px-3 py-2"><Badge variant="outline" className={statusClass(recipient.status)}>{statusLabel(recipient.status)}</Badge></td>
                        <td className={cn("max-w-md px-3 py-2 text-xs", recipient.error_message ? "text-red-600" : "text-slate-500")}>
                          {recipient.error_message || recipient.rendered_body}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {recipients.length === 0 ? <p className="text-center text-sm text-slate-500">No hay destinatarios para mostrar.</p> : null}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(campaignToLaunch)} onOpenChange={(open) => {
        if (!open) setCampaignToLaunch(null)
      }}>
        <DialogContent className="max-w-lg border-[#dbe5ef]">
          <DialogHeader>
            <DialogTitle className="text-[#013765]">Confirmar inicio de campaña</DialogTitle>
            <DialogDescription className="text-[#013765]/70">Esta acción comenzará a enviar mensajes reales mediante Meta.</DialogDescription>
          </DialogHeader>
          {campaignToLaunch ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">{campaignToLaunch.name}</p>
                <p className="mt-1">
                  Se encolarán {campaignToLaunch.valid_count} destinatarios usando la plantilla{" "}
                  <span className="font-medium">{campaignToLaunch.template?.name}</span>.
                </p>
              </div>
              <p className="text-sm text-slate-600">
                Verificá que el CSV, la plantilla y los números correspondan a esta difusión antes de continuar.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]" onClick={() => setCampaignToLaunch(null)}>Volver</Button>
                <Button
                  className="bg-[#013765] text-white hover:bg-[#024a8a]"
                  disabled={busyCampaignId === campaignToLaunch.id}
                  onClick={async () => {
                    const started = await changeCampaignStatus(campaignToLaunch, "launch")
                    if (started) setCampaignToLaunch(null)
                  }}
                >
                  {busyCampaignId === campaignToLaunch.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Confirmar e iniciar
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#dbe5ef] bg-[#013765]/[0.025] px-4 py-3">
      <p className="text-xs font-medium text-[#013765]/60">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[#013765]">{value}</p>
    </div>
  )
}

function ResultValue({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div>
      <p className={cn("text-sm font-semibold text-[#013765]", danger && "text-red-600")}>{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  )
}

function SmallMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#dbe5ef] bg-[#013765]/[0.025] p-3">
      <p className="text-xs text-[#013765]/60">{label}</p>
      <p className="text-lg font-semibold text-[#013765]">{value}</p>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-10 text-center">
      <Megaphone className="mx-auto h-10 w-10 text-slate-300" />
      <h3 className="mt-3 font-semibold text-[#013765]">{title}</h3>
      <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">{description}</p>
    </div>
  )
}

function ValidationLine({ valid, text }: { valid: boolean; text: string }) {
  return (
    <div className={cn("flex items-center gap-2", valid ? "text-emerald-700" : "text-red-600")}>
      {valid ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      <span>{text}</span>
    </div>
  )
}
