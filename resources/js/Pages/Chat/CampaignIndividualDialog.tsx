import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "shadcn/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "shadcn/components/ui/dialog"
import { Input } from "shadcn/components/ui/input"
import { Label } from "shadcn/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "shadcn/components/ui/select"
import type { Chat } from "./ChatPanel"

type WhatsAppTemplateOption = {
  id: number
  name: string
  language: string
  body: string
  variable_keys: string[]
}

const API_BASE = (import.meta.env.VITE_APP_URL || "").replace(/\/$/, "")

// Lo que cambia en el chat tras archivarlo: lo usan el botón "Finalizar atención" (admin) y la campaña individual.
export const adminArchiveUpdate = (result: any) => ({
  operator_id: null, operator_name: null, bot_enabled: true,
  status: result.chat.status, attention_status: result.chat.attention_status,
  assigned_at: result.chat.assigned_at, closed_at: result.chat.closed_at, closed_by: result.chat.closed_by,
  bot_flow_id: result.chat.bot_flow_id, bot_flow_name: result.chat.bot_flow_name, bot_node_id: result.chat.bot_node_id, bot_node_name: result.chat.bot_node_name,
  bot_step: result.chat.bot_step, bot_state: result.chat.bot_state,
})

interface CampaignIndividualDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chat: Chat
  canAdminister: boolean
  canFinishAttention: boolean
  onChatUpdated?: (update: Partial<Chat>) => void
  onFinishAttention?: () => Promise<boolean> | void
}

export default function CampaignIndividualDialog({
  open,
  onOpenChange,
  chat,
  canAdminister,
  canFinishAttention,
  onChatUpdated,
  onFinishAttention,
}: CampaignIndividualDialogProps) {
  const [whatsappTemplates, setWhatsappTemplates] = useState<WhatsAppTemplateOption[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState("")
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({})
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [sendingTemplate, setSendingTemplate] = useState(false)
  const selectedTemplate = whatsappTemplates.find((template) => String(template.id) === selectedTemplateId) ?? null

  // Cada vez que se abre, carga las plantillas aprobadas y limpia el formulario.
  useEffect(() => {
    if (!open) return

    let cancelled = false
    setSelectedTemplateId("")
    setTemplateVariables({})
    setTemplateError(null)
    setTemplatesLoading(true)

    fetch(`${API_BASE}/api/campaign-templates`, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.message || "No se pudieron cargar las plantillas.")
        return payload
      })
      .then((payload) => {
        if (!cancelled) setWhatsappTemplates(Array.isArray(payload.templates) ? payload.templates : [])
      })
      .catch((error) => {
        if (!cancelled) setTemplateError(error instanceof Error ? error.message : "No se pudieron cargar las plantillas.")
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open])

  const renderTemplatePreview = (template: WhatsAppTemplateOption, values: Record<string, string>) =>
    template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (placeholder, position: string) => {
      const key = template.variable_keys[Number(position) - 1]
      const value = key ? (values[key] ?? "").trim() : ""
      return value !== "" ? value : placeholder
    })

  const sendTemplateToChat = async () => {
    if (!chat?.id || !selectedTemplate || sendingTemplate) return

    const variables: Record<string, string> = {}
    for (const key of selectedTemplate.variable_keys) {
      const value = (templateVariables[key] ?? "").trim()
      if (!value) {
        setTemplateError("Completá todas las variables antes de enviar.")
        return
      }
      variables[key] = value
    }

    setSendingTemplate(true)
    setTemplateError(null)

    try {
      const response = await fetch(`${API_BASE}/api/message/send-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ chat_id: chat.id, whatsapp_template_id: selectedTemplate.id, variables }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || payload.message || "No se pudo enviar la plantilla.")

      onOpenChange(false)

      // Misma acción que el botón de Acciones que ve el usuario: admin archiva el chat;
      // si no, el operador asignado finaliza la atención.
      let attention: "archived" | "finished" | "none" | "failed" = "none"
      try {
        if (canAdminister) {
          if (chat.status === "open") {
            const archiveRes = await fetch(`${API_BASE}/api/chats/${chat.id}/archive`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({}),
            })
            const archivePayload = await archiveRes.json().catch(() => ({}))
            if (!archiveRes.ok || !archivePayload?.chat) throw new Error(archivePayload.message || "No se pudo archivar el chat.")
            onChatUpdated?.(adminArchiveUpdate(archivePayload))
            attention = "archived"
          }
        } else if (canFinishAttention && onFinishAttention) {
          attention = (await onFinishAttention()) === true ? "finished" : "failed"
        }
      } catch {
        attention = "failed"
      }

      if (attention === "archived") {
        toast.success("Campaña individual enviada. Chat archivado y bot reactivado.")
      } else if (attention === "finished") {
        toast.success("Campaña individual enviada. Atención finalizada.")
      } else if (attention === "failed") {
        toast.error("La campaña se envió, pero no se pudo finalizar la atención. Usá el botón Finalizar atención.")
      } else {
        toast.success("Campaña individual enviada. No había atención activa para finalizar.")
      }
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : "No se pudo enviar la plantilla.")
    } finally {
      setSendingTemplate(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!sendingTemplate) onOpenChange(next) }}>
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col overflow-hidden border-[#dbe5ef]">
        <DialogHeader>
          <DialogTitle className="text-[#013765]">Campaña individual</DialogTitle>
          <DialogDescription className="text-[#013765]/70">
            Enviá una plantilla aprobada solo a {chat.name}. Completá las variables a mano.
            {canFinishAttention ? " Al enviarla, la atención de este chat se finaliza y el bot vuelve a activarse." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <div className="grid gap-5 md:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4 rounded-xl border border-[#dbe5ef] bg-slate-50/60 p-4">
              <div className="space-y-2">
                <Label>Plantilla aprobada</Label>
                {templatesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando plantillas...</div>
                ) : whatsappTemplates.length === 0 ? (
                  <p className="text-sm text-slate-600">No hay plantillas aprobadas disponibles. Podés sincronizarlas desde Campañas.</p>
                ) : (
                  <Select value={selectedTemplateId} onValueChange={(value) => { setSelectedTemplateId(value); setTemplateVariables({}); setTemplateError(null) }} disabled={sendingTemplate}>
                    <SelectTrigger><SelectValue placeholder="Seleccioná una plantilla" /></SelectTrigger>
                    <SelectContent>
                      {whatsappTemplates.map((template) => (
                        <SelectItem key={template.id} value={String(template.id)}>{template.name} · {template.language}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {selectedTemplate ? (
                <>
                  {selectedTemplate.variable_keys.map((key, index) => (
                    <div key={key} className="space-y-1">
                      <label htmlFor={`template-variable-${index}`} className="text-xs font-medium text-slate-700">
                        {`Variable {{${index + 1}}}`}
                        {key !== `variable_${index + 1}` ? <span className="ml-1 font-normal text-slate-400">({key})</span> : null}
                      </label>
                      <Input
                        id={`template-variable-${index}`}
                        value={templateVariables[key] ?? ""}
                        onChange={(event) => setTemplateVariables((prev) => ({ ...prev, [key]: event.target.value }))}
                        maxLength={1000}
                        disabled={sendingTemplate}
                        placeholder="Escribí el valor"
                      />
                    </div>
                  ))}
                </>
              ) : null}
              {templateError ? <p role="alert" className="text-xs font-medium text-red-600">{templateError}</p> : null}
            </div>
            <div>
              <div className="mt-2 flex justify-center rounded-xl border border-[#dbe5ef] bg-white p-3">
                <div className="flex h-[310px] w-full max-w-[220px] flex-col overflow-hidden rounded-[1.5rem] border-[5px] border-slate-800 bg-white shadow-md">
                  <div className="flex h-5 shrink-0 items-center justify-between bg-white px-3 text-[8px] font-semibold text-slate-700">
                    <span>9:41</span>
                    <span className="flex items-end gap-0.5" aria-hidden="true">
                      <span className="h-1 w-1 rounded-full bg-slate-700" />
                      <span className="h-1.5 w-1 rounded-full bg-slate-700" />
                      <span className="h-2 w-1 rounded-full bg-slate-700" />
                      <span className="ml-1 h-2 w-4 rounded-sm border border-slate-500"><span className="m-[1px] block h-1 w-2.5 rounded-[1px] bg-emerald-500" /></span>
                    </span>
                  </div>
                  <div className="flex h-11 shrink-0 items-center gap-2 bg-[#075e54] px-2.5 text-white">
                    <div className="grid h-7 w-7 place-items-center rounded-full bg-white/15 text-[9px] font-bold">HU</div>
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-semibold">Hospital Universitario</p>
                      <p className="text-[8px] text-white/75">en línea</p>
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-y-auto p-2.5" style={{ backgroundColor: "#efeae2", backgroundImage: "radial-gradient(#d7d0c5 0.65px, transparent 0.65px)", backgroundSize: "12px 12px" }}>
                    {selectedTemplate ? (
                      <div className="max-w-[96%] self-start rounded-xl rounded-bl-sm bg-white px-2.5 py-2 shadow-sm">
                        <p className="whitespace-pre-wrap break-words text-[10px] leading-[1.4] text-slate-800">{renderTemplatePreview(selectedTemplate, templateVariables)}</p>
                        <p className="mt-1 text-right text-[8px] leading-none text-slate-400">9:41</p>
                      </div>
                    ) : (
                      <p className="rounded-xl bg-white/90 px-2 py-2 text-center text-[10px] text-slate-500 shadow-sm">Seleccioná una plantilla para ver el mensaje.</p>
                    )}
                  </div>
                  <div className="flex h-9 shrink-0 items-center gap-1.5 bg-white px-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full border border-slate-200 text-sm leading-none text-slate-400">+</span>
                    <span className="flex-1 rounded-full border border-slate-200 px-2.5 py-1 text-[8px] text-slate-400">Mensaje</span>
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-[#075e54] text-[8px] text-white">➤</span>
                  </div>
                </div>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">Las variables sin completar se muestran como {"{{n}}"}.</p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 bg-background pt-4">
          <Button variant="outline" className="border-[#dbe5ef] text-[#013765] hover:bg-[#013765]/[0.04]" disabled={sendingTemplate} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            className="bg-[#013765] text-white hover:bg-[#024a8a]"
            disabled={sendingTemplate || !selectedTemplate || selectedTemplate.variable_keys.some((key) => (templateVariables[key] ?? "").trim() === "")}
            onClick={sendTemplateToChat}
          >
            {sendingTemplate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {sendingTemplate ? "Enviando…" : "Enviar campaña"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
