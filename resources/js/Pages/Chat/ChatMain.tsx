"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { AudioLines, Bot, ChevronDown, ChevronUp, Clock3, Contact, ExternalLink, FileText, Headset, ImageIcon, MapPin, Mic, MessageSquare, Play, Plus, Search, Send, Square, User, Video, X } from "lucide-react"
import { Button } from "shadcn/components/ui/button"
import { Input } from "shadcn/components/ui/input"
import { Avatar } from "shadcn/components/ui/avatar"
import { Badge } from "shadcn/components/ui/badge"
import type { Chat, Message } from "./ChatPanel"
import { cn } from "shadcn/lib/utils"
import mqtt from "mqtt"
import { toast } from "sonner"
import { format, isToday, isYesterday, parseISO } from "date-fns"
import { es } from "date-fns/locale"

interface ChatMainProps {
  chat?: Chat
  readOnly?: boolean
  readOnlyOperatorName?: string | null
  readOnlyReason?: "operator" | "bot" | null
}

type PreviewMedia = {
  url?: string
  name: string
  type: "image" | "video" | "audio" | "document" | "contacts"
  contact?: {
    name: string
    phone: string
    organization?: string
    title?: string
  }
}

type PendingMedia = {
  file: File
  type: "image" | "video" | "audio" | "document"
  previewUrl: string
}

type AgendaContact = {
  id?: number
  first_name?: string | null
  last_name?: string | null
  formatted_name: string
  phone: string
  organization?: string | null
  title?: string | null
}

const emptyAgendaContact: AgendaContact = {
  first_name: "",
  last_name: "",
  formatted_name: "",
  phone: "",
  organization: "",
  title: "",
}

const normalizeContactPhone = (phone: string) => phone.replace(/[^\d+]/g, "")

const validateContactDraft = (draft: AgendaContact) => {
  const formattedName = draft.formatted_name?.trim() || [draft.first_name, draft.last_name].filter(Boolean).join(" ").trim()
  const phone = normalizeContactPhone(draft.phone ?? "")

  if (!formattedName) return "El nombre del contacto es obligatorio."
  if (!phone) return "El teléfono es obligatorio."
  if (!/^\+?\d+$/.test(phone)) return "El teléfono solo puede incluir números y un + inicial."
  if (phone.replace(/\D/g, "").length < 7) return "El teléfono debe tener al menos 7 dígitos."
  if (phone.replace(/\D/g, "").length > 15) return "El teléfono no puede superar los 15 dígitos."

  return ""
}

export default function ChatMain({
  chat,
  readOnly = false,
  readOnlyOperatorName = null,
  readOnlyReason = null,
}: ChatMainProps) {
  const [newMessage, setNewMessage] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [preview, setPreview] = useState<PreviewMedia | null>(null)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [highlightBlinkOn, setHighlightBlinkOn] = useState(true)
  const [pendingMediaList, setPendingMediaList] = useState<PendingMedia[]>([])
  const [recordingAudio, setRecordingAudio] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [audioDurations, setAudioDurations] = useState<Record<string, number>>({})
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResultIds, setSearchResultIds] = useState<string[]>([])
  const [activeSearchIndex, setActiveSearchIndex] = useState(0)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [contactModalOpen, setContactModalOpen] = useState(false)
  const [agendaContacts, setAgendaContacts] = useState<AgendaContact[]>([])
  const [agendaSearch, setAgendaSearch] = useState("")
  const [contactDraft, setContactDraft] = useState<AgendaContact>(emptyAgendaContact)
  const [sendingContact, setSendingContact] = useState(false)
  const [saveContactPromptOpen, setSaveContactPromptOpen] = useState(false)
  const [lastSentContactDraft, setLastSentContactDraft] = useState<AgendaContact | null>(null)
  const [contactSubmitted, setContactSubmitted] = useState(false)
  const [contactTouchedFields, setContactTouchedFields] = useState<Record<string, boolean>>({})

  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const highlightBlinkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mediaRecorderRef = useRef<any | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pendingMediaRef = useRef<PendingMedia[]>([])
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const previousSearchQueryRef = useRef("")

  const loadOpusMediaRecorder = async () => {
    const win = window as Window & {
      OpusMediaRecorder?: any
      __opusMediaRecorderLoading?: Promise<any>
    }

    if (win.OpusMediaRecorder) return win.OpusMediaRecorder
    if (win.__opusMediaRecorderLoading) return win.__opusMediaRecorderLoading

    win.__opusMediaRecorderLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script")
      script.src = "https://cdn.jsdelivr.net/npm/opus-media-recorder@0.8.0/OpusMediaRecorder.umd.js"
      script.async = true
      script.onload = () => {
        if (win.OpusMediaRecorder) {
          resolve(win.OpusMediaRecorder)
          return
        }
        reject(new Error("OpusMediaRecorder no disponible en window"))
      }
      script.onerror = () => reject(new Error("No se pudo cargar opus-media-recorder"))
      document.head.appendChild(script)
    })

    return win.__opusMediaRecorderLoading
  }

  const createCdnWorker = (url: string) => {
    const blob = new Blob([`importScripts("${url}")`], { type: "application/javascript" })
    const blobUrl = URL.createObjectURL(blob)
    const worker = new Worker(blobUrl)
    URL.revokeObjectURL(blobUrl)
    return worker
  }

  // 🔹 Helper para armar la URL del media
  const buildMediaSrc = (url?: string | null) => {
    if (!url) return ""

    // Si ya viene absoluta, la dejamos
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url
    }

    // Ruta relativa (/storage/...) → la pegamos al VITE_APP_URL
    const base = (import.meta.env.VITE_APP_URL || "").replace(/\/$/, "")
    return `${base}${url}`
  }

  // 🔹 Cargar mensajes cuando cambia el chat seleccionado
  useEffect(() => {
    if (!chat) {
      setMessages([])
      return
    }

    const fetchMessages = async () => {
      try {
        setLoading(true)

        const res = await fetch(
          `${import.meta.env.VITE_APP_URL}/api/chat/messages/${chat.id}`,
        )

        if (!res.ok) {
          console.error("Error al cargar mensajes", await res.text())
          return
        }

        const data = await res.json()

        const msgs: Message[] = (Array.isArray(data) ? data : data.messages).map(
          (m: any) => ({
            id: m.id,
            sender: m.sender === "user" ? "user" : "contact",
            sender_subtype: m.sender_subtype ?? (m.sender === "contact" ? "contact" : "operator"),
            bot_node_type: m.bot_node_type ?? null,
            interactive_options: Array.isArray(m.interactive_options) ? m.interactive_options : null,
            body: m.body,
            timestamp: m.timestamp ?? m.created_at ?? new Date().toISOString(),
            message_type: m.message_type ?? "text",
            media_url: m.media_url ?? null,
            media_name: m.media_name ?? null,
          }),
        )

        setMessages(msgs)
      } catch (err) {
        console.error("Error de red al cargar mensajes:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchMessages()
  }, [chat?.id])

  // 🔹 MQTT: escuchar mensajes en tiempo real del chat actual
  useEffect(() => {
    if (!chat) return

    const mosquitto_host = (import.meta.env.VITE_MOSQUITTO_HOST);

    const client = mqtt.connect("ws://" + mosquitto_host + ":9001")

    client.on("connect", () => {
      const topic = `chat/${chat.id}`
      client.subscribe(topic)
    })

    client.on("message", (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString())

        if (String(data.chat_id) !== String(chat.id)) return

        const incoming: Message = {
          id: data.message_id ?? data.id ?? `mqtt-${Date.now()}`,
          sender: data.sender === "user" ? "user" : "contact",
          sender_subtype: data.sender_subtype ?? (data.sender === "contact" ? "contact" : "operator"),
          bot_node_type: data.bot_node_type ?? null,
          interactive_options: Array.isArray(data.interactive_options) ? data.interactive_options : null,
          body: data.body ?? null,
          timestamp: data.timestamp ?? new Date().toISOString(),
          message_type: data.message_type ?? "text",
          media_url: data.media_url ?? null,
          media_name: data.media_name ?? null,
        }

        setMessages((prev) => {
          const exists = prev.some(
            (m) => String(m.id) === String(incoming.id),
          )
          if (exists) return prev
          return [...prev, incoming]
        })
      } catch (err) {
        console.error("Error procesando mensaje MQTT en ChatMain:", err)
      }
    })

  return () => {
      client.end()
    }
  }, [chat?.id])

  // 🔹 Scroll al último mensaje
  useEffect(() => {
    if (searchOpen && searchQuery.trim()) return
    if (!messagesEndRef.current) return
    messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
  }, [messages.length, chat?.id, searchOpen, searchQuery])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const updateVisibility = () => {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      setShowScrollToBottom(distanceToBottom > 220)
    }

    updateVisibility()
    container.addEventListener("scroll", updateVisibility)

  return () => container.removeEventListener("scroll", updateVisibility)
  }, [chat?.id, messages.length])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    pendingMediaRef.current = pendingMediaList
  }, [pendingMediaList])

  useEffect(() => {

  return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
      if (highlightBlinkIntervalRef.current) {
        clearInterval(highlightBlinkIntervalRef.current)
      }
      pendingMediaRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      }
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current)
      }
    }
  }, [])

  const highlightMessage = (messageId?: string | null) => {
    if (!messageId) return
    setHighlightedMessageId(messageId)
    setHighlightBlinkOn(true)

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
    }
    if (highlightBlinkIntervalRef.current) {
      clearInterval(highlightBlinkIntervalRef.current)
    }

    highlightBlinkIntervalRef.current = setInterval(() => {
      setHighlightBlinkOn((prev) => !prev)
    }, 280)

    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedMessageId(null)
      setHighlightBlinkOn(true)
      if (highlightBlinkIntervalRef.current) {
        clearInterval(highlightBlinkIntervalRef.current)
        highlightBlinkIntervalRef.current = null
      }
    }, 3200)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery("")
    setSearchResultIds([])
    setActiveSearchIndex(0)
    previousSearchQueryRef.current = ""
  }

  const goToPreviousSearchResult = () => {
    if (searchResultIds.length === 0) return
    setActiveSearchIndex((prev) => (prev - 1 + searchResultIds.length) % searchResultIds.length)
  }

  const goToNextSearchResult = () => {
    if (searchResultIds.length === 0) return
    setActiveSearchIndex((prev) => (prev + 1) % searchResultIds.length)
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      closeSearch()
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      if (event.shiftKey) {
        goToPreviousSearchResult()
      } else {
        goToNextSearchResult()
      }
    }
  }

  useEffect(() => {
    const onScrollToDate = (event: Event) => {
      const customEvent = event as CustomEvent<{ chatId?: string; dateKey?: string }>
      const eventChatId = String(customEvent?.detail?.chatId ?? "")
      const currentChatId = String(chat?.id ?? "")
      const dateKey = String(customEvent?.detail?.dateKey ?? "")

      if (!chat?.id || !dateKey || eventChatId !== currentChatId) return

      requestAnimationFrame(() => {
        const target = messagesContainerRef.current?.querySelector(
          `[data-date-key="${dateKey}"]`,
        ) as HTMLElement | null
        if (!target) return
        target.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    }

    window.addEventListener("chat:scrollToDate", onScrollToDate as EventListener)

  return () => {
      window.removeEventListener("chat:scrollToDate", onScrollToDate as EventListener)
    }
  }, [chat?.id])

  useEffect(() => {
    const onScrollToVar = (event: Event) => {
      const customEvent = event as CustomEvent<{
        chatId?: string
        dateKey?: string
        updatedAt?: string | null
      }>
      const eventChatId = String(customEvent?.detail?.chatId ?? "")
      const currentChatId = String(chat?.id ?? "")
      if (!chat?.id || eventChatId !== currentChatId) return

      const container = messagesContainerRef.current
      if (!container) return

      const targetMs = toMillis(customEvent?.detail?.updatedAt ?? null)
      if (targetMs !== null) {
        const nodes = container.querySelectorAll("[data-msg-ts]") as NodeListOf<HTMLElement>
        let bestNode: HTMLElement | null = null
        let bestDiff = Number.POSITIVE_INFINITY

        nodes.forEach((node) => {
          const nodeMs = toMillis(node.dataset.msgTs ?? null)
          if (nodeMs === null) return
          const diff = Math.abs(nodeMs - targetMs)
          if (diff < bestDiff) {
            bestDiff = diff
            bestNode = node
          }
        })

        if (bestNode) {
          bestNode.scrollIntoView({ behavior: "smooth", block: "center" })
          highlightMessage(bestNode.dataset.msgId ?? null)
          return
        }
      }

      const dateKey = String(customEvent?.detail?.dateKey ?? "")
      if (!dateKey) return
      const separator = container.querySelector(
        `[data-date-key="${dateKey}"]`,
      ) as HTMLElement | null
      if (!separator) return
      separator.scrollIntoView({ behavior: "smooth", block: "start" })
      const firstMessageOfDate = container.querySelector(
        `[data-msg-date-key="${dateKey}"]`,
      ) as HTMLElement | null
      highlightMessage(firstMessageOfDate?.dataset.msgId ?? null)
    }

    window.addEventListener("chat:scrollToVar", onScrollToVar as EventListener)

  return () => {
      window.removeEventListener("chat:scrollToVar", onScrollToVar as EventListener)
    }
  }, [chat?.id, messages])

  useEffect(() => {
    if (!chat?.id) return
    setSearchOpen(false)
    setSearchQuery("")
    setSearchResultIds([])
    setActiveSearchIndex(0)
    previousSearchQueryRef.current = ""
  }, [chat?.id])

  useEffect(() => {
    if (!searchOpen) return
    const timer = setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }, 0)

  return () => clearTimeout(timer)
  }, [searchOpen])

  useEffect(() => {
    if (!searchOpen) return

    const query = searchQuery.trim().toLowerCase()
    const queryChanged = previousSearchQueryRef.current !== query
    previousSearchQueryRef.current = query

    if (!query) {
      setSearchResultIds([])
      setActiveSearchIndex(0)
      return
    }

    const resultIds = messages
      .filter((message) => {
        const haystack = `${message.body ?? ""} ${message.media_name ?? ""}`.toLowerCase()
        return haystack.includes(query)
      })
      .map((message) => String(message.id))

    setSearchResultIds(resultIds)
    setActiveSearchIndex((prev) => {
      if (resultIds.length === 0) return 0
      if (queryChanged) return resultIds.length - 1
      return Math.min(prev, resultIds.length - 1)
    })
  }, [messages, searchOpen, searchQuery])

  useEffect(() => {
    if (!searchOpen) return
    if (searchResultIds.length === 0) return

    const targetId = searchResultIds[activeSearchIndex]
    if (!targetId) return

    requestAnimationFrame(() => {
      const target = messagesContainerRef.current?.querySelector(
        `[data-msg-id="${targetId}"]`,
      ) as HTMLElement | null
      if (!target) return
      target.scrollIntoView({ behavior: "smooth", block: "center" })
      highlightMessage(targetId)
    })
  }, [activeSearchIndex, searchOpen, searchResultIds])

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !chat || sending || readOnly) return

    const content = newMessage.trim()
    setNewMessage("")
    setSending(true)

    try {
      const res = await fetch(
        `${import.meta.env.VITE_APP_URL}/api/message/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: chat.id,
            message: content,
          }),
        },
      )

      if (!res.ok) {
        console.error("Error al enviar mensaje", await res.text())
        return
      }

      // El mensaje se reflejará por MQTT
    } catch (err) {
      console.error("Error de red al enviar mensaje:", err)
    } finally {
      setSending(false)
    }
  }

  const handlePickFile = (accept = "") => {
    if (sending || readOnly) return
    setMediaError(null)
    setAttachmentMenuOpen(false)
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept
    }
    fileInputRef.current?.click()
  }

  const handleUnavailableAttachment = (label: string) => {
    setAttachmentMenuOpen(false)
    setMediaError(`${label} todavia no esta disponible. Lo vamos a agregar en una proxima etapa.`)
  }

  const openContactModal = () => {
    setAttachmentMenuOpen(false)
    setMediaError(null)
    setContactDraft(emptyAgendaContact)
    setContactSubmitted(false)
    setContactTouchedFields({})
    setContactModalOpen(true)
  }

  const loadAgendaContacts = async () => {
    try {
      const params = new URLSearchParams()
      if (agendaSearch.trim()) params.set("q", agendaSearch.trim())
      const res = await fetch(`${import.meta.env.VITE_APP_URL}/api/agenda/contacts?${params.toString()}`)
      const data = await res.json()
      setAgendaContacts(Array.isArray(data.contacts) ? data.contacts : [])
    } catch (error) {
      console.error("Error cargando agenda:", error)
    }
  }

  useEffect(() => {
    if (!contactModalOpen) return
    const timeout = setTimeout(() => void loadAgendaContacts(), 250)
    return () => clearTimeout(timeout)
  }, [contactModalOpen, agendaSearch])

  const updateContactDraft = (field: keyof AgendaContact, value: string) => {
    setContactDraft((current) => ({ ...current, [field]: value }))
    setContactTouchedFields((current) => ({ ...current, [field]: true }))
  }

  const normalizedContactDraft = (draft: AgendaContact) => {
    const formattedName = draft.formatted_name?.trim() || [draft.first_name, draft.last_name].filter(Boolean).join(" ").trim()
    return {
      ...draft,
      formatted_name: formattedName,
      phone: normalizeContactPhone(draft.phone ?? ""),
    }
  }

  const saveContactToAgenda = async (draft: AgendaContact) => {
    const validationError = validateContactDraft(draft)
    if (validationError) {
      toast.error(validationError)
      return null
    }

    const payload = normalizedContactDraft(draft)

    const res = await fetch(`${import.meta.env.VITE_APP_URL}/api/agenda/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const rawError = await res.text()
      try {
        const payload = rawError ? JSON.parse(rawError) : null
        toast.error(String(payload?.message ?? "No se pudo guardar el contacto en agenda"))
      } catch {
        toast.error("No se pudo guardar el contacto en agenda")
      }
      return null
    }

    const data = await res.json()
    toast.success("Contacto guardado en agenda")
    await loadAgendaContacts()
    return data.contact as AgendaContact
  }

  const sendContactFromModal = async () => {
    if (!chat || sendingContact || readOnly) return
    setContactSubmitted(true)
    const validationError = validateContactDraft(contactDraft)
    if (validationError) {
      toast.error(validationError)
      return
    }

    const payload = normalizedContactDraft(contactDraft)

    setSendingContact(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_APP_URL}/api/message/send-contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat.id, ...payload }),
      })
      if (!res.ok) {
        const raw = await res.text()
        toast.error(raw || "No se pudo enviar el contacto")
        return
      }

      setContactModalOpen(false)
      if (!contactDraft.id && localStorage.getItem("agenda.skipSavePrompt") !== "1") {
        setLastSentContactDraft(payload)
        setSaveContactPromptOpen(true)
      }
    } catch (error) {
      console.error("Error enviando contacto:", error)
      toast.error("No se pudo enviar el contacto")
    } finally {
      setSendingContact(false)
    }
  }

  const contactDraftDisplayName = contactDraft.formatted_name?.trim() || [contactDraft.first_name, contactDraft.last_name].filter(Boolean).join(" ").trim()
  const contactDraftPhone = normalizeContactPhone(contactDraft.phone ?? "")
  const contactDraftIsFromAgenda = Boolean(contactDraft.id)
  const shouldShowContactNameError = contactSubmitted || contactTouchedFields.formatted_name || contactTouchedFields.first_name || contactTouchedFields.last_name
  const shouldShowContactPhoneError = contactSubmitted || contactTouchedFields.phone
  const contactDraftPhoneDigits = contactDraftPhone.replace(/\D/g, "")
  const contactDraftNameError = shouldShowContactNameError && !contactDraftDisplayName
    ? "Indicá un nombre a mostrar o completá nombre/apellido."
    : ""
  const contactDraftPhoneError = shouldShowContactPhoneError && !contactDraftPhone
    ? "El teléfono es obligatorio."
    : shouldShowContactPhoneError && !/^\+?\d+$/.test(contactDraftPhone)
      ? "El teléfono solo puede incluir números y un + inicial."
      : shouldShowContactPhoneError && contactDraftPhoneDigits.length < 7
        ? "El teléfono debe tener al menos 7 dígitos."
        : shouldShowContactPhoneError && contactDraftPhoneDigits.length > 15
          ? "El teléfono no puede superar los 15 dígitos."
      : ""

  const mediaRules: Record<PendingMedia["type"], { extensions: string[]; mimes: string[]; maxBytes: number; hint: string }> = {
    image: {
      extensions: ["jpg", "jpeg", "png", "webp"],
      mimes: ["image/jpeg", "image/png", "image/webp"],
      maxBytes: 5 * 1024 * 1024,
      hint: "Imagen: JPG, PNG o WEBP hasta 5 MB",
    },
    video: {
      extensions: ["mp4", "3gp"],
      mimes: ["video/mp4", "video/3gpp"],
      maxBytes: 16 * 1024 * 1024,
      hint: "Video: MP4 o 3GP hasta 16 MB",
    },
    audio: {
      extensions: ["aac", "m4a", "mp3", "amr", "ogg", "opus"],
      mimes: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg", "audio/opus"],
      maxBytes: 16 * 1024 * 1024,
      hint: "Audio: AAC, M4A, MP3, AMR, OGG u OPUS hasta 16 MB",
    },
    document: {
      extensions: ["txt", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"],
      mimes: [
        "text/plain",
        "application/pdf",
        "application/msword",
        "application/vnd.ms-excel",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ],
      maxBytes: 100 * 1024 * 1024,
      hint: "Documento: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX o TXT hasta 100 MB",
    },
  }

  const getFileExtension = (fileName: string) => fileName.split(".").pop()?.toLowerCase().trim() ?? ""

  const resolvePendingType = (file: File): PendingMedia["type"] => {
    const mime = file.type || ""
    if (mime.startsWith("image/")) return "image"
    if (mime.startsWith("video/")) return "video"
    if (mime.startsWith("audio/")) return "audio"
    return "document"
  }

  const validatePendingFile = (file: File) => {
    const kind = resolvePendingType(file)
    const rules = mediaRules[kind]
    const mime = (file.type || "").toLowerCase()
    const extension = getFileExtension(file.name)
    const validFormat =
      rules.mimes.includes(mime) ||
      (kind === "audio" && mime.startsWith("audio/ogg")) ||
      rules.extensions.includes(extension)

    if (!validFormat) {
      return {
        ok: false,
        kind,
        reason: `${file.name || "Archivo"} tiene un formato no aceptado por WhatsApp. ${rules.hint}.`,
      }
    }

    if (file.size > rules.maxBytes) {
      return {
        ok: false,
        kind,
        reason: `${file.name || "Archivo"} supera el tamaño permitido por WhatsApp. ${rules.hint}.`,
      }
    }

    return { ok: true, kind, reason: "" }
  }

  const pushPendingFiles = (files: File[]) => {
    const existingKeys = new Set(
      pendingMediaList.map((item) => `${item.file.name}__${item.file.size}__${item.file.lastModified}`),
    )
    const nextItems: PendingMedia[] = []

    files.forEach((file) => {
      const key = `${file.name}__${file.size}__${file.lastModified}`
      if (existingKeys.has(key)) return
      existingKeys.add(key)
      nextItems.push({
        file,
        type: resolvePendingType(file),
        previewUrl: URL.createObjectURL(file),
      })
    })

    if (nextItems.length === 0) return
    setPendingMediaList((prev) => [...prev, ...nextItems])
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly) return
    const selectedFiles = Array.from(e.target.files ?? []) as File[]
    if (!selectedFiles.length || !chat || sending) return
    setMediaError(null)

    const validFiles: File[] = []
    const rejectedFiles: string[] = []

    selectedFiles.forEach((file) => {
      const validation = validatePendingFile(file)
      if (validation.ok) {
        validFiles.push(file)
      } else {
        rejectedFiles.push(validation.reason)
      }
    })

    if (rejectedFiles.length > 0) {
      setMediaError(rejectedFiles.slice(0, 3).join(" "))
    }

    pushPendingFiles(validFiles)
    if (e.target) e.target.value = ""
  }

  const removePendingMedia = (index: number) => {
    const target = pendingMediaList[index]
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl)
      setAudioDurations((current) => {
        const next = { ...current }
        delete next[target.previewUrl]
        return next
      })
    }
    setPendingMediaList((prev) => prev.filter((_, i) => i !== index))
  }

  const clearPendingMedia = () => {
    setPendingMediaList((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return []
    })
    setAudioDurations({})
  }

  const handleToggleRecordAudio = async () => {
    if (sending || readOnly) return

    if (recordingAudio && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current)
        recordingIntervalRef.current = null
      }
      setRecordingAudio(false)
      return
    }

    const hasNativeMediaRecorder = typeof MediaRecorder !== "undefined"

    const preferredMimeTypes = [
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ]
    const nativeSupportedMimeType = hasNativeMediaRecorder
      ? preferredMimeTypes.find((m) => MediaRecorder.isTypeSupported(m))
      : undefined

    try {
      setMediaError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      audioChunksRef.current = []

      let recorder: any
      let selectedMimeType = nativeSupportedMimeType ?? "audio/ogg"

      if (nativeSupportedMimeType) {
        recorder = new MediaRecorder(stream, { mimeType: nativeSupportedMimeType })
      } else {
        const OpusMediaRecorder = await loadOpusMediaRecorder()
        recorder = new OpusMediaRecorder(
          stream,
          { mimeType: selectedMimeType },
          {
            encoderWorkerFactory: () =>
              createCdnWorker("https://cdn.jsdelivr.net/npm/opus-media-recorder@0.8.0/encoderWorker.umd.js"),
            OggOpusEncoderWasmPath:
              "https://cdn.jsdelivr.net/npm/opus-media-recorder@0.8.0/OggOpusEncoder.wasm",
            WebMOpusEncoderWasmPath:
              "https://cdn.jsdelivr.net/npm/opus-media-recorder@0.8.0/WebMOpusEncoder.wasm",
          },
        )
      }
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current)
          recordingIntervalRef.current = null
        }
        setRecordingAudio(false)

        const actualMime = recorder.mimeType || selectedMimeType
        if (!actualMime.startsWith("audio/ogg")) {
          setMediaError(`Formato de grabación no compatible: ${actualMime}`)
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((t) => t.stop())
            mediaStreamRef.current = null
          }
          return
        }

        const blob = new Blob(audioChunksRef.current, { type: actualMime })
        if (!blob.size) {
          setMediaError("No se pudo capturar audio.")
          return
        }
        const file = new File([blob], `audio_${Date.now()}.ogg`, { type: "audio/ogg" })

        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop())
          mediaStreamRef.current = null
        }

        const validation = validatePendingFile(file)
        if (!validation.ok) {
          setMediaError(validation.reason)
          return
        }

        pushPendingFiles([file])
      }

      recorder.start()
      setRecordingAudio(true)
      setRecordingSeconds(0)
      recordingIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1)
      }, 1000)
    } catch (err) {
      console.error("No se pudo iniciar la grabación:", err)
      setMediaError("No se pudo iniciar la grabación. Verifica permisos y conexión.")
      setRecordingAudio(false)
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current)
        recordingIntervalRef.current = null
      }
    }
  }

  const handleSendPendingMedia = async () => {
    if (pendingMediaList.length === 0 || !chat || sending || readOnly) return

    setSending(true)
    try {
      const caption = newMessage.trim()
      const queue = [...pendingMediaList]
      let sentCount = 0

      for (let i = 0; i < queue.length; i += 1) {
        const item = queue[i]
        const formData = new FormData()
        formData.append("chat_id", String(chat.id))
        formData.append("file", item.file)
        formData.append("media_kind", item.type)
        if (caption && i === 0) formData.append("caption", caption)

        const res = await fetch(`${import.meta.env.VITE_APP_URL}/api/message/send-media`, {
          method: "POST",
          body: formData,
        })

        if (!res.ok) {
          const rawError = await res.text()
          let errorMessage = `No se pudo enviar: ${item.file.name}`
          try {
            const payload = rawError ? JSON.parse(rawError) : null
            errorMessage = String(payload?.error ?? payload?.message ?? errorMessage)
          } catch {
            if (rawError) errorMessage = rawError
          }
          console.error("Error al enviar media", errorMessage)
          setMediaError(errorMessage)
          break
        }
        sentCount += 1
      }

      if (sentCount > 0) {
        queue.slice(0, sentCount).forEach((item) => URL.revokeObjectURL(item.previewUrl))
      }

      if (sentCount === queue.length) {
        setPendingMediaList([])
        setNewMessage("")
      } else {
        setPendingMediaList(queue.slice(sentCount))
      }
    } catch (err) {
      console.error("Error de red al enviar media:", err)
      setMediaError("Error de red al enviar archivos.")
    } finally {
      setSending(false)
    }
  }
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const isPreviewableDocument = (name: string, url: string) => {
    const target = `${name} ${url}`.toLowerCase()
    return target.includes(".pdf")
  }

  const formatSeconds = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }

  const activeSearchResultId = searchResultIds[activeSearchIndex] ?? null
  const searchResultIdSet = useMemo(() => new Set(searchResultIds), [searchResultIds])

  if (!chat) {

    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center shadow-sm">
          <div className="mb-3 flex justify-center">
            <Badge variant="secondary" className="bg-[#dce8f5] text-[#013765]">
              Chat vacio
            </Badge>
          </div>
          <h3 className="mb-2 text-lg font-medium text-foreground">
            Selecciona una conversacion
          </h3>
          <p className="text-sm text-muted-foreground">
            Elegi un chat de la lista para comenzar a conversar.
          </p>
        </div>
      </div>
    )
  }

  function formatMessageTime(timestamp: string) {
    const date = parseISO(timestamp)
    if (isNaN(date.getTime())) return ""
    return format(date, "HH:mm", { locale: es })
  }

  function formatDateSeparator(timestamp: string) {
    const date = parseISO(timestamp)
    if (isNaN(date.getTime())) return ""

    if (isToday(date)) {
      return "Hoy"
    }

    if (isYesterday(date)) {
      return "Ayer"
    }

    return format(date, "dd/MM/yyyy", { locale: es })
  }

  function getDateKey(timestamp: string) {
    const date = parseISO(timestamp)
    if (isNaN(date.getTime())) return ""
    return format(date, "yyyy-MM-dd", { locale: es })
  }

  function toMillis(timestamp?: string | null) {
    if (!timestamp) return null
    const parsed = parseISO(String(timestamp))
    if (isNaN(parsed.getTime())) return null
    return parsed.getTime()
  }

  const getNodeTypeLabel = (nodeType?: string | null) => {
    if (!nodeType) return null
    switch (nodeType) {
      case "buttons":
        return "Nodo: Buttons"
      case "list":
        return "Nodo: List"
      case "input":
        return "Nodo: Input"
      case "text":
        return "Nodo: Text"
      case "image":
        return "Nodo: Imagen"
      case "document":
        return "Nodo: Documento"
      case "video":
        return "Nodo: Video"
      case "audio":
        return "Nodo: Audio"
      case "contact":
        return "Nodo: Contacto"
      case "handoff":
        return "Nodo: Handoff"
      default:
        return `Nodo: ${nodeType}`
    }
  }

  // 🔹 Render según tipo de mensaje
  const getDocumentLabel = (message: Message) => {
    const explicit = (message.media_name || "").trim()
    if (explicit) return explicit

    const body = (message.body || "").trim()
    if (body && body !== "[Documento]") return body

    const src = buildMediaSrc(message.media_url || undefined)
    if (src) {
      try {
        const path = new URL(src).pathname
        const fileName = decodeURIComponent(path.split("/").pop() || "").trim()
        if (fileName) return fileName
      } catch {
        const fallback = decodeURIComponent(src.split("/").pop() || "").trim()
        if (fallback) return fallback
      }
    }

    return "Documento"
  }

  const getContactCardData = (message: Message) => {
    const rawBody = (message.body || "").trim()

    try {
      const parsed = JSON.parse(rawBody)
      const contact = parsed?.contacts?.[0] ?? parsed
      const name = String(
        parsed?.display_name ??
        contact?.name?.formatted_name ??
        [contact?.name?.first_name, contact?.name?.last_name].filter(Boolean).join(" ") ??
        "",
      ).trim()
      const phone = String(
        parsed?.phone ??
        contact?.phones?.[0]?.wa_id ??
        contact?.phones?.[0]?.phone ??
        "",
      ).trim()
      const organization = String(contact?.org?.company ?? "").trim()
      const title = String(contact?.org?.title ?? "").trim()

      return {
        name: name || "Contacto",
        phone,
        organization,
        title,
      }
    } catch {
      const withoutPrefix = rawBody.replace(/^Contacto:\s*/i, "").trim()
      const phoneMatch = withoutPrefix.match(/(\+?\d[\d\s().-]{5,})/)
      const phone = phoneMatch?.[1]?.trim() ?? ""
      const name = withoutPrefix.replace(phone, "").trim()

      return {
        name: name || message.media_name || "Contacto",
        phone,
        organization: "",
        title: "",
      }
    }
  }

  const ContactPreviewCard = ({ contact }: { contact: NonNullable<PreviewMedia["contact"]> }) => (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="mb-5 flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white text-[#013765] shadow-sm">
          <Contact className="h-8 w-8" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tarjeta de contacto</p>
          <p className="break-words text-lg font-semibold text-slate-900">{contact.name}</p>
        </div>
      </div>

      <div className="grid gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Nombre</p>
          <p className="mt-1 break-words text-sm font-semibold text-slate-800">{contact.name || "Sin nombre"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Teléfono</p>
          <p className="mt-1 break-words text-sm font-semibold text-slate-800">{contact.phone || "Sin teléfono"}</p>
        </div>
        {(contact.title || contact.organization) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cargo</p>
              <p className="mt-1 break-words text-sm font-semibold text-slate-800">{contact.title || "Sin cargo"}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Empresa</p>
              <p className="mt-1 break-words text-sm font-semibold text-slate-800">{contact.organization || "Sin empresa"}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const renderMessageContent = (message: Message) => {
    const type = message.message_type ?? "text"
    const src = buildMediaSrc(message.media_url || undefined)
    const isSticker = type === "image" && message.body === "[Sticker]"

    if (isSticker && src) {

  return (
        <button
          type="button"
          onClick={() =>
            setPreview({
              url: src,
              name: message.media_name ?? "Sticker",
              type: "image",
            })
          }
        >
          <img
            src={src}
            alt="Sticker"
            className="w-48 h-48 object-contain rounded-lg"
          />
        </button>
      )
    }

    // Imagen normal
    if (type === "image" && src) {

  return (
        <div className="w-full">
          <button
            type="button"
            className="block w-full overflow-hidden bg-white"
            onClick={() =>
              setPreview({
                url: src,
                name: message.media_name ?? "Imagen",
                type: "image",
              })
            }
          >
            <img
              src={src}
              alt={message.media_name ?? "Imagen"}
              className="block w-full max-h-[360px] object-contain"
            />
          </button>
          {message.body && (
            <p className="px-3 pt-2 text-sm font-medium leading-relaxed break-words [overflow-wrap:anywhere]">
              {message.body}
            </p>
          )}
        </div>
      )
    }

    if (type === "video" && src) {

  return (
        <div className="w-full">
          <button
            type="button"
            className="group relative block w-full overflow-hidden bg-black text-left"
            onClick={() =>
              setPreview({
                url: src,
                name: message.media_name ?? "Video",
                type: "video",
              })
            }
          >
            <video
              src={src}
              muted
              playsInline
              preload="metadata"
              className="block w-full max-h-[360px]"
            />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/20">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-[#013765] shadow-lg">
                <Play className="ml-0.5 h-6 w-6 fill-current" />
              </span>
            </span>
          </button>
          {message.body && (
            <p className="px-3 pt-2 text-sm font-medium leading-relaxed break-words [overflow-wrap:anywhere]">
              {message.body}
            </p>
          )}
        </div>
      )
    }

    if (type === "audio" && src) {

  return (
        <div className="w-full rounded-t-xl bg-slate-100 px-3 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#013765] shadow-sm">
              <AudioLines className="h-5 w-5" />
            </div>
            <audio src={src} controls className="min-w-0 flex-1" />
          </div>
        </div>
      )
    }

    if (type === "document" && src) {
      const documentLabel = getDocumentLabel(message)

  return (
        <div className="w-full">
          <button
            type="button"
            className="block w-full bg-white text-left"
            onClick={() =>
              setPreview({
                url: src,
                name: documentLabel,
                type: "document",
              })
            }
          >
            <div className="flex items-center gap-3 px-3 py-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#013765]/10 text-[#013765]">
                <FileText className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800">
                  {documentLabel}
                </div>
                <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  Documento
                </div>
              </div>
            </div>
          </button>
          {message.body && message.body !== "[Documento]" && (
            <p className="px-3 pt-2 text-sm font-medium leading-relaxed break-words [overflow-wrap:anywhere]">
              {message.body}
            </p>
          )}
        </div>
      )
    }

    if (type === "contacts" || message.bot_node_type === "contact") {
      const contactData = getContactCardData(message)

  return (
        <button
          type="button"
          className="block w-full bg-slate-100 px-3 py-3 text-left transition-colors hover:bg-slate-200"
          onClick={() =>
            setPreview({
              type: "contacts",
              name: contactData.name,
              contact: contactData,
            })
          }
        >
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-[#013765] shadow-sm">
              <Contact className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">
                {contactData.name}
              </p>
              {contactData.phone ? (
                <p className="mt-0.5 truncate text-xs font-medium text-slate-600">
                  {contactData.phone}
                </p>
              ) : null}
              {contactData.organization || contactData.title ? (
                <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
                  {[contactData.title, contactData.organization].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
          </div>
        </button>
      )
    }

    // Texto por defecto

  return (
      <p className="text-sm font-medium leading-relaxed break-words [overflow-wrap:anywhere]">
        {message.body ?? ""}
      </p>
    )
  }

  const inputStatusMessage = mediaError
    ? mediaError
    : readOnly
      ? readOnlyReason === "bot"
        ? "Modo lectura: el bot esta activo. Puedes tomar el chat, pero no enviar hasta que termine o lo apagues."
        : `Este chat esta siendo atendido por ${readOnlyOperatorName ?? "otro operador"}.`
      : ""
  const hasInputStatus = Boolean(inputStatusMessage)

  return (
    <div className="flex flex-col h-full">
      {/* Header del chat */}
      <div className="border-b border-gray-300 bg-gray-100">
        <div className="flex h-[72px] items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Avatar className="h-10 w-10 flex items-center justify-center bg-[#2b5f90] text-white">
                <User className="h-4 w-4" />
              </Avatar>
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="font-semibold text-foreground">{chat.name}</h2>
            </div>
          </div>

          <Button
            type="button"
            variant={searchOpen ? "default" : "outline"}
            size="sm"
            onClick={() => {
              if (searchOpen) {
                closeSearch()
                return
              }
              setSearchOpen(true)
            }}
            className={cn(searchOpen && "bg-[#013765] text-white hover:bg-[#012e54]")}
            title="Buscar en el chat"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>

        {searchOpen && (
          <div className="px-4 pb-3">
            <div className="flex items-center gap-2">
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar mensajes..."
                className="h-9 bg-white border-gray-300"
              />
              <div className="min-w-[78px] text-center text-xs text-muted-foreground">
                {searchQuery.trim()
                  ? `${searchResultIds.length === 0 ? 0 : activeSearchIndex + 1}/${searchResultIds.length}`
                  : "0/0"}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={searchResultIds.length === 0}
                onClick={goToPreviousSearchResult}
                title="Resultado anterior"
                className="h-9 w-9 p-0 border-gray-300"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={searchResultIds.length === 0}
                onClick={goToNextSearchResult}
                title="Resultado siguiente"
                className="h-9 w-9 p-0 border-gray-300"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={closeSearch}
                title="Cerrar busqueda"
                className="h-9 w-9 p-0 border-gray-300"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Área de mensajes */}
      <div className="relative flex-1 min-h-0">
        <div ref={messagesContainerRef} className="h-full overflow-y-auto custom-scrollbar p-4">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center">
            Cargando mensajes...
          </p>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => {
              const messageId = String(message.id)
              const prev = index > 0 ? messages[index - 1] : null
              const showDateSeparator =
                !prev || getDateKey(prev.timestamp) !== getDateKey(message.timestamp)
              const isSticker =
                message.message_type === "image" && message.body === "[Sticker]"

              const isVisualMedia =
                (message.message_type === "image" && !isSticker) ||
                message.message_type === "video"
              const isAudio = message.message_type === "audio"
              const isDocument = message.message_type === "document"
              const isContactCard = message.message_type === "contacts" || message.bot_node_type === "contact"
              const isMediaCard = isVisualMedia || isAudio || isDocument || isContactCard
              const isBotMessage = message.sender === "user" && message.sender_subtype === "bot"
              const isOperatorMessage = message.sender === "user" && !isBotMessage
              const isSearchMatch = searchResultIdSet.has(messageId)
              const isActiveSearchMatch = activeSearchResultId === messageId

  return (
                <div
                  key={message.id}
                  data-msg-ts={message.timestamp}
                  data-msg-id={messageId}
                  data-msg-date-key={getDateKey(message.timestamp)}
                >
                  {showDateSeparator && (
                    <div
                      data-date-key={getDateKey(message.timestamp)}
                      className="flex justify-center my-2"
                    >
                      <span className="px-3 py-1 rounded-full text-xs bg-gray-200 text-gray-700">
                        {formatDateSeparator(message.timestamp)}
                      </span>
                    </div>
                  )}

                  <div
                    className={cn(
                      "flex gap-3 p-1 rounded-md transition-colors duration-300 ease-in-out",
                      highlightedMessageId === String(message.id) && (highlightBlinkOn ? "bg-gray-300" : "bg-gray-200"),
                      isSearchMatch && "ring-1 ring-gray-300/60",
                      isActiveSearchMatch && "ring-2 ring-[#2b5f90]/70 bg-[#2b5f90]/10",
                      message.sender === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    {message.sender !== "user" && (
                      <Avatar className="h-8 w-8 mt-1 bg-[#2b5f90] text-white flex items-center justify-center">
                        <User className="h-4 w-4" />
                      </Avatar>
                    )}

                    <div
                      className={cn(
                        "min-w-0 overflow-hidden",
                        isMediaCard
                          ? "inline-flex w-[min(420px,70vw)] flex-col rounded-xl shadow-sm"
                          : "max-w-[70%] rounded-lg px-4 py-2",
                        message.sender === "user"
                          ? (isBotMessage ? "text-white bg-slate-600" : "text-white bg-[#013765]")
                          : "text-white bg-[#2b5f90]",
                      )}
                    >
                      {renderMessageContent(message)}

                      {message.sender === "user" &&
                        message.sender_subtype === "bot" &&
                        Array.isArray(message.interactive_options) &&
                        message.interactive_options.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {message.interactive_options.map((opt, idx) => (
                              <span
                                key={`${message.id}-opt-${idx}-${opt.id}`}
                                className="inline-flex max-w-full items-center rounded-full border border-white/30 bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white break-words [overflow-wrap:anywhere]"
                              >
                                {opt.label}
                              </span>
                            ))}
                          </div>
                        )}

                      <div
                        className={cn(
                          "flex items-center justify-between gap-3",
                          isMediaCard ? "px-3 pb-2 pt-1" : "mt-1",
                        )}
                      >
                        <p
                          className={cn(
                            "text-xs font-medium",
                            message.sender === "user"
                              ? "text-white/70"
                              : "text-white/70",
                          )}
                        >
                          {formatMessageTime(message.timestamp)}
                        </p>
                        <p
                          className={cn(
                            "text-[11px] font-semibold",
                            message.sender === "user" && message.sender_subtype === "bot" && message.bot_node_type
                              ? "text-white/80"
                              : "opacity-0",
                          )}
                        >
                          {message.sender === "user" && message.sender_subtype === "bot" && message.bot_node_type
                            ? getNodeTypeLabel(message.bot_node_type)
                            : "-"}
                        </p>
                      </div>
                    </div>

                    {message.sender === "user" && (
                      <Avatar
                        className={cn(
                          "h-8 w-8 mt-1 flex items-center justify-center text-white",
                          isBotMessage ? "bg-slate-600" : "bg-[#013765]",
                        )}
                      >
                        {isOperatorMessage ? <Headset className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                      </Avatar>
                    )}
                  </div>
                </div>
              )
            })}

            <div ref={messagesEndRef} />
          </div>
        )}
        </div>

        {showScrollToBottom && (
          <Button
            type="button"
            size="sm"
            onClick={scrollToBottom}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 h-10 w-10 rounded-full p-0 bg-[#013765] shadow-lg"
            title="Ir al final"
          >
            <ChevronDown className="h-5 w-5 text-white" />
          </Button>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-300">
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelected}
          />

          <div className="relative">
            <Button
              type="button"
              variant="outline"
              disabled={sending || !chat || recordingAudio || readOnly}
              onClick={() => setAttachmentMenuOpen((open) => !open)}
              className={cn(
                "h-11 w-11 rounded-full border-gray-300 p-0 transition-transform",
                attachmentMenuOpen && "rotate-45 bg-[#013765] text-white hover:bg-[#012e54]",
              )}
              title="Adjuntar"
            >
              <Plus className="h-5 w-5" />
            </Button>

            {attachmentMenuOpen && !readOnly && chat && (
              <div className="absolute bottom-14 left-0 z-30 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                <button
                  type="button"
                  onClick={() => handlePickFile("image/jpeg,image/png,image/webp,video/mp4,video/3gpp,.jpg,.jpeg,.png,.webp,.mp4,.3gp")}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-fuchsia-100 text-fuchsia-700">
                    <ImageIcon className="h-4 w-4" />
                  </span>
                  Fotos
                </button>
                <button
                  type="button"
                  onClick={() => handlePickFile(".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation")}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
                    <FileText className="h-4 w-4" />
                  </span>
                  Documento
                </button>
                <button
                  type="button"
                  onClick={() => handleUnavailableAttachment("Ubicacion")}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-400 transition-colors hover:bg-slate-50"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <MapPin className="h-4 w-4" />
                  </span>
                  <span className="flex-1">Ubicacion</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Luego</span>
                </button>
                <button
                  type="button"
                  onClick={openContactModal}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                    <User className="h-4 w-4" />
                  </span>
                  <span className="flex-1">Contacto</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleUnavailableAttachment("Encuesta")}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-400 transition-colors hover:bg-slate-50"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <MessageSquare className="h-4 w-4" />
                  </span>
                  <span className="flex-1">Encuesta</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Luego</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleUnavailableAttachment("Evento")}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-400 transition-colors hover:bg-slate-50"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                    <Clock3 className="h-4 w-4" />
                  </span>
                  <span className="flex-1">Evento</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Luego</span>
                </button>
                <div className="mt-1 border-t border-slate-100 px-3 pt-2 text-[10px] leading-4 text-slate-500">
                  WhatsApp acepta imagen hasta 5 MB, video/audio hasta 16 MB y documentos hasta 100 MB.
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={sending || !chat || readOnly}
              onClick={handleToggleRecordAudio}
              className={cn(
                "h-11 w-11 p-0 border-gray-300",
                recordingAudio && "border-red-500 text-red-600",
              )}
              title={recordingAudio ? "Detener grabación" : "Grabar audio"}
            >
              {recordingAudio ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            {recordingAudio && (
              <span className="inline-flex h-8 items-center rounded-md border border-red-200 bg-red-50 px-2 text-xs font-medium text-red-700">
                {formatSeconds(recordingSeconds)}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0 relative">
            {hasInputStatus && (
              <div
                className={cn(
                  "pointer-events-none absolute -top-7 left-0 z-10 inline-flex max-w-full items-center rounded-md border px-2 py-1 text-[11px] leading-4 shadow-sm",
                  mediaError
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-amber-200 bg-amber-50 text-amber-700",
                )}
              >
                <span className="truncate">{inputStatusMessage}</span>
              </div>
            )}
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                readOnly
                  ? readOnlyReason === "bot"
                    ? "Solo lectura: bot activo"
                    : "Solo lectura: chat atendido por otro operador"
                  : "Escribe un mensaje..."
              }
              disabled={readOnly}
              className="pr-20 min-h-[44px] resize-none bg-muted/50 border-gray-300"
            />
            {pendingMediaList.length > 0 && (
              <div className="mt-2 rounded-lg border border-gray-300 bg-white p-2">
                <div className="text-xs text-muted-foreground mb-2">
                  Vista previa antes de enviar ({pendingMediaList.length} archivos)
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {pendingMediaList.map((item, index) => (
                    <div key={`${item.file.name}-${item.file.size}-${item.file.lastModified}-${index}`} className="relative rounded border border-gray-200 bg-gray-50 p-1">
                      <button
                        type="button"
                        onClick={() => removePendingMedia(index)}
                        className="absolute right-1 top-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
                        title="Quitar archivo"
                      >
                        <X className="h-3 w-3" />
                      </button>

                      {item.type === "image" && (
                        <button
                          type="button"
                          onClick={() => setPreview({ url: item.previewUrl, name: item.file.name, type: "image" })}
                          className="w-full"
                        >
                          <img src={item.previewUrl} alt={item.file.name} className="h-24 w-full rounded object-cover" />
                        </button>
                      )}

                      {item.type === "video" && (
                        <button
                          type="button"
                          onClick={() => setPreview({ url: item.previewUrl, name: item.file.name, type: "video" })}
                          className="w-full"
                        >
                          <video src={item.previewUrl} className="h-24 w-full rounded object-cover" />
                        </button>
                      )}

                      {item.type === "audio" && (
                        <div className="space-y-1">
                          <audio
                            src={item.previewUrl}
                            controls
                            className="w-full"
                            onLoadedMetadata={(event) => {
                              const duration = Number(event.currentTarget.duration)
                              if (!Number.isFinite(duration) || duration <= 0) return
                              setAudioDurations((prev) => ({
                                ...prev,
                                [item.previewUrl]: Math.round(duration),
                              }))
                            }}
                          />
                          <div className="px-1 text-[10px] text-muted-foreground">
                            Duración: {formatSeconds(audioDurations[item.previewUrl] ?? 0)}
                          </div>
                        </div>
                      )}

                      {item.type === "document" && (
                        <button
                          type="button"
                          onClick={() => setPreview({ url: item.previewUrl, name: item.file.name, type: "document" })}
                          className="flex h-24 w-full items-center justify-center rounded bg-gray-50"
                        >
                          <FileText className="h-7 w-7 text-gray-600" />
                        </button>
                      )}

                      <div className="mt-1 px-1 text-[10px] text-muted-foreground truncate">{item.file.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Button
            disabled={readOnly || ((!newMessage.trim() && pendingMediaList.length === 0) || sending)}
            onClick={pendingMediaList.length > 0 ? handleSendPendingMedia : handleSendMessage}
            className="h-11 px-4 bg-[#013765] text-white hover:bg-[#012e54]"
          >
            {sending ? (
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <Send className="h-4 w-4 text-white" />
            )}
          </Button>
        </div>
      </div>

      {contactModalOpen && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl md:grid-cols-[320px_1fr]">
            <div className="border-r border-slate-200 bg-slate-50 p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-slate-900">Enviar contacto</h3>
                <p className="text-xs text-slate-500">Elegí uno guardado o completá los campos.</p>
              </div>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input value={agendaSearch} onChange={(e) => setAgendaSearch(e.target.value)} placeholder="Buscar en agenda..." className="pl-9" />
              </div>
              <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {agendaContacts.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-xs text-slate-500">
                    No hay contactos guardados.
                  </p>
                ) : (
                  agendaContacts.map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => {
                        setContactDraft(contact)
                        setContactSubmitted(false)
                        setContactTouchedFields({})
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                        contactDraft.id === contact.id ? "border-[#013765] bg-[#013765]/5" : "border-slate-200 bg-white hover:bg-slate-50",
                      )}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#013765]">
                        <Contact className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900">{contact.formatted_name}</p>
                        <p className="truncate text-[11px] text-slate-500">{contact.phone}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Datos del contacto</h3>
                  <p className="text-xs text-slate-500">Se enviará como tarjeta de contacto de WhatsApp.</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    className="bg-[#013765] text-white hover:bg-[#012e54]"
                    onClick={() => {
                      window.location.href = `${import.meta.env.VITE_APP_URL}/agenda-panel`
                    }}
                  >
                    <Contact className="mr-2 h-4 w-4" />
                    Ir a agenda
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-gray-300"
                    onClick={() => setContactModalOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <ContactField label="Nombre" value={contactDraft.first_name ?? ""} onChange={(value) => updateContactDraft("first_name", value)} readOnly={contactDraftIsFromAgenda} />
                <ContactField label="Apellido" value={contactDraft.last_name ?? ""} onChange={(value) => updateContactDraft("last_name", value)} readOnly={contactDraftIsFromAgenda} />
              </div>
              <div className="mt-3">
                <ContactField label="Nombre a mostrar" value={contactDraft.formatted_name ?? ""} onChange={(value) => updateContactDraft("formatted_name", value)} error={contactDraftNameError} readOnly={contactDraftIsFromAgenda} />
              </div>
              <div className="mt-3">
                <ContactField label="Teléfono" value={contactDraft.phone ?? ""} onChange={(value) => updateContactDraft("phone", normalizeContactPhone(value))} placeholder="Ej: 5492612155672" error={contactDraftPhoneError} readOnly={contactDraftIsFromAgenda} />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <ContactField label="Empresa" value={contactDraft.organization ?? ""} onChange={(value) => updateContactDraft("organization", value)} readOnly={contactDraftIsFromAgenda} />
                <ContactField label="Cargo" value={contactDraft.title ?? ""} onChange={(value) => updateContactDraft("title", value)} readOnly={contactDraftIsFromAgenda} />
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {contactDraftIsFromAgenda ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setContactDraft(emptyAgendaContact)
                      setContactSubmitted(false)
                      setContactTouchedFields({})
                    }}
                  >
                    Quitar selección
                  </Button>
                ) : null}
                <Button onClick={sendContactFromModal} disabled={sendingContact} className="bg-[#013765] text-white hover:bg-[#012e54]">
                  {sendingContact ? "Enviando..." : "Enviar contacto"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {saveContactPromptOpen && lastSentContactDraft && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">Guardar contacto</h3>
            <p className="mt-2 text-sm text-slate-600">
              ¿Querés agregar este contacto a la agenda para usarlo en futuros envíos?
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  localStorage.setItem("agenda.skipSavePrompt", "1")
                  setSaveContactPromptOpen(false)
                  setLastSentContactDraft(null)
                }}
              >
                No volver a preguntar
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSaveContactPromptOpen(false)
                  setLastSentContactDraft(null)
                }}
              >
                No
              </Button>
              <Button
                className="bg-[#013765] text-white hover:bg-[#012e54]"
                onClick={async () => {
                  await saveContactToAgenda(lastSentContactDraft)
                  setSaveContactPromptOpen(false)
                  setLastSentContactDraft(null)
                }}
              >
                Sí, guardar
              </Button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#013765]/10 text-[#013765]">
                    {preview.type === "image" ? (
                      <ImageIcon className="h-5 w-5" />
                    ) : preview.type === "video" ? (
                      <Video className="h-5 w-5" />
                    ) : preview.type === "audio" ? (
                      <AudioLines className="h-5 w-5" />
                    ) : preview.type === "contacts" ? (
                      <Contact className="h-5 w-5" />
                    ) : (
                      <FileText className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Vista previa · {preview.type === "image"
                        ? "Imagen"
                        : preview.type === "video"
                          ? "Video"
                          : preview.type === "audio"
                            ? "Audio"
                            : preview.type === "contacts"
                              ? "Contacto"
                            : "Documento"}
                    </div>
                    <div className="truncate text-sm font-semibold text-slate-900">{preview.name}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {preview.url ? (
                    <a
                      href={preview.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-100"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir
                    </a>
                  ) : null}

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setPreview(null)}
                    className="h-9 w-9 rounded-lg border-slate-200 bg-white p-0"
                    title="Cerrar vista previa"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="bg-slate-950">
                {preview.type === "image" && (
                  <div className="flex max-h-[78vh] min-h-[320px] items-center justify-center p-3">
                    <img src={preview.url ?? ""} alt={preview.name} className="max-h-[75vh] w-full object-contain" />
                  </div>
                )}

                {preview.type === "video" && (
                  <div className="flex max-h-[78vh] min-h-[320px] items-center justify-center p-3">
                    <video autoPlay controls playsInline preload="metadata" className="max-h-[75vh] w-full rounded-xl bg-black object-contain">
                      <source src={preview.url ?? ""} />
                    </video>
                  </div>
                )}

                {preview.type === "audio" && (
                  <div className="bg-white p-6">
                    <div className="mx-auto max-w-xl rounded-2xl bg-slate-100 p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-[#013765] shadow-sm">
                          <AudioLines className="h-6 w-6" />
                        </div>
                        <audio controls className="min-w-0 flex-1">
                          <source src={preview.url ?? ""} />
                        </audio>
                      </div>
                    </div>
                  </div>
                )}

                {preview.type === "contacts" && (
                  <div className="bg-white p-6">
                    <ContactPreviewCard
                      contact={preview.contact ?? { name: preview.name, phone: "" }}
                    />
                  </div>
                )}

                {preview.type === "document" && (
                  <div className="bg-white">
                    {isPreviewableDocument(preview.name, preview.url ?? "") ? (
                      <iframe
                        src={preview.url ?? ""}
                        title={preview.name}
                        className="h-[78vh] w-full bg-white"
                      />
                    ) : (
                      <div className="flex min-h-[320px] items-center justify-center p-6">
                        <div className="max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
                          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#013765] shadow-sm">
                            <FileText className="h-7 w-7" />
                          </div>
                          <p className="mb-2 text-sm font-semibold text-slate-900">{preview.name}</p>
                          <p className="mb-4 text-sm text-slate-500">
                          Vista previa no disponible para este formato.
                          </p>
                          <a
                            href={preview.url ?? ""}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg bg-[#013765] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#012e54]"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Abrir documento
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ContactField({
  label,
  value,
  onChange,
  placeholder,
  error,
  readOnly = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  error?: string
  readOnly?: boolean
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={cn(readOnly ? "cursor-default bg-slate-50 text-slate-600" : "")}
      />
      {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  )
}
