import { useEffect, useMemo, useState } from "react"
import { Contact, Loader2, Plus, Search, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { AppShell } from "../components/AppShell"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "shadcn/components/ui/dialog"
import { Input } from "shadcn/components/ui/input"
import { cn } from "shadcn/lib/utils"

const API_BASE = import.meta.env.VITE_APP_URL || ""

type AgendaContact = {
  id?: number
  first_name?: string | null
  last_name?: string | null
  formatted_name: string
  phone: string
  organization?: string | null
  title?: string | null
  deleted_at?: string | null
}

const emptyContact: AgendaContact = {
  first_name: "",
  last_name: "",
  formatted_name: "",
  phone: "",
  organization: "",
  title: "",
}

const normalizeContactPhone = (phone: string) => phone.replace(/[^\d+]/g, "")

const validateContactData = (contact: AgendaContact) => {
  const formattedName = contact.formatted_name?.trim() || [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim()
  const phone = normalizeContactPhone(contact.phone ?? "")

  if (!formattedName) return "El nombre del contacto es obligatorio."
  if (!phone) return "El teléfono es obligatorio."
  if (!/^\+?\d+$/.test(phone)) return "El teléfono solo puede incluir números y un + inicial."
  if (phone.replace(/\D/g, "").length < 7) return "El teléfono debe tener al menos 7 dígitos."
  if (phone.replace(/\D/g, "").length > 15) return "El teléfono no puede superar los 15 dígitos."

  return ""
}

export default function AgendaPanel() {
  const [contacts, setContacts] = useState<AgendaContact[]>([])
  const [trashedContacts, setTrashedContacts] = useState<AgendaContact[]>([])
  const [query, setQuery] = useState("")
  const [trashQuery, setTrashQuery] = useState("")
  const [selected, setSelected] = useState<AgendaContact>(emptyContact)
  const [formOpen, setFormOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingTrash, setLoadingTrash] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [restoringId, setRestoringId] = useState<number | null>(null)
  const [forceDeletingId, setForceDeletingId] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({})

  const selectedExists = Boolean(selected.id)

  const loadContacts = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set("q", query.trim())
      const res = await fetch(`${API_BASE}/api/agenda/contacts?${params.toString()}`)
      const data = await res.json()
      setContacts(Array.isArray(data.contacts) ? data.contacts : [])
    } catch (error) {
      console.error("Error cargando agenda:", error)
      toast.error("No se pudo cargar la agenda")
    } finally {
      setLoading(false)
    }
  }

  const loadTrash = async () => {
    setLoadingTrash(true)
    try {
      const params = new URLSearchParams()
      params.set("trashed", "1")
      if (trashQuery.trim()) params.set("q", trashQuery.trim())
      const res = await fetch(`${API_BASE}/api/agenda/contacts?${params.toString()}`)
      const data = await res.json()
      setTrashedContacts(Array.isArray(data.contacts) ? data.contacts : [])
    } catch (error) {
      console.error("Error cargando papelera de agenda:", error)
      toast.error("No se pudo cargar la papelera")
    } finally {
      setLoadingTrash(false)
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => void loadContacts(), 250)
    return () => clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    if (!trashOpen) return
    const timeout = setTimeout(() => void loadTrash(), 250)
    return () => clearTimeout(timeout)
  }, [trashOpen, trashQuery])

  const displayName = useMemo(() => {
    const formatted = selected.formatted_name?.trim()
    if (formatted) return formatted
    return [selected.first_name, selected.last_name].filter(Boolean).join(" ")
  }, [selected])

  const selectedPhone = normalizeContactPhone(selected.phone ?? "")
  const shouldShowNameError = submitted || touchedFields.formatted_name || touchedFields.first_name || touchedFields.last_name
  const shouldShowPhoneError = submitted || touchedFields.phone
  const selectedPhoneDigits = selectedPhone.replace(/\D/g, "")
  const selectedNameError = shouldShowNameError && !displayName.trim() ? "Indicá un nombre a mostrar o completá nombre/apellido." : ""
  const selectedPhoneError = shouldShowPhoneError && !selectedPhone
    ? "El teléfono es obligatorio."
    : shouldShowPhoneError && !/^\+?\d+$/.test(selectedPhone)
      ? "El teléfono solo puede incluir números y un + inicial."
      : shouldShowPhoneError && selectedPhoneDigits.length < 7
        ? "El teléfono debe tener al menos 7 dígitos."
        : shouldShowPhoneError && selectedPhoneDigits.length > 15
          ? "El teléfono no puede superar los 15 dígitos."
      : ""

  const updateField = (field: keyof AgendaContact, value: string) => {
    setSelected((current) => ({ ...current, [field]: value }))
    setTouchedFields((current) => ({ ...current, [field]: true }))
  }

  const openNewContact = () => {
    setSelected(emptyContact)
    setSubmitted(false)
    setTouchedFields({})
    setFormOpen(true)
  }

  const openContact = (contact: AgendaContact) => {
    setSelected(contact)
    setSubmitted(false)
    setTouchedFields({})
    setFormOpen(true)
  }

  const saveContact = async () => {
    setSubmitted(true)
    const validationError = validateContactData(selected)
    if (validationError) {
      toast.error(validationError)
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...selected,
        formatted_name: displayName || "Contacto",
        phone: normalizeContactPhone(selected.phone ?? ""),
      }
      const res = await fetch(
        selected.id ? `${API_BASE}/api/agenda/contacts/${selected.id}` : `${API_BASE}/api/agenda/contacts`,
        {
          method: selected.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setSelected(data.contact ?? emptyContact)
      toast.success("Contacto guardado")
      await loadContacts()
      setFormOpen(false)
    } catch (error) {
      console.error("Error guardando contacto:", error)
      try {
        const payload = JSON.parse(error instanceof Error ? error.message : "")
        toast.error(String(payload?.message ?? "No se pudo guardar el contacto"))
      } catch {
        toast.error("No se pudo guardar el contacto")
      }
    } finally {
      setSaving(false)
    }
  }

  const sendToTrash = async (contact: AgendaContact) => {
    if (!contact.id) return
    setDeletingId(contact.id)
    try {
      const res = await fetch(`${API_BASE}/api/agenda/contacts/${contact.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Contacto enviado a papelera")
      if (selected.id === contact.id) {
        setSelected(emptyContact)
        setFormOpen(false)
      }
      await loadContacts()
    } catch (error) {
      console.error("Error eliminando contacto:", error)
      toast.error("No se pudo enviar el contacto a papelera")
    } finally {
      setDeletingId(null)
    }
  }

  const restoreContact = async (contact: AgendaContact) => {
    if (!contact.id) return
    setRestoringId(contact.id)
    try {
      const res = await fetch(`${API_BASE}/api/agenda/contacts/${contact.id}/restore`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Contacto restaurado")
      await loadTrash()
      await loadContacts()
    } catch (error) {
      console.error("Error restaurando contacto:", error)
      toast.error("No se pudo restaurar el contacto")
    } finally {
      setRestoringId(null)
    }
  }

  const forceDeleteContact = async (contact: AgendaContact) => {
    if (!contact.id) return
    setForceDeletingId(contact.id)
    try {
      const res = await fetch(`${API_BASE}/api/agenda/contacts/${contact.id}/force`, { method: "DELETE" })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Contacto eliminado definitivamente")
      await loadTrash()
    } catch (error) {
      console.error("Error eliminando definitivamente contacto:", error)
      toast.error("No se pudo eliminar definitivamente el contacto")
    } finally {
      setForceDeletingId(null)
    }
  }

  return (
    <AppShell
      currentPath="/agenda-panel"
      title="Agenda"
      subtitle="Contactos reutilizables para enviar desde el panel de mensajes."
      contentClassName="px-4 py-4 lg:px-6 lg:py-6"
      actions={
        <Button
          variant="outline"
          className="rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          onClick={() => setTrashOpen(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Papelera
        </Button>
      }
    >
      <div className="mx-auto max-w-5xl">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Contactos guardados</CardTitle>
                <CardDescription>Buscá, seleccioná o eliminá contactos reutilizables.</CardDescription>
              </div>
              <Button className="bg-[#013765] text-white hover:bg-[#012e54]" onClick={openNewContact}>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo contacto
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" placeholder="Buscar contacto..." />
            </div>
            <div className="max-h-[68vh] space-y-2 overflow-y-auto pr-1">
              {loading ? (
                <div className="flex justify-center py-8 text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : contacts.length === 0 ? (
                <p className="surface-nested rounded-xl border-dashed p-4 text-center text-sm text-slate-500">
                  No hay contactos para mostrar.
                </p>
              ) : (
                contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2 transition-colors",
                      selected.id === contact.id ? "border-[#013765] bg-[#013765]/5" : "interactive-row",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openContact(contact)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#013765]">
                        <Contact className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{contact.formatted_name}</p>
                        <p className="truncate text-xs text-slate-500">{contact.phone}</p>
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-xl text-red-500 hover:bg-red-50 hover:text-red-600"
                      onClick={() => void sendToTrash(contact)}
                      disabled={deletingId === contact.id}
                    >
                      {deletingId === contact.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedExists ? "Editar contacto" : "Nuevo contacto"}</DialogTitle>
            <DialogDescription>
              Estos datos se usan para armar la tarjeta de contacto de WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nombre" value={selected.first_name ?? ""} onChange={(value) => updateField("first_name", value)} />
              <Field label="Apellido" value={selected.last_name ?? ""} onChange={(value) => updateField("last_name", value)} />
            </div>
            <Field label="Nombre a mostrar" value={selected.formatted_name ?? ""} onChange={(value) => updateField("formatted_name", value)} placeholder={displayName || "Ej: Juan Pérez"} error={selectedNameError} />
            <Field label="Teléfono" value={selected.phone ?? ""} onChange={(value) => updateField("phone", normalizeContactPhone(value))} placeholder="Ej: 5492612155672" error={selectedPhoneError} />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Empresa" value={selected.organization ?? ""} onChange={(value) => updateField("organization", value)} />
              <Field label="Cargo" value={selected.title ?? ""} onChange={(value) => updateField("title", value)} />
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <Button onClick={saveContact} disabled={saving} className="bg-[#013765] text-white hover:bg-[#012e54]">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Guardar contacto
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Papelera de agenda</DialogTitle>
            <DialogDescription>
              Restaurá contactos eliminados o borralos definitivamente si ya no se van a reutilizar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={trashQuery}
                onChange={(e) => setTrashQuery(e.target.value)}
                className="pl-9"
                placeholder="Buscar contacto en papelera..."
              />
            </div>

            {loadingTrash ? (
              <div className="flex items-center justify-center px-6 py-10 text-sm text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cargando papelera...
              </div>
            ) : trashedContacts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                No hay contactos en la papelera.
              </p>
            ) : (
              <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                {trashedContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#013765] shadow-sm">
                        <Contact className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{contact.formatted_name}</p>
                        <p className="truncate text-xs text-slate-500">{contact.phone}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-[#013765] text-[#013765] hover:bg-[#013765] hover:text-white"
                        onClick={() => void restoreContact(contact)}
                        disabled={restoringId === contact.id}
                      >
                        {restoringId === contact.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-2 h-3.5 w-3.5" />}
                        Restaurar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => void forceDeleteContact(contact)}
                        disabled={forceDeletingId === contact.id}
                      >
                        {forceDeletingId === contact.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
                        Eliminar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  error,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  error?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  )
}
