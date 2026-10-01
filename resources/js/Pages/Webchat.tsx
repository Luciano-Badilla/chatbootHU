import { FormEvent, useEffect, useRef, useState } from "react"
import mqtt from "mqtt"
import { Loader2, Send, UserRound } from "lucide-react"

type Option = { id: string; label: string; description?: string; kind?: string }
type Message = {
  id: number
  sender: "contact" | "user"
  sender_subtype?: "contact" | "operator" | "bot"
  body: string | null
  created_at?: string
  timestamp?: string
  interactive_options?: Option[] | null
}

const SESSION_KEY = "hu.webchat.resume_token"

export default function Webchat() {
  const [token, setToken] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [profileRequired, setProfileRequired] = useState(true)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const endRef = useRef<HTMLDivElement | null>(null)

  const api = async (path: string, data: Record<string, unknown>) => {
    const response = await fetch(`${import.meta.env.VITE_APP_URL}/api/webchat/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data),
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(json.message || "No se pudo completar la operación.")
    return json
  }

  const append = (message: Message) => {
    setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
  }

  const loadSession = async (resumeToken: string) => {
    const data = await api("session", { resume_token: resumeToken })
    if (data.requires_profile) {
      setProfileRequired(true)
      return
    }
    setToken(data.resume_token)
    setProfileRequired(false)
    setMessages(data.chat.messages ?? [])
  }

  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY) ?? ""
    loadSession(saved).catch(() => setProfileRequired(true)).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!token) return
    const host = import.meta.env.VITE_MOSQUITTO_HOST
    if (!host) return
    const client = mqtt.connect(`ws://${host}:9001`)
    client.on("connect", () => client.subscribe(`webchat/${token}`))
    client.on("message", (_topic, payload) => {
      try { append(JSON.parse(payload.toString())) } catch { /* payload inválido: se recupera al recargar */ }
    })
    return () => client.end(true)
  }, [token])

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, profileRequired])

  const start = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    setSending(true)
    try {
      const data = await api("start", { first_name: firstName, last_name: lastName })
      localStorage.setItem(SESSION_KEY, data.resume_token)
      setToken(data.resume_token)
      setProfileRequired(false)
      setMessages(data.chat.messages ?? [])
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "No se pudo iniciar el chat.")
    } finally { setSending(false) }
  }

  const send = async (message: string, optionId?: string) => {
    if ((!message.trim() && !optionId) || sending) return
    setError("")
    setSending(true)
    try {
      const data = await api("send", { resume_token: token, message, option_id: optionId })
      append(data.message)
      setDraft("")
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "No se pudo enviar el mensaje.")
    } finally { setSending(false) }
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-100"><Loader2 className="h-7 w-7 animate-spin text-[#013765]" /></main>

  return (
    <main className="min-h-screen bg-slate-100 p-0 sm:p-6">
      <section className="mx-auto flex min-h-screen max-w-3xl flex-col overflow-hidden bg-white shadow-xl sm:min-h-[720px] sm:rounded-2xl">
        <header className="flex items-center gap-3 bg-[#013765] px-5 py-4 text-white">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-white/15"><UserRound className="h-5 w-5" /></div>
          <div><h1 className="font-semibold">Atención en línea</h1><p className="text-xs text-white/75">Estamos para ayudarte</p></div>
        </header>

        {profileRequired ? (
          <div className="m-auto w-full max-w-md p-6">
            <h2 className="text-xl font-semibold text-slate-900">Antes de comenzar</h2>
            <p className="mt-2 text-sm text-slate-600">Ingresá tu nombre y apellido para iniciar la conversación.</p>
            <form onSubmit={start} className="mt-6 space-y-4">
              <input required value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Nombre" className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-[#013765]" />
              <input required value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Apellido" className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-[#013765]" />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button disabled={sending} className="flex w-full items-center justify-center rounded-xl bg-[#013765] px-4 py-3 font-medium text-white disabled:opacity-60">{sending ? "Iniciando..." : "Comenzar chat"}</button>
            </form>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
              {messages.length === 0 && <p className="pt-8 text-center text-sm text-slate-500">Escribinos para comenzar la atención.</p>}
              {messages.map((message) => (
                <div key={message.id} className={message.sender === "contact" ? "flex justify-end" : "flex justify-start"}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${message.sender === "contact" ? "bg-[#013765] text-white" : "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200"}`}>
                    <p className="whitespace-pre-wrap">{message.body}</p>
                    {message.sender !== "contact" && message.interactive_options?.length ? <div className="mt-3 space-y-2">{message.interactive_options.map((option) => <button key={option.id} onClick={() => send(option.label, option.id)} disabled={sending} className="block w-full rounded-lg border border-[#013765]/30 bg-[#013765]/5 px-3 py-2 text-left text-xs font-medium text-[#013765] hover:bg-[#013765]/10 disabled:opacity-50">{option.label}{option.description ? <span className="mt-0.5 block font-normal text-slate-500">{option.description}</span> : null}</button>)}</div> : null}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <form onSubmit={(event) => { event.preventDefault(); send(draft) }} className="border-t border-slate-200 bg-white p-3">
              {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
              <div className="flex items-end gap-2"><textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft) } }} rows={1} placeholder="Escribí un mensaje..." className="max-h-28 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-[#013765]" /><button type="submit" disabled={sending || !draft.trim()} className="grid h-11 w-11 place-items-center rounded-xl bg-[#013765] text-white disabled:opacity-50"><Send className="h-5 w-5" /></button></div>
            </form>
          </>
        )}
      </section>
    </main>
  )
}
