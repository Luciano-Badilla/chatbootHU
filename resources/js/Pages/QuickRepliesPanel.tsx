import { useEffect, useState } from "react"
import { Loader2, MessageSquareText, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { AppShell } from "../components/AppShell"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "shadcn/components/ui/dialog"
import { Input } from "shadcn/components/ui/input"

const API_BASE = import.meta.env.VITE_APP_URL || ""

type QuickReply = {
  id?: number
  title: string
  body: string
}

const emptyReply: QuickReply = { title: "", body: "" }

export default function QuickRepliesPanel() {
  const [replies, setReplies] = useState<QuickReply[]>([])
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<QuickReply>(emptyReply)
  const [formOpen, setFormOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [replyToDelete, setReplyToDelete] = useState<QuickReply | null>(null)

  const loadReplies = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set("q", query.trim())
      const response = await fetch(`${API_BASE}/api/quick-replies?${params.toString()}`)
      if (!response.ok) throw new Error(await response.text())
      const data = await response.json()
      setReplies(Array.isArray(data.quick_replies) ? data.quick_replies : [])
    } catch (error) {
      console.error("Error cargando respuestas rápidas:", error)
      toast.error("No se pudieron cargar las respuestas rápidas")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => void loadReplies(), 250)
    return () => clearTimeout(timeout)
  }, [query])

  const openForm = (reply: QuickReply = emptyReply) => {
    setSelected({ ...reply })
    setFormOpen(true)
  }

  const saveReply = async () => {
    if (!selected.title.trim() || !selected.body.trim()) {
      toast.error("Completá el nombre y el mensaje")
      return
    }

    setSaving(true)
    try {
      const response = await fetch(
        selected.id ? `${API_BASE}/api/quick-replies/${selected.id}` : `${API_BASE}/api/quick-replies`,
        {
          method: selected.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selected),
        },
      )
      if (!response.ok) throw new Error(await response.text())
      toast.success(selected.id ? "Respuesta actualizada" : "Respuesta creada")
      setFormOpen(false)
      await loadReplies()
    } catch (error) {
      console.error("Error guardando respuesta rápida:", error)
      toast.error("No se pudo guardar la respuesta")
    } finally {
      setSaving(false)
    }
  }

  const deleteReply = async (reply: QuickReply) => {
    if (!reply.id) return
    setDeletingId(reply.id)
    try {
      const response = await fetch(`${API_BASE}/api/quick-replies/${reply.id}`, { method: "DELETE" })
      if (!response.ok) throw new Error(await response.text())
      toast.success("Respuesta eliminada")
      setReplyToDelete(null)
      await loadReplies()
    } catch (error) {
      console.error("Error eliminando respuesta rápida:", error)
      toast.error("No se pudo eliminar la respuesta")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <AppShell
      currentPath="/quick-replies-panel"
      title="Respuestas rápidas"
      subtitle="Mensajes reutilizables para los operadores del chat."
      contentClassName="px-4 py-4 lg:px-6 lg:py-6"
    >
      <div className="mx-auto max-w-5xl">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Mensajes guardados</CardTitle>
                <CardDescription>Creá, modificá, activá o eliminá respuestas del menú del chat.</CardDescription>
              </div>
              <Button className="bg-[#013765] text-white hover:bg-[#012e54]" onClick={() => openForm()}>
                <Plus className="mr-2 h-4 w-4" /> Nueva respuesta
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Buscar respuesta..." />
            </div>
            <div className="space-y-2">
              {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>
              ) : replies.length === 0 ? (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">No hay respuestas para mostrar.</p>
              ) : replies.map((reply) => (
                <div key={reply.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#013765]">
                    <MessageSquareText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{reply.title}</p>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">{reply.body}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="border border-slate-200 text-slate-600 hover:border-[#013765]/40 hover:bg-slate-50 hover:text-[#013765]" onClick={() => openForm(reply)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="border border-red-200 text-red-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600" disabled={deletingId === reply.id} onClick={() => setReplyToDelete(reply)}>
                    {deletingId === reply.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selected.id ? "Editar respuesta rápida" : "Nueva respuesta rápida"}</DialogTitle>
            <DialogDescription>El operador podrá cargar este texto desde el chat y editarlo antes de enviarlo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Nombre</label>
              <Input value={selected.title} maxLength={100} onChange={(event) => setSelected((current) => ({ ...current, title: event.target.value }))} placeholder="Ej: Saludo inicial" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Mensaje</label>
              <textarea value={selected.body} maxLength={2000} rows={6} onChange={(event) => setSelected((current) => ({ ...current, body: event.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#013765] focus:outline-none focus:ring-2 focus:ring-[#013765]/20" placeholder="Escribí el mensaje..." />
              <p className="mt-1 text-right text-xs text-slate-400">{selected.body.length}/2000</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
              <Button className="bg-[#013765] text-white hover:bg-[#012e54]" disabled={saving} onClick={() => void saveReply()}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(replyToDelete)} onOpenChange={(open) => !open && !deletingId && setReplyToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar respuesta rápida</DialogTitle>
            <DialogDescription>
              Esta respuesta dejará de estar disponible para todos los operadores.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">{replyToDelete?.title}</p>
            <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-500">{replyToDelete?.body}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={Boolean(deletingId)} onClick={() => setReplyToDelete(null)}>
              Cancelar
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={!replyToDelete || Boolean(deletingId)}
              onClick={() => replyToDelete && void deleteReply(replyToDelete)}
            >
              {deletingId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
