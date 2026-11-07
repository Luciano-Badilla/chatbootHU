"use client"

import { useEffect, useState } from "react"
import { Loader2, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "shadcn/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "shadcn/components/ui/dialog"
import { Input } from "shadcn/components/ui/input"
import { Label } from "shadcn/components/ui/label"
import { cn } from "shadcn/lib/utils"

type AgendaContact = {
  id: number
  formatted_name: string | null
  phone: string | null
}

interface NewWhatsAppChatDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpened: (chatId: number) => void
}

const API_BASE = (import.meta.env.VITE_APP_URL || "").replace(/\/$/, "")

// Formato internacional: + código de país y número (entre 8 y 15 dígitos). Ej.: +5492612155672 o +14155552671.
const MANUAL_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/

// Deja solo el "+" inicial y los dígitos.
const formatManualPhone = (raw: string) => {
  const trimmed = raw.trimStart()
  const digits = trimmed.replace(/\D+/g, "")
  return `${trimmed.startsWith("+") ? "+" : ""}${digits}`
}

export default function NewWhatsAppChatDialog({ open, onOpenChange, onOpened }: NewWhatsAppChatDialogProps) {
  const [mode, setMode] = useState<"agenda" | "manual">("agenda")
  const [agendaQuery, setAgendaQuery] = useState("")
  const [agendaContacts, setAgendaContacts] = useState<AgendaContact[]>([])
  const [agendaLoading, setAgendaLoading] = useState(false)
  const [selectedAgendaId, setSelectedAgendaId] = useState<number | null>(null)
  const [manualPhone, setManualPhone] = useState("")
  const [manualName, setManualName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Búsqueda en la agenda con un pequeño retardo para no pedir en cada tecla.
  useEffect(() => {
    if (!open || mode !== "agenda") return

    let cancelled = false
    setAgendaLoading(true)
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: agendaQuery.trim() })
      fetch(`${API_BASE}/api/agenda/contacts?${params.toString()}`, { headers: { Accept: "application/json" } })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((payload) => {
          if (cancelled) return
          const contacts: AgendaContact[] = Array.isArray(payload?.contacts) ? payload.contacts : []
          setAgendaContacts(contacts.filter((contact) => Boolean(contact.phone)))
        })
        .catch(() => {
          if (!cancelled) setAgendaContacts([])
        })
        .finally(() => {
          if (!cancelled) setAgendaLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, mode, agendaQuery])

  const reset = () => {
    setMode("agenda")
    setAgendaQuery("")
    setSelectedAgendaId(null)
    setManualPhone("")
    setManualName("")
    setError(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (submitting) return
    if (!next) reset()
    onOpenChange(next)
  }

  const selectedAgenda = agendaContacts.find((contact) => contact.id === selectedAgendaId) ?? null
  const phoneToOpen = mode === "agenda" ? (selectedAgenda?.phone ?? "") : manualPhone
  const nameToOpen = mode === "agenda" ? (selectedAgenda?.formatted_name ?? "") : manualName
  const manualPhoneValid = MANUAL_PHONE_PATTERN.test(manualPhone)
  const manualDigits = manualPhone.replace(/\D/g, "").length
  // Cada regla tiene su punto: verde si se cumple, rojo si no (una vez que se empezó a escribir).
  const phoneRules = [
    { label: "Empieza con +, ej: (+549)", ok: manualPhone.startsWith("+") },
    { label: "Código de país (no empieza con 0)", ok: /^\+[1-9]/.test(manualPhone) },
    { label: `Entre 8 y 15 dígitos (hay ${manualDigits})`, ok: manualDigits >= 8 && manualDigits <= 15 },
  ]
  const canSubmit = !submitting && (mode === "agenda" ? phoneToOpen.trim() !== "" : manualPhoneValid)

  const openChat = async () => {
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/api/chats/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ phone: phoneToOpen, name: nameToOpen }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const firstValidationError = payload?.errors ? Object.values(payload.errors).flat()[0] : null
        throw new Error(String(firstValidationError ?? payload?.message ?? "No se pudo abrir el chat."))
      }

      if (payload.reopened) {
        toast.message("Ese contacto ya tenía un chat. Lo reabrimos y quedó asignado a vos.")
      } else if (payload.reused) {
        toast.message("Ese número ya tenía un chat abierto. Se abrió ese chat.")
      }

      onOpened(Number(payload.chat_id))
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el chat.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md border-[#dbe5ef]">
        <DialogHeader>
          <DialogTitle className="text-[#013765]">Nuevo chat de WhatsApp</DialogTitle>
          <DialogDescription className="text-[#013765]/70">
            Elegí un contacto de la agenda o ingresá el número con código de país. El chat queda asignado a vos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "agenda" ? "default" : "outline"}
            className={mode === "agenda" ? "bg-[#013765] text-white hover:bg-[#024a8a]" : "border-[#dbe5ef] text-[#013765]"}
            onClick={() => setMode("agenda")}
            disabled={submitting}
          >
            Desde agenda
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "manual" ? "default" : "outline"}
            className={mode === "manual" ? "bg-[#013765] text-white hover:bg-[#024a8a]" : "border-[#dbe5ef] text-[#013765]"}
            onClick={() => setMode("manual")}
            disabled={submitting}
          >
            Número manual
          </Button>
        </div>

        {mode === "agenda" ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                name="new-chat-agenda-search"
                autoComplete="off"
                placeholder="Buscar en la agenda..."
                value={agendaQuery}
                onChange={(event) => setAgendaQuery(event.target.value)}
                className="pl-10"
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-[#dbe5ef]">
              {agendaLoading ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando contactos...
                </div>
              ) : agendaContacts.length === 0 ? (
                <p className="px-3 py-4 text-sm text-slate-500">No hay contactos con teléfono para esa búsqueda.</p>
              ) : (
                agendaContacts.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => setSelectedAgendaId(contact.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50",
                      selectedAgendaId === contact.id && "bg-[#013765]/[0.06] font-medium text-[#013765]",
                    )}
                  >
                    <span className="truncate">{contact.formatted_name || contact.phone}</span>
                    <span className="shrink-0 text-xs text-slate-500">{contact.phone}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-chat-phone">Teléfono de WhatsApp</Label>
              <Input
                id="new-chat-phone"
                value={manualPhone}
                onChange={(event) => setManualPhone(formatManualPhone(event.target.value))}
                placeholder="+5492612155672"
                inputMode="tel"
                autoComplete="off"
                disabled={submitting}
                aria-invalid={manualPhone !== "" && !manualPhoneValid}
              />
              <ul className="space-y-1" aria-label="Requisitos del número">
                {phoneRules.map((rule) => (
                  <li key={rule.label} className="flex items-center gap-2 text-xs">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        manualPhone === "" ? "bg-slate-300" : rule.ok ? "bg-emerald-500" : "bg-red-500",
                      )}
                      aria-hidden="true"
                    />
                    <span className={cn(manualPhone === "" ? "text-slate-500" : rule.ok ? "text-emerald-700" : "text-red-600")}>
                      {rule.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-chat-name">Nombre (opcional)</Label>
              <Input
                id="new-chat-name"
                value={manualName}
                onChange={(event) => setManualName(event.target.value)}
                disabled={submitting}
              />
            </div>
          </div>
        )}

        {error ? <p role="alert" className="text-xs font-medium text-red-600">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" className="border-[#dbe5ef] text-[#013765]" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="button" className="bg-[#013765] text-white hover:bg-[#024a8a]" onClick={openChat} disabled={!canSubmit}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {submitting ? "Abriendo…" : "Abrir chat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
