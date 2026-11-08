import { useEffect, useState } from "react"
import { ExternalLink, FileText, Loader2, Lock, RefreshCw, Search, Trash2, TriangleAlert, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { AppShell } from "../Components/AppShell"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "shadcn/components/ui/dialog"
import { Input } from "shadcn/components/ui/input"
import { cn } from "shadcn/lib/utils"

const API_BASE = import.meta.env.VITE_APP_URL || ""
const PER_PAGE = 25

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

type PageMeta = { current_page: number; last_page: number; per_page: number; total: number }

type FileQuery = {
  status: "active" | "trashed"
  category: string
  q: string
  sort: "size" | "recent"
  page: number
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

function usageLabel(refs: References) {
  const parts: string[] = []
  if (refs.messages > 0) parts.push(`${refs.messages} mensaje(s)`)
  if (refs.bot_nodes > 0) parts.push(`${refs.bot_nodes} nodo(s) del bot`)
  return parts.join(" y ")
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      </CardContent>
    </Card>
  )
}

export default function StoragePanel() {
  const [summary, setSummary] = useState<StorageSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [files, setFiles] = useState<StorageFile[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [query, setQuery] = useState<FileQuery>({ status: "active", category: "", q: "", sort: "size", page: 1 })
  const [search, setSearch] = useState("")
  const [reloadKey, setReloadKey] = useState(0)
  // Sube cuando termina el resumen (que escanea el disco). La lista espera a ese paso
  // para no leer el registro antes de que se carguen los archivos existentes.
  const [syncVersion, setSyncVersion] = useState(0)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] = useState<StorageFile | null>(null)
  const [deleting, setDeleting] = useState(false)

  const totals = summary?.totals

  const refresh = () => setReloadKey((key) => key + 1)

  const patchQuery = (patch: Partial<FileQuery>) => setQuery((current) => ({ ...current, page: 1, ...patch }))

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const term = search.trim()
      setQuery((current) => (current.q === term ? current : { ...current, q: term, page: 1 }))
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
    if (syncVersion === 0) return

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

    requestJson<{ items: StorageFile[]; meta: PageMeta }>(`${API_BASE}/api/storage/files?${params.toString()}`)
      .then((data) => {
        if (!cancelled) {
          setFiles(data.items)
          setMeta(data.meta)
        }
      })
      .catch((error) => {
        console.error("Error cargando los archivos:", error)
        if (!cancelled) toast.error("No se pudieron cargar los archivos.")
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false)
      })

    return () => {
      cancelled = true
    }
  }, [query, syncVersion])

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

  return (
    <AppShell
      currentPath="/storage-panel"
      title="Almacenamiento"
      subtitle="Cuánto ocupan los archivos de chats y flujos, y qué se puede liberar."
      contentClassName="px-4 py-4 lg:px-6 lg:py-6"
      actions={
        <Button
          variant="outline"
          className="rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          onClick={refresh}
          disabled={loadingSummary}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", loadingSummary && "animate-spin")} />
          Actualizar
        </Button>
      }
    >
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Card className="self-start">
            <CardHeader>
              <CardTitle>Por categoría</CardTitle>
              <CardDescription>Tocá una categoría para filtrar la lista.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {summary?.categories.map((category) => {
                const bytes = category.active.bytes + category.trashed.bytes
                const files = category.active.files + category.trashed.files
                const share = totals && totals.bytes > 0 ? (bytes / totals.bytes) * 100 : 0
                const selected = query.category === category.key

                return (
                  <button
                    key={category.key}
                    type="button"
                    onClick={() => patchQuery({ category: selected ? "" : category.key })}
                    className={cn(
                      "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                      selected ? "border-[#013765] bg-[#013765]/5" : "interactive-row",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">{category.label}</p>
                        {!category.actionable ? (
                          <Badge variant="secondary" className="gap-1 whitespace-nowrap">
                            <Lock className="h-3 w-3" />
                            Solo lectura
                          </Badge>
                        ) : null}
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-slate-900">{formatBytes(bytes)}</p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
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
                <div className="flex justify-center py-6 text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Archivos</CardTitle>
              <CardDescription>
                Un archivo en uso por un mensaje o un nodo del bot no se puede enviar a papelera ni borrar, para que el
                historial no se rompa.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border bg-white p-1">
                  {(["active", "trashed"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => patchQuery({ status })}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                        query.status === status ? "bg-[#013765] text-white" : "text-slate-600 hover:bg-slate-100",
                      )}
                    >
                      {status === "active" ? "Activos" : "Papelera"}
                    </button>
                  ))}
                </div>
                <select
                  aria-label="Categoría"
                  value={query.category}
                  onChange={(event) => patchQuery({ category: event.target.value })}
                  className="h-9 rounded-md border border-input bg-white px-3 text-sm"
                >
                  <option value="">Todas las categorías</option>
                  {summary?.categories.map((category) => (
                    <option key={category.key} value={category.key}>
                      {category.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Orden"
                  value={query.sort}
                  onChange={(event) => patchQuery({ sort: event.target.value as FileQuery["sort"] })}
                  className="h-9 rounded-md border border-input bg-white px-3 text-sm"
                >
                  <option value="size">Mayor tamaño</option>
                  <option value="recent">Más reciente</option>
                </select>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  type="search"
                  name="storage-file-search"
                  autoComplete="off"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-9"
                  placeholder="Buscar por nombre o ruta..."
                />
              </div>

              <div className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
                {loadingFiles ? (
                  <div className="flex justify-center py-8 text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : files.length === 0 ? (
                  <p className="rounded-xl border border-dashed p-4 text-center text-sm text-slate-500">
                    No hay archivos en esta vista.
                  </p>
                ) : (
                  files.map((file) => {
                    const busy = busyId === file.id

                    return (
                      <div key={file.id} className="rounded-xl border px-3 py-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#013765]">
                            <FileText className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="break-all text-sm font-semibold text-slate-900" title={file.path}>
                              {file.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              {file.category_label} · {formatBytes(file.size_bytes)} · {formatDate(file.modified_at)}
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {file.in_use ? (
                                <Badge
                                  variant="secondary"
                                  className="bg-amber-100 text-amber-800 hover:bg-amber-100"
                                  title={usageLabel(file.references)}
                                >
                                  En uso · {file.references.total}
                                </Badge>
                              ) : file.actionable ? (
                                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                                  Libre
                                </Badge>
                              ) : null}
                              {file.trashed ? (
                                <Badge variant="outline">Papelera desde {formatDate(file.deleted_at)}</Badge>
                              ) : null}
                            </div>
                            {file.blocked_reason ? (
                              <p className="mt-1.5 text-xs text-amber-700">{file.blocked_reason}</p>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <Button variant="outline" size="sm" className="rounded-lg" asChild>
                            <a href={`${API_BASE}${file.url}`} target="_blank" rel="noreferrer">
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Abrir
                            </a>
                          </Button>

                          {file.trashed ? (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg"
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
                                Eliminar definitivamente
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-lg"
                              onClick={() => void sendToTrash(file)}
                              disabled={busy || !file.can_trash}
                              title={file.blocked_reason ?? "Enviar a papelera"}
                            >
                              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                              Enviar a papelera
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {meta ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                  <span>
                    {meta.total.toLocaleString("es-AR")} archivo(s) · página {meta.current_page} de {meta.last_page}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      disabled={meta.current_page <= 1 || loadingFiles}
                      onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      disabled={meta.current_page >= meta.last_page || loadingFiles}
                      onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar definitivamente</DialogTitle>
            <DialogDescription>
              Se borra <span className="font-medium text-slate-900">{pendingDelete?.name}</span> (
              {formatBytes(pendingDelete?.size_bytes)}) del disco. No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Ningún mensaje ni nodo del bot usa este archivo. El servidor vuelve a verificarlo antes de borrarlo.</p>
          </div>
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
              Eliminar definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
