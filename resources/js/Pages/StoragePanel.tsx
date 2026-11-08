import { useEffect, useRef, useState } from "react"
import {
  CalendarDays,
  FileText,
  Film,
  FilterX,
  Image as ImageIcon,
  Loader2,
  Lock,
  Music,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  Undo2,
} from "lucide-react"
import { toast } from "sonner"

import { AppShell } from "../Components/AppShell"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent } from "shadcn/components/ui/card"
import { Checkbox } from "shadcn/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "shadcn/components/ui/dialog"
import { Input } from "shadcn/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "shadcn/components/ui/select"
import { cn } from "shadcn/lib/utils"
import type { DateRange } from "react-day-picker"

import { DateRangePicker, dateFromIso, formatNumericDay, isoFromDate } from "../Components/DateRangePicker"

const API_BASE = import.meta.env.VITE_APP_URL || ""
const PER_PAGE = 25
const TRASH_BATCH = 500

// Azul institucional (mismo que la barra superior y los filtros activos).
const actionButtonClass = "rounded-lg border-[#013765] bg-[#013765] text-white hover:bg-[#012e54] hover:text-white"

// El Checkbox compartido usa colores "primary" que este proyecto no define, por eso se ve nativo.
const checkboxClass =
  "h-4 w-4 rounded border-slate-300 bg-white shadow-none data-[state=checked]:border-[#013765] data-[state=checked]:bg-[#013765] data-[state=checked]:text-white hover:border-[#185e9c] focus-visible:ring-2 focus-visible:ring-[#185e9c]/30 disabled:opacity-40"

type Usage = { files: number; bytes: number }

type CategorySummary = {
  key: string
  label: string
  actionable: boolean
  active: Usage
  trashed: Usage
}

type StorageSummary = {
  categories: CategorySummary[]
  totals: { files: number; bytes: number; active: Usage; trashed: Usage }
  disk: { free_bytes: number | null }
  scanned_at: string
}

type References = { messages: number; bot_nodes: number; total: number }

type StorageFile = {
  id: number
  path: string
  name: string
  category: string
  category_label: string
  actionable: boolean
  size_bytes: number
  mime: string | null
  modified_at: string | null
  url: string
  trashed: boolean
  deleted_at: string | null
  references: References
  in_use: boolean
  can_trash: boolean
  can_restore: boolean
  can_force_delete: boolean
  blocked_reason: string | null
}

type DuplicateFile = StorageFile & { keep: boolean }

type DuplicateGroup = {
  hash: string
  size_bytes: number
  copies: number
  wasted_bytes: number
  files: DuplicateFile[]
}

type DuplicatesResponse = {
  groups: DuplicateGroup[]
  total_groups: number
  wasted_bytes: number
}

type RetentionSettings = {
  bot_media_unused_days: number | null
  trash_purge_days: number | null
}

type ChatRow = {
  chat_id: number
  label: string
  channel: string
  files: number
  bytes: number
  last_message_at: string | null
  months_inactive: number | null
  exists: boolean
}

type PageMeta = { current_page: number; last_page: number; per_page: number; total: number }

type ViewMode = "chats" | "files" | "duplicates"

type ChatQuery = {
  inactive: number
  sort: "size" | "oldest"
  page: number
  q: string
}

type FileQuery = {
  status: "active" | "trashed"
  category: string
  q: string
  sort: "size" | "recent"
  page: number
  chat: number | null
  from: string
  to: string
}

class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function requestJson<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" }
  if (init.body !== undefined) headers["Content-Type"] = "application/json"

  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content")
  if (csrf) headers["X-CSRF-TOKEN"] = csrf

  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    credentials: "same-origin",
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const payload = (await res.json().catch(() => null)) as (T & { message?: string }) | null

  if (!res.ok) {
    throw new ApiError(payload?.message ?? "No se pudo completar la acción.", res.status)
  }

  return payload as T
}

function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "—"
  if (bytes < 1024) return `${bytes} B`

  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }

  return `${value.toLocaleString("es-AR", { maximumFractionDigits: value >= 100 ? 0 : 1 })} ${units[unit]}`
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
}

// Fecha local en formato Y-m-d, la que espera el servidor.
function isoDay(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return isoDay(date)
}

function monthsAgo(months: number) {
  const date = new Date()
  date.setMonth(date.getMonth() - months)
  return isoDay(date)
}

const DATE_PRESETS: { label: string; from: () => string; to: () => string }[] = [
  { label: "Hoy", from: () => isoDay(new Date()), to: () => isoDay(new Date()) },
  { label: "Última semana", from: () => daysAgo(7), to: () => isoDay(new Date()) },
  { label: "Último mes", from: () => monthsAgo(1), to: () => isoDay(new Date()) },
  { label: "Más de 6 meses", from: () => "", to: () => monthsAgo(6) },
  { label: "Más de 1 año", from: () => "", to: () => monthsAgo(12) },
]


function channelLabel(channel: string) {
  return channel === "webchat" ? "Webchat" : "WhatsApp"
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-0.5 text-xl font-semibold text-slate-900">{value}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500" title={hint}>
          {hint}
        </p>
      </CardContent>
    </Card>
  )
}

type PreviewKind = "image" | "video" | "audio" | "document"

function previewKind(file: StorageFile): PreviewKind {
  const mime = file.mime ?? ""
  const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : ""

  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(extension)) return "image"
  if (mime.startsWith("video/") || ["mp4", "3gp", "mov", "webm"].includes(extension)) return "video"
  if (mime.startsWith("audio/") || ["mp3", "m4a", "aac", "ogg", "opus", "amr", "wav"].includes(extension)) return "audio"

  return "document"
}

function fileExtensionLabel(name: string) {
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1, name.lastIndexOf(".") + 5).toUpperCase() : "ARCH"
}

// Carga diferida: el elemento multimedia se monta recién cuando la tarjeta entra en pantalla.
function useInView<T extends Element>(rootMargin = "200px") {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (inView || !node) return

    if (typeof IntersectionObserver === "undefined") {
      setInView(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(node)

    return () => observer.disconnect()
  }, [inView, rootMargin])

  return { ref, inView }
}

// Mini preview del archivo. Tocarlo abre el archivo; el resto de la tarjeta selecciona.
// Las imágenes usan una miniatura del servidor (160 px), nunca el archivo original, y se piden al entrar en pantalla.
// Videos, audios y documentos muestran un ícono: no se decodifican en la lista.
function FilePreview({ file, onOpen, size = "md" }: { file: StorageFile; onOpen: () => void; size?: "sm" | "md" }) {
  const { ref, inView } = useInView<HTMLButtonElement>()
  const [broken, setBroken] = useState(false)
  const kind = previewKind(file)
  const box = size === "md" ? "h-16 w-16" : "h-12 w-12"
  const showThumb = inView && kind === "image" && !broken

  return (
    <button
      ref={ref}
      type="button"
      title="Abrir archivo"
      aria-label={`Abrir ${file.name}`}
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-[#013765] transition-colors hover:border-[#185e9c]/40",
        box,
      )}
    >
      {showThumb ? (
        <img
          src={`${API_BASE}/api/storage/files/${file.id}/thumbnail`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : kind === "image" ? (
        <ImageIcon className="h-5 w-5" />
      ) : kind === "video" ? (
        <Film className="h-5 w-5" />
      ) : kind === "audio" ? (
        <Music className="h-5 w-5" />
      ) : (
        <span className="flex flex-col items-center justify-center gap-0.5">
          <FileText className="h-4 w-4" />
          <span className="text-[10px] font-semibold leading-none">{fileExtensionLabel(file.name)}</span>
        </span>
      )}
    </button>
  )
}

export default function StoragePanel() {
  const [summary, setSummary] = useState<StorageSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [view, setView] = useState<ViewMode>("chats")

  const [files, setFiles] = useState<StorageFile[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [query, setQuery] = useState<FileQuery>({
    status: "active",
    category: "",
    q: "",
    sort: "size",
    page: 1,
    chat: null,
    from: "",
    to: "",
  })
  const [search, setSearch] = useState("")
  const [chatLabel, setChatLabel] = useState("")

  const [chats, setChats] = useState<ChatRow[]>([])
  const [chatMeta, setChatMeta] = useState<PageMeta | null>(null)
  const [loadingChats, setLoadingChats] = useState(true)
  const [chatQuery, setChatQuery] = useState<ChatQuery>({ inactive: 0, sort: "size", page: 1, q: "" })
  const [chatSearch, setChatSearch] = useState("")

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const term = chatSearch.trim()
      setChatQuery((current) => (current.q === term ? current : { ...current, q: term, page: 1 }))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [chatSearch])

  const [duplicates, setDuplicates] = useState<DuplicatesResponse | null>(null)
  const [loadingDuplicates, setLoadingDuplicates] = useState(false)

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [selectionBytes, setSelectionBytes] = useState(0)
  const [selectingAll, setSelectingAll] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)


  const [reloadKey, setReloadKey] = useState(0)
  // Sube cuando termina el resumen (que escanea el disco). Las listas esperan a ese paso
  // para no leer el registro antes de que se carguen los archivos existentes.
  const [syncVersion, setSyncVersion] = useState(0)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] = useState<StorageFile | null>(null)
  const [emptyOpen, setEmptyOpen] = useState(false)
  const [emptying, setEmptying] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const totals = summary?.totals

  // Mismo selector de rango que el dashboard: el draft vive dentro del componente.
  const rangeFromQuery: DateRange | undefined =
    query.from || query.to
      ? {
          from: query.from ? dateFromIso(query.from) : undefined,
          to: query.to ? dateFromIso(query.to) : undefined,
        }
      : undefined
  const rangeLabel =
    query.from && query.to
      ? `${formatNumericDay(query.from)} – ${formatNumericDay(query.to)}`
      : query.from
        ? `Desde ${formatNumericDay(query.from)}`
        : query.to
          ? `Hasta ${formatNumericDay(query.to)}`
          : "Elegir fechas"
  // Un atajo queda azul cuando coincide exactamente con el rango aplicado.
  const presetActive = (preset: (typeof DATE_PRESETS)[number]) =>
    query.from === preset.from() && query.to === preset.to()

  const refresh = () => setReloadKey((key) => key + 1)

  const clearSelection = () => {
    setSelectedIds(new Set())
    setSelectionBytes(0)
  }

  // Cambiar filtros o vista descarta la selección: evita borrar algo que ya no se ve.
  const patchQuery = (patch: Partial<FileQuery>) => {
    clearSelection()
    setQuery((current) => ({ ...current, page: 1, ...patch }))
  }

  const changeView = (mode: ViewMode) => {
    if (mode !== view) clearSelection()
    setView(mode)
  }

  const currentMeta = view === "chats" ? chatMeta : view === "files" ? meta : null
  const currentLoading = view === "chats" ? loadingChats : loadingFiles

  const changePage = (delta: number) => {
    if (view === "chats") {
      setChatQuery((current) => ({ ...current, page: current.page + delta }))
    } else {
      setQuery((current) => ({ ...current, page: current.page + delta }))
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const term = search.trim()
      setQuery((current) => (current.q === term ? current : { ...current, q: term, page: 1 }))
      clearSelection()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    setLoadingSummary(true)

    requestJson<{ summary: StorageSummary }>(`${API_BASE}/api/storage/summary`)
      .then((data) => {
        if (!cancelled) setSummary(data.summary)
      })
      .catch((error) => {
        console.error("Error cargando el resumen de almacenamiento:", error)
        if (!cancelled) toast.error("No se pudo cargar el resumen de almacenamiento.")
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingSummary(false)
          setSyncVersion((version) => version + 1)
        }
      })

    return () => {
      cancelled = true
    }
  }, [reloadKey])

  useEffect(() => {
    if (syncVersion === 0 || view !== "chats") return

    let cancelled = false
    setLoadingChats(true)

    const params = new URLSearchParams({
      inactive_months: String(chatQuery.inactive),
      sort: chatQuery.sort,
      page: String(chatQuery.page),
      per_page: String(PER_PAGE),
    })

    if (chatQuery.q) params.set("q", chatQuery.q)

    requestJson<{ items: ChatRow[]; meta: PageMeta }>(`${API_BASE}/api/storage/chats?${params.toString()}`)
      .then((data) => {
        if (!cancelled) {
          setChats(data.items)
          setChatMeta(data.meta)
        }
      })
      .catch((error) => {
        console.error("Error cargando los chats:", error)
        if (!cancelled) toast.error("No se pudieron cargar los chats.")
      })
      .finally(() => {
        if (!cancelled) setLoadingChats(false)
      })

    return () => {
      cancelled = true
    }
  }, [chatQuery, syncVersion, view])

  useEffect(() => {
    if (syncVersion === 0 || view !== "files") return

    let cancelled = false
    setLoadingFiles(true)

    const params = new URLSearchParams({
      status: query.status,
      sort: query.sort,
      page: String(query.page),
      per_page: String(PER_PAGE),
    })
    if (query.category) params.set("category", query.category)
    if (query.q) params.set("q", query.q)
    if (query.chat !== null) params.set("chat_id", String(query.chat))
    if (query.from) params.set("modified_from", query.from)
    if (query.to) params.set("modified_to", query.to)

    requestJson<{ items: StorageFile[]; meta: PageMeta }>(`${API_BASE}/api/storage/files?${params.toString()}`)
      .then((data) => {
        if (!cancelled) {
          setFiles(data.items)
          setMeta(data.meta)
        }
      })
      .catch((error) => {
        console.error("Error cargando los archivos:", error)
        if (!cancelled) toast.error(error instanceof ApiError ? error.message : "No se pudieron cargar los archivos.")
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false)
      })

    return () => {
      cancelled = true
    }
  }, [query, syncVersion, view])

  useEffect(() => {
    if (syncVersion === 0 || view !== "duplicates") return

    let cancelled = false
    setLoadingDuplicates(true)

    requestJson<DuplicatesResponse>(`${API_BASE}/api/storage/duplicates`)
      .then((data) => {
        if (!cancelled) setDuplicates(data)
      })
      .catch((error) => {
        console.error("Error buscando duplicados:", error)
        if (!cancelled) toast.error("No se pudieron buscar los duplicados.")
      })
      .finally(() => {
        if (!cancelled) setLoadingDuplicates(false)
      })

    return () => {
      cancelled = true
    }
  }, [syncVersion, view])

  const runAction = async (file: StorageFile, action: () => Promise<unknown>, successMessage: string) => {
    setBusyId(file.id)
    try {
      await action()
      toast.success(successMessage)
      refresh()
    } catch (error) {
      console.error("Error en la acción de almacenamiento:", error)
      toast.error(error instanceof ApiError ? error.message : "No se pudo completar la acción.")
    } finally {
      setBusyId(null)
    }
  }

  const sendToTrash = (file: StorageFile) =>
    runAction(
      file,
      () => requestJson(`${API_BASE}/api/storage/files/${file.id}`, { method: "DELETE" }),
      "Archivo enviado a papelera",
    )

  const restoreFile = (file: StorageFile) =>
    runAction(
      file,
      () => requestJson(`${API_BASE}/api/storage/files/${file.id}/restore`, { method: "POST" }),
      "Archivo restaurado",
    )

  const openFile = (file: StorageFile) => {
    window.open(`${API_BASE}${file.url}`, "_blank", "noopener,noreferrer")
  }

  const openChatFiles = (row: ChatRow) => {
    setChatLabel(row.label)
    patchQuery({ chat: row.chat_id, status: "active", category: "" })
    setView("files")
  }

  const emptyTrashNow = async () => {
    setEmptying(true)
    try {
      const data = await requestJson<{ deleted: number; skipped: number; bytes: number }>(
        `${API_BASE}/api/storage/trash/empty`,
        { method: "POST", body: { confirmed: true } },
      )
      toast.success(
        data.skipped > 0
          ? `Papelera vaciada: ${data.deleted} borrado(s). ${data.skipped} se omitieron porque siguen en uso.`
          : `Papelera vaciada: ${data.deleted} archivo(s) borrados.`,
      )
      setEmptyOpen(false)
      refresh()
    } catch (error) {
      console.error("Error vaciando la papelera:", error)
      toast.error(error instanceof ApiError ? error.message : "No se pudo vaciar la papelera.")
    } finally {
      setEmptying(false)
    }
  }

  const confirmForceDelete = async () => {
    if (!pendingDelete) return

    setDeleting(true)
    try {
      await requestJson(`${API_BASE}/api/storage/files/${pendingDelete.id}/force`, {
        method: "DELETE",
        body: { confirmed: true },
      })
      toast.success("Archivo eliminado definitivamente")
      setPendingDelete(null)
      refresh()
    } catch (error) {
      console.error("Error eliminando el archivo:", error)
      toast.error(error instanceof ApiError ? error.message : "No se pudo eliminar el archivo.")
    } finally {
      setDeleting(false)
    }
  }

  const toggleFile = (file: StorageFile) => {
    const next = new Set(selectedIds)

    if (next.has(file.id)) {
      next.delete(file.id)
      setSelectionBytes(Math.max(0, selectionBytes - file.size_bytes))
    } else {
      next.add(file.id)
      setSelectionBytes(selectionBytes + file.size_bytes)
    }

    setSelectedIds(next)
  }

  const selectRows = (rows: StorageFile[]) => {
    const next = new Set(selectedIds)
    let bytes = selectionBytes

    rows.forEach((file) => {
      if (file.can_trash && !next.has(file.id)) {
        next.add(file.id)
        bytes += file.size_bytes
      }
    })

    setSelectedIds(next)
    setSelectionBytes(bytes)
  }

  const selectSurplusCopies = () => {
    if (!duplicates) return

    selectRows(duplicates.groups.flatMap((group) => group.files.filter((file) => !file.keep)))
  }

  const selectAllMatching = async () => {
    setSelectingAll(true)
    try {
      const params = new URLSearchParams()
      if (query.category) params.set("category", query.category)
      if (query.q) params.set("q", query.q)
      if (query.chat !== null) params.set("chat_id", String(query.chat))
      if (query.from) params.set("modified_from", query.from)
      if (query.to) params.set("modified_to", query.to)

      const data = await requestJson<{ ids: number[]; total: number; bytes: number; truncated: boolean }>(
        `${API_BASE}/api/storage/files/trashable-ids?${params.toString()}`,
      )

      setSelectedIds(new Set(data.ids))
      setSelectionBytes(data.bytes)

      if (data.truncated) {
        toast.message(`Se seleccionaron los primeros ${data.ids.length} de ${data.total} archivos.`)
      }
    } catch (error) {
      console.error("Error seleccionando los archivos:", error)
      toast.error("No se pudieron seleccionar los archivos.")
    } finally {
      setSelectingAll(false)
    }
  }

  const trashSelected = async () => {
    const ids = Array.from(selectedIds)
    setBulkBusy(true)

    let trashed = 0
    let skipped = 0

    try {
      for (let start = 0; start < ids.length; start += TRASH_BATCH) {
        const data = await requestJson<{ trashed: number; skipped: unknown[] }>(
          `${API_BASE}/api/storage/files/trash`,
          { method: "POST", body: { ids: ids.slice(start, start + TRASH_BATCH) } },
        )
        trashed += data.trashed
        skipped += data.skipped.length
      }

      toast.success(
        skipped > 0
          ? `${trashed} archivo(s) enviados a papelera. ${skipped} omitido(s): en uso o ya en papelera.`
          : `${trashed} archivo(s) enviados a papelera.`,
      )
      setBulkOpen(false)
    } catch (error) {
      console.error("Error enviando a papelera en lote:", error)
      toast.error(error instanceof ApiError ? error.message : "No se pudo completar el envío a papelera.")
    } finally {
      setBulkBusy(false)
      clearSelection()
      refresh()
    }
  }

  const renderChats = () => {
    if (loadingChats) {
      return (
        <div className="flex justify-center py-8 text-slate-500 lg:col-span-2">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )
    }

    if (chats.length === 0) {
      return (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-slate-500 lg:col-span-2">
          No hay chats con archivos en esta vista.
        </p>
      )
    }

    return chats.map((row) => (
      <button
        key={row.chat_id}
        type="button"
        onClick={() => openChatFiles(row)}
        className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:border-[#185e9c]/40 hover:bg-[#f4f8fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#185e9c]/30"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900" title={row.label}>
              {row.label}
            </p>
            <p className="text-xs text-slate-500">
              {channelLabel(row.channel)} · {row.files} archivo(s) · {formatBytes(row.bytes)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Último mensaje</p>
            <p className="text-xs font-medium text-slate-700">
              {row.last_message_at ? formatDate(row.last_message_at) : "Sin mensajes"}
            </p>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {row.months_inactive !== null && row.months_inactive >= 1 ? (
            <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-100">
              Inactivo hace {row.months_inactive} {row.months_inactive === 1 ? "mes" : "meses"}
            </Badge>
          ) : null}
          {!row.exists ? <Badge variant="outline">Chat eliminado</Badge> : null}
        </div>
      </button>
    ))
  }

  const renderFiles = () => {
    if (loadingFiles) {
      return (
        <div className="flex justify-center py-8 text-slate-500 lg:col-span-2">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )
    }

    if (files.length === 0) {
      return (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-slate-500 lg:col-span-2">
          No hay archivos en esta vista.
        </p>
      )
    }

    return files.map((file) => {
      const busy = busyId === file.id
      const selected = selectedIds.has(file.id)
      const canSelect = query.status === "active" && file.can_trash

      return (
        <div
          key={file.id}
          onClick={() => {
            if (canSelect) toggleFile(file)
          }}
          onKeyDown={(event) => {
            if (canSelect && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault()
              toggleFile(file)
            }
          }}
          tabIndex={canSelect ? 0 : undefined}
          className={cn(
            "min-w-0 rounded-xl border bg-white px-3 py-2.5 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#185e9c]/30 lg:flex lg:items-center lg:gap-3",
            selected ? "border-[#013765] bg-[#013765]/5" : "border-slate-200",
            canSelect && "cursor-pointer hover:border-[#185e9c]/40 hover:bg-[#f4f8fb]",
          )}
        >
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {query.status === "active" ? (
              <div
                className="flex h-9 shrink-0 items-center"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <Checkbox
                  checked={selected}
                  disabled={!file.can_trash}
                  onCheckedChange={() => toggleFile(file)}
                  aria-label={`Seleccionar ${file.name}`}
                  className={checkboxClass}
                />
              </div>
            ) : null}
            <FilePreview file={file} onOpen={() => openFile(file)} />
            <div className="min-w-0 flex-1">
              <p className="break-all text-sm font-semibold text-slate-900" title={file.path}>
                {file.name}
              </p>
              <p className="text-xs text-slate-500">
                {file.category_label} · {formatBytes(file.size_bytes)} · {formatDate(file.modified_at)}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {file.trashed ? <Badge variant="outline">Papelera desde {formatDate(file.deleted_at)}</Badge> : null}
              </div>
              {file.blocked_reason ? <p className="mt-1 text-xs text-amber-700">{file.blocked_reason}</p> : null}
            </div>
          </div>

          {/* Los botones no deben seleccionar ni abrir el archivo al tocarlos: frenamos la propagación. */}
          <div
            className="mt-2 flex shrink-0 flex-col gap-1.5 lg:mt-0 lg:w-32 [&>*]:w-full"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {file.trashed ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className={actionButtonClass}
                  onClick={() => void restoreFile(file)}
                  disabled={busy || !file.can_restore}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
                  Restaurar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => setPendingDelete(file)}
                  disabled={busy || !file.can_force_delete}
                  title={file.blocked_reason ?? "Eliminar definitivamente"}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className={cn(actionButtonClass, "!h-8 !w-8 self-end px-0")}
                onClick={() => void sendToTrash(file)}
                disabled={busy || !file.can_trash}
                title={file.blocked_reason ?? "Enviar a papelera"}
                aria-label="Enviar a papelera"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>
      )
    })
  }

  const renderDuplicates = () => {
    if (loadingDuplicates) {
      return (
        <div className="flex justify-center py-8 text-slate-500 lg:col-span-2">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )
    }

    if (!duplicates || duplicates.groups.length === 0) {
      return (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-slate-500 lg:col-span-2">
          No hay archivos duplicados.
        </p>
      )
    }

    return duplicates.groups.map((group) => (
      <div key={group.hash} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900">
            {group.copies} copias · {formatBytes(group.size_bytes)} cada una
          </p>
          <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100">
            Se pueden recuperar {formatBytes(group.wasted_bytes)}
          </Badge>
        </div>

        <div className="mt-2 space-y-1.5">
          {group.files.map((file) => (
            <div
              key={file.id}
              onClick={() => {
                if (file.can_trash) toggleFile(file)
              }}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-2.5 py-2 transition-colors",
                selectedIds.has(file.id) ? "border-[#013765] bg-[#013765]/5" : "border-slate-100",
                file.can_trash && "cursor-pointer hover:border-[#185e9c]/40 hover:bg-[#f4f8fb]",
              )}
            >
              <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <Checkbox
                  checked={selectedIds.has(file.id)}
                  disabled={!file.can_trash}
                  onCheckedChange={() => toggleFile(file)}
                  aria-label={`Seleccionar ${file.path}`}
                  className={checkboxClass}
                />
              </div>
              <FilePreview file={file} size="sm" onOpen={() => openFile(file)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[#013765]" title={file.path}>
                  {file.path}
                </p>
                <p className="text-xs text-slate-500">
                  {file.category_label} · {formatDate(file.modified_at)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                {file.keep ? (
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                    Conservar
                  </Badge>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    ))
  }

  return (
    <AppShell
      currentPath="/storage-panel"
      title="Almacenamiento"
      subtitle="Cuánto ocupan los archivos de chats y flujos, y qué se puede liberar."
      fullHeight
      contentClassName="px-4 py-3 lg:px-6 lg:py-4"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            onClick={refresh}
            disabled={loadingSummary}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", loadingSummary && "animate-spin")} />
            Actualizar
          </Button>
        </div>
      }
    >
      <div className="mx-auto flex h-full min-h-0 max-w-[1600px] flex-col gap-4 lg:flex-row">
        <aside className="flex min-h-0 shrink-0 flex-col gap-3 overflow-y-auto pr-1 max-h-56 lg:max-h-none lg:w-72">
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="Archivos"
              value={totals ? totals.files.toLocaleString("es-AR") : "—"}
              hint="Activos y en papelera"
            />
            <StatCard label="Memoria usada" value={formatBytes(totals?.bytes)} hint="Total en disco" />
            <StatCard
              label="En papelera"
              value={formatBytes(totals?.trashed.bytes)}
              hint={`${totals?.trashed.files ?? 0} archivo(s). Se libera al borrarlos.`}
            />
            <StatCard
              label="Espacio libre"
              value={formatBytes(summary?.disk.free_bytes)}
              hint="Disco donde se guardan los archivos"
            />
          </div>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="p-3">
              <p className="text-sm font-semibold text-slate-900">Por categoría</p>
              <p className="mb-2 text-xs text-slate-500">Tocá una para ver sus archivos</p>
              <div className="grid min-w-0 grid-cols-1 gap-2">
                {summary?.categories.map((category) => {
                  const bytes = category.active.bytes + category.trashed.bytes
                  const files = category.active.files + category.trashed.files
                  const share = totals && totals.bytes > 0 ? (bytes / totals.bytes) * 100 : 0
                  const selected = query.category === category.key

                  return (
                    <button
                      key={category.key}
                      type="button"
                      onClick={() => {
                        patchQuery({ category: selected ? "" : category.key, chat: null })
                        changeView("files")
                      }}
                      className={cn(
                        "w-full min-w-0 overflow-hidden rounded-xl border px-3 py-2 text-left shadow-sm transition-colors",
                        selected
                          ? "border-[#013765] bg-[#013765]/5"
                          : "border-slate-200 bg-white hover:border-[#185e9c]/40 hover:bg-[#f4f8fb]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{category.label}</p>
                          {!category.actionable ? (
                            <Badge variant="secondary" className="shrink-0 gap-1 whitespace-nowrap">
                              <Lock className="h-3 w-3" />
                              Solo lectura
                            </Badge>
                          ) : null}
                        </div>
                        <p className="shrink-0 text-sm font-semibold text-slate-900">{formatBytes(bytes)}</p>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-[#013765]"
                          style={{ width: `${bytes > 0 ? Math.max(share, 2) : 0}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {files} archivo(s) · {category.trashed.files} en papelera
                      </p>
                    </button>
                  )
                })}
                {!summary && loadingSummary ? (
                  <div className="flex justify-center py-4 text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </aside>

        <Card className="flex min-h-0 min-w-0 flex-1 flex-col border-slate-200 bg-white shadow-sm">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-9 items-center rounded-xl border bg-white p-0.5">
                {(["chats", "files", "duplicates"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => changeView(mode)}
                    className={cn(
                      "h-full rounded-lg px-3 text-sm font-medium transition-colors",
                      view === mode ? "bg-[#013765] text-white" : "text-slate-600 hover:bg-slate-100",
                    )}
                  >
                    {mode === "chats" ? "Chats" : mode === "files" ? "Archivos" : "Duplicados"}
                  </button>
                ))}
              </div>

              {view === "chats" ? (
                <>
                  <Select
                    value={String(chatQuery.inactive)}
                    onValueChange={(value) => setChatQuery((current) => ({ ...current, inactive: Number(value), page: 1 }))}
                  >
                    <SelectTrigger aria-label="Inactividad" className="h-9 w-auto min-w-[13rem] rounded-xl bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="0">Todos los chats</SelectItem>
                      <SelectItem value="3">Sin actividad hace 3+ meses</SelectItem>
                      <SelectItem value="6">Sin actividad hace 6+ meses</SelectItem>
                      <SelectItem value="12">Sin actividad hace 12+ meses</SelectItem>
                      <SelectItem value="24">Sin actividad hace 24+ meses</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={chatQuery.sort}
                    onValueChange={(value) =>
                      setChatQuery((current) => ({ ...current, sort: value as ChatQuery["sort"], page: 1 }))
                    }
                  >
                    <SelectTrigger aria-label="Orden de chats" className="h-9 w-auto min-w-[10rem] rounded-xl bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="size">Mayor tamaño</SelectItem>
                      <SelectItem value="oldest">Más antiguo</SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="relative min-w-[14rem] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      type="search"
                      name="storage-chat-search"
                      autoComplete="off"
                      value={chatSearch}
                      onChange={(event) => setChatSearch(event.target.value)}
                      className="h-9 rounded-xl pl-9"
                      placeholder="Buscar chat por nombre, teléfono o id..."
                    />
                  </div>
                </>
              ) : null}

              {view === "files" ? (
                <>
                  <div className="inline-flex h-9 items-center rounded-xl border bg-white p-0.5">
                    {(["active", "trashed"] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => patchQuery({ status })}
                        className={cn(
                          "h-full rounded-lg px-3 text-sm font-medium transition-colors",
                          query.status === status ? "bg-[#013765] text-white" : "text-slate-600 hover:bg-slate-100",
                        )}
                      >
                        {status === "active" ? "Activos" : "Papelera"}
                      </button>
                    ))}
                  </div>

                  {query.status === "trashed" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={!totals?.trashed.files}
                      onClick={() => setEmptyOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Vaciar papelera{totals ? ` (${totals.trashed.files})` : ""}
                    </Button>
                  ) : null}

                  <Select
                    value={query.category || "all"}
                    onValueChange={(value) => patchQuery({ category: value === "all" ? "" : value })}
                  >
                    <SelectTrigger aria-label="Categoría" className="h-9 w-auto min-w-[11rem] rounded-xl bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="all">Todas las categorías</SelectItem>
                      {summary?.categories.map((category) => (
                        <SelectItem key={category.key} value={category.key}>
                          {category.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={query.sort} onValueChange={(value) => patchQuery({ sort: value as FileQuery["sort"] })}>
                    <SelectTrigger aria-label="Orden" className="h-9 w-auto min-w-[10rem] rounded-xl bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="size">Mayor tamaño</SelectItem>
                      <SelectItem value="recent">Más reciente</SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="relative min-w-[14rem] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      type="search"
                      name="storage-file-search"
                      autoComplete="off"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className="h-9 rounded-xl pl-9"
                      placeholder="Buscar por nombre o ruta..."
                    />
                  </div>
                </>
              ) : null}
            </div>

            {view === "files" ? (
              <div className="flex flex-wrap items-center gap-2">
                <DateRangePicker
                  value={rangeFromQuery}
                  align="start"
                  formatDay={formatNumericDay}
                  onApply={(range) =>
                    patchQuery({
                      from: range.from ? isoFromDate(range.from) : "",
                      to: range.to ? isoFromDate(range.to) : "",
                    })
                  }
                  trigger={
                    <button
                      type="button"
                      className="inline-flex h-9 w-60 shrink-0 items-center gap-2 rounded-xl border bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-[#f4f8fb]"
                    >
                      <CalendarDays className="h-4 w-4 text-[#013765]" />
                      <span className="truncate">{rangeLabel}</span>
                    </button>
                  }
                />
                {DATE_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    variant="outline"
                    size="sm"
                    className={cn("h-8 rounded-lg text-xs", presetActive(preset) && actionButtonClass)}
                    onClick={() => patchQuery({ from: preset.from(), to: preset.to() })}
                  >
                    {preset.label}
                  </Button>
                ))}
                {query.from || query.to ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 rounded-lg px-0"
                    onClick={() => patchQuery({ from: "", to: "" })}
                    title="Quitar fechas"
                    aria-label="Quitar fechas"
                  >
                    <FilterX className="h-4 w-4" />
                  </Button>
                ) : null}

                {query.chat !== null ? (
                  <Badge variant="secondary" className="gap-2 bg-[#013765]/10 text-[#013765] hover:bg-[#013765]/10">
                    Chat: {chatLabel || `#${query.chat}`}
                    <button
                      type="button"
                      onClick={() => patchQuery({ chat: null })}
                      className="text-slate-500 hover:text-slate-900"
                      aria-label="Quitar filtro de chat"
                    >
                      ×
                    </button>
                  </Badge>
                ) : null}
              </div>
            ) : null}

            {view === "duplicates" && duplicates ? (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-sm text-slate-700">
                <span>
                  {duplicates.total_groups} grupo(s) · {formatBytes(duplicates.wasted_bytes)} recuperables
                </span>
                <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={selectSurplusCopies}>
                  Seleccionar copias sobrantes
                </Button>
              </div>
            ) : null}

            {selectedIds.size > 0 && view !== "chats" ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-[#013765]/20 bg-[#013765]/5 px-3 py-2 text-sm">
                <span className="font-medium text-[#013765]">
                  {selectedIds.size} seleccionado(s) · {formatBytes(selectionBytes)}
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  {view === "files" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      onClick={() => void selectAllMatching()}
                      disabled={selectingAll}
                    >
                      {selectingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Seleccionar todo
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={clearSelection}>
                    Deseleccionar
                  </Button>
                  <Button size="sm" className={cn(actionButtonClass, "h-8")} onClick={() => setBulkOpen(true)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Enviar a papelera
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pr-1 xl:grid-cols-2">
              {view === "chats" ? renderChats() : view === "files" ? renderFiles() : renderDuplicates()}
            </div>

            {currentMeta ? (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
                <span>
                  {currentMeta.total.toLocaleString("es-AR")} {view === "chats" ? "chat(s)" : "archivo(s)"} · página{" "}
                  {currentMeta.current_page} de {currentMeta.last_page}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className={actionButtonClass}
                    disabled={currentMeta.current_page <= 1 || currentLoading}
                    onClick={() => changePage(-1)}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={actionButtonClass}
                    disabled={currentMeta.current_page >= currentMeta.last_page || currentLoading}
                    onClick={() => changePage(1)}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={emptyOpen}
        onOpenChange={(open) => {
          if (!open && !emptying) setEmptyOpen(false)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Vaciar papelera</DialogTitle>
            <DialogDescription>
              Se borran definitivamente {totals?.trashed.files ?? 0} archivo(s) ({formatBytes(totals?.trashed.bytes)}) y
              se libera el espacio. No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Si un nodo del bot volvió a usar alguno, ese se omite. Los mensajes que tenían un archivo ya muestran “Archivo
            no disponible”.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEmptyOpen(false)} disabled={emptying}>
              Cancelar
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => void emptyTrashNow()}
              disabled={emptying}
            >
              {emptying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Vaciar papelera
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar archivo</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1">
                <p className="break-all font-medium text-slate-900">{pendingDelete?.name}</p>
                <p className="text-xs text-slate-500">
                  {formatBytes(pendingDelete?.size_bytes)} · Se borra del disco
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-slate-600">Esta acción no se puede deshacer.</p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => void confirmForceDelete()}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkOpen}
        onOpenChange={(open) => {
          if (!open && !bulkBusy) setBulkOpen(false)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar a papelera</DialogTitle>
            <DialogDescription>
              Vas a enviar {selectedIds.size} archivo(s) ({formatBytes(selectionBytes)}) a papelera. Se pueden restaurar
              desde Papelera.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>
              Cancelar
            </Button>
            <Button className={actionButtonClass} onClick={() => void trashSelected()} disabled={bulkBusy}>
              {bulkBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Enviar a papelera
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AppShell>
  )
}
