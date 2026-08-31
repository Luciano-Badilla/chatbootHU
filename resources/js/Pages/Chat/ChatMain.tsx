"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AudioLines, Bot, Check, CheckCheck, ChevronDown, ChevronUp, Contact, ExternalLink, FileText, Headset, ImageIcon, MapPin, MessageSquareText, Mic, Play, Plus, Search, Send, Square, User, Video, X } from "lucide-react"
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
import nspell from "nspell"
import spanishAffUrl from "../../../../node_modules/dictionary-es/index.aff?url"
import spanishDicUrl from "../../../../node_modules/dictionary-es/index.dic?url"

interface ChatMainProps {
  chat?: Chat
  readOnly?: boolean
  readOnlyOperatorName?: string | null
  readOnlyReason?: "operator" | "bot" | null
}

type PreviewMedia = {
  url?: string
  name: string
  type: "image" | "video" | "audio" | "document" | "contacts" | "location"
  contact?: {
    name: string
    phone: string
    organization?: string
    title?: string
  }
  location?: {
    latitude: number
    longitude: number
    name: string
    address: string
    isValid: boolean
  }
}

type PendingMedia = {
  file: File
  type: "image" | "video" | "audio" | "document"
  previewUrl: string
}

type LocationDraft = {
  latitude: string
  longitude: string
  name: string
  address: string
}

type LocationSearchResult = {
  place_id: number | string
  display_name: string
  lat: string
  lon: string
  name?: string
}

type LocationHistoryItem = LocationDraft & {
  id: string
  saved_at: string
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

const emptyLocationDraft: LocationDraft = {
  latitude: "",
  longitude: "",
  name: "",
  address: "",
}

const LOCATION_HISTORY_KEY = "chat.locationHistory"

type QuickReply = {
  id: number
  title: string
  body: string
}

type SpellingMatch = {
  word: string
  start: number
  end: number
  suggestions: string[]
}

const mapApiMessage = (message: any): Message => ({
  id: message.id,
  sender: message.sender === "user" ? "user" : "contact",
  sender_subtype: message.sender_subtype ?? (message.sender === "contact" ? "contact" : "operator"),
  operator_name: message.operator_name ?? null,
  bot_node_type: message.bot_node_type ?? null,
  interactive_options: Array.isArray(message.interactive_options) ? message.interactive_options : null,
  body: message.body,
  timestamp: message.timestamp ?? message.created_at ?? new Date().toISOString(),
  status: message.status ?? null,
  message_type: message.message_type ?? "text",
  media_url: message.media_url ?? null,
  media_name: message.media_name ?? null,
})

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

function HoverTooltip({
  label,
  children,
  position = "top",
  align = "center",
}: {
  label: string
  children: React.ReactNode
  position?: "top" | "bottom"
  align?: "left" | "center" | "right"
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const updateTooltipPosition = () => {
    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const top = position === "top" ? rect.top - 8 : rect.bottom + 8
    const left =
      align === "left"
        ? rect.left
        : align === "right"
          ? rect.right
          : rect.left + rect.width / 2

    setCoords({ top, left })
  }

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => {
        updateTooltipPosition()
        setOpen(true)
      }}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {mounted && open && coords
        ? createPortal(
          <div
            className={cn(
              "pointer-events-none fixed z-[10000]",
              position === "top" ? "-translate-y-full" : "",
              align === "left"
                ? ""
                : align === "right"
                  ? "-translate-x-full"
                  : "-translate-x-1/2",
            )}
            style={{ top: coords.top, left: coords.left }}
          >
            <div className="whitespace-nowrap rounded-xl border border-[#013765] bg-[#013765] px-2.5 py-1 text-[11px] font-medium text-white shadow-lg">
              {label}
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  )
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
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
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
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false)
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([])
  const [quickRepliesLoading, setQuickRepliesLoading] = useState(false)
  const [spellChecker, setSpellChecker] = useState<ReturnType<typeof nspell> | null>(null)
  const [spellingMatches, setSpellingMatches] = useState<SpellingMatch[]>([])
  const [activeSpellingMatch, setActiveSpellingMatch] = useState<SpellingMatch | null>(null)
  const [dismissedSpellingKey, setDismissedSpellingKey] = useState<string | null>(null)
  const [contactModalOpen, setContactModalOpen] = useState(false)
  const [agendaContacts, setAgendaContacts] = useState<AgendaContact[]>([])
  const [agendaSearch, setAgendaSearch] = useState("")
  const [contactDraft, setContactDraft] = useState<AgendaContact>(emptyAgendaContact)
  const [sendingContact, setSendingContact] = useState(false)
  const [saveContactPromptOpen, setSaveContactPromptOpen] = useState(false)
  const [lastSentContactDraft, setLastSentContactDraft] = useState<AgendaContact | null>(null)
  const [contactSubmitted, setContactSubmitted] = useState(false)
  const [contactTouchedFields, setContactTouchedFields] = useState<Record<string, boolean>>({})
  const [contactAvatarFailed, setContactAvatarFailed] = useState(false)
  const [locationModalOpen, setLocationModalOpen] = useState(false)
  const [locationDraft, setLocationDraft] = useState<LocationDraft>(emptyLocationDraft)
  const [locationSubmitted, setLocationSubmitted] = useState(false)
  const [sendingLocation, setSendingLocation] = useState(false)
  const [locationSearchQuery, setLocationSearchQuery] = useState("")
  const [locationSearchResults, setLocationSearchResults] = useState<LocationSearchResult[]>([])
  const [locationSearching, setLocationSearching] = useState(false)
  const [locationDetecting, setLocationDetecting] = useState(false)
  const [locationHistory, setLocationHistory] = useState<LocationHistoryItem[]>([])

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
  const pendingMessageStatusRef = useRef<Record<string, Message["status"]>>({})
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const previousSearchQueryRef = useRef("")
  const attachmentMenuRef = useRef<HTMLDivElement | null>(null)
  const quickRepliesMenuRef = useRef<HTMLDivElement | null>(null)
  const messageInputRef = useRef<HTMLInputElement | null>(null)
  const prependingMessagesRef = useRef(false)
  const locationMapRef = useRef<HTMLDivElement | null>(null)
  const leafletMapRef = useRef<any | null>(null)
  const locationPinRef = useRef<HTMLSpanElement | null>(null)
  const locationPinPositionRef = useRef<{ latitude: number; longitude: number } | null>(null)

  const closeAllModals = () => {
    setPreview(null)
    setLocationModalOpen(false)
    setContactModalOpen(false)
    setSaveContactPromptOpen(false)
    setLastSentContactDraft(null)
    setAttachmentMenuOpen(false)
    setQuickRepliesOpen(false)
  }

  useEffect(() => {
    let cancelled = false

    const loadSpellChecker = async () => {
      try {
        const [affResponse, dicResponse] = await Promise.all([fetch(spanishAffUrl), fetch(spanishDicUrl)])
        if (!affResponse.ok || !dicResponse.ok) throw new Error("No se pudo descargar el diccionario")
        const [aff, dic] = await Promise.all([affResponse.text(), dicResponse.text()])
        if (!cancelled) setSpellChecker(nspell(aff, dic))
      } catch (error) {
        console.error("Error cargando el corrector ortográfico:", error)
      }
    }

    void loadSpellChecker()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!spellChecker || !newMessage.trim()) {
      setSpellingMatches([])
      setActiveSpellingMatch(null)
      return
    }

    const timeout = setTimeout(() => {
      const matches: SpellingMatch[] = []
      const words = newMessage.matchAll(/[\p{L}]+/gu)

      for (const match of words) {
        const word = match[0]
        const start = match.index ?? 0
        if (word.length < 2 || word === word.toUpperCase() || spellChecker.correct(word)) continue
        matches.push({
          word,
          start,
          end: start + word.length,
          suggestions: spellChecker.suggest(word).slice(0, 5),
        })
      }

      setSpellingMatches(matches)
      setDismissedSpellingKey(null)

      const caret = messageInputRef.current?.selectionStart ?? newMessage.length
      const closest = matches.find((item) => caret >= item.start && caret <= item.end + 1) ?? matches[0] ?? null
      setActiveSpellingMatch(closest)
    }, 450)

    return () => clearTimeout(timeout)
  }, [newMessage, spellChecker])

  const replaceSpellingMatch = (match: SpellingMatch, replacement: string) => {
    const nextMessage = `${newMessage.slice(0, match.start)}${replacement}${newMessage.slice(match.end)}`
    const nextCaret = match.start + replacement.length
    setNewMessage(nextMessage)
    setActiveSpellingMatch(null)
    requestAnimationFrame(() => {
      messageInputRef.current?.focus()
      messageInputRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const activateSpellingMatchAtCaret = () => {
    const caret = messageInputRef.current?.selectionStart ?? 0
    const match = spellingMatches.find((item) => caret >= item.start && caret <= item.end)
    if (match) {
      setActiveSpellingMatch(match)
      setDismissedSpellingKey(null)
    }
  }

  const renderSpellingOverlay = () => {
    if (!newMessage || spellingMatches.length === 0) return newMessage

    const parts: React.ReactNode[] = []
    let cursor = 0
    spellingMatches.forEach((match) => {
      parts.push(newMessage.slice(cursor, match.start))
      parts.push(
        <span
          key={`${match.start}-${match.word}`}
          className="decoration-red-500 decoration-wavy underline decoration-1 underline-offset-4"
        >
          {newMessage.slice(match.start, match.end)}
        </span>,
      )
      cursor = match.end
    })
    parts.push(newMessage.slice(cursor))
    return parts
  }

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
    setContactAvatarFailed(false)

    if (!chat) {
      setMessages([])
      setHasOlderMessages(false)
      return
    }

    const fetchMessages = async () => {
      try {
        setLoading(true)

        const res = await fetch(
          `${import.meta.env.VITE_APP_URL}/api/chat/messages/${chat.id}?limit=50`,
        )

        if (!res.ok) {
          console.error("Error al cargar mensajes", await res.text())
          return
        }

        const data = await res.json()

        const rows = Array.isArray(data) ? data : data.messages
        const msgs: Message[] = rows.map(mapApiMessage)

        setMessages(msgs)
        setHasOlderMessages(Boolean(data?.has_more))
      } catch (err) {
        console.error("Error de red al cargar mensajes:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchMessages()
  }, [chat?.id])

  const loadOlderMessages = async () => {
    if (!chat || loading || loadingOlderMessages || !hasOlderMessages) return

    const oldestId = messages
      .map((message) => Number(message.id))
      .filter((id) => Number.isFinite(id))
      .sort((a, b) => a - b)[0]
    if (!oldestId) return

    const container = messagesContainerRef.current
    const previousScrollHeight = container?.scrollHeight ?? 0
    setLoadingOlderMessages(true)
    prependingMessagesRef.current = true

    try {
      const response = await fetch(
        `${import.meta.env.VITE_APP_URL}/api/chat/messages/${chat.id}?limit=50&before_id=${oldestId}`,
      )
      if (!response.ok) throw new Error(await response.text())
      const data = await response.json()
      const olderMessages: Message[] = (Array.isArray(data) ? data : data.messages).map(mapApiMessage)

      setMessages((current) => {
        const existingIds = new Set(current.map((message) => String(message.id)))
        return [...olderMessages.filter((message) => !existingIds.has(String(message.id))), ...current]
      })
      setHasOlderMessages(Boolean(data?.has_more))

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (container) container.scrollTop += container.scrollHeight - previousScrollHeight
        })
      })
    } catch (error) {
      prependingMessagesRef.current = false
      console.error("Error cargando mensajes anteriores:", error)
      toast.error("No se pudieron cargar los mensajes anteriores")
    } finally {
      setLoadingOlderMessages(false)
    }
  }

  // 🔹 MQTT: escuchar mensajes en tiempo real del chat actual
  useEffect(() => {
    if (!chat) return

    const mosquitto_host = (import.meta.env.VITE_MOSQUITTO_HOST);

    const client = mqtt.connect("ws://" + mosquitto_host + ":9001")

    client.on("connect", () => {
      const topic = `chat/${chat.id}`
      client.subscribe(topic)
      client.subscribe(`${topic}/status`)
    })

    client.on("message", (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString())

        if (String(data.chat_id) !== String(chat.id)) return

        if (topic === `chat/${chat.id}/status`) {
          const messageId = String(data.message_id ?? "")
          if (!messageId) return

          setMessages((prev) => {
            let matched = false
            const next = prev.map((message) => {
              if (String(message.id) !== messageId) return message
              matched = true
              return {
                ...message,
                status: pickNewestMessageStatus(message.status, data.status),
              }
            })

            if (!matched) {
              pendingMessageStatusRef.current[messageId] = pickNewestMessageStatus(
                pendingMessageStatusRef.current[messageId],
                data.status,
              )
            } else {
              delete pendingMessageStatusRef.current[messageId]
            }

            return next
          })
          return
        }

        const incoming: Message = {
          id: data.message_id ?? data.id ?? `mqtt-${Date.now()}`,
          sender: data.sender === "user" ? "user" : "contact",
          sender_subtype: data.sender_subtype ?? (data.sender === "contact" ? "contact" : "operator"),
          operator_name: data.operator_name ?? null,
          bot_node_type: data.bot_node_type ?? null,
          interactive_options: Array.isArray(data.interactive_options) ? data.interactive_options : null,
          body: data.body ?? null,
          timestamp: data.timestamp ?? new Date().toISOString(),
          status: data.status ?? null,
          message_type: data.message_type ?? "text",
          media_url: data.media_url ?? null,
          media_name: data.media_name ?? null,
        }

        setMessages((prev) => {
          const pendingStatus = pendingMessageStatusRef.current[String(incoming.id)]
          if (pendingStatus) {
            incoming.status = pickNewestMessageStatus(incoming.status, pendingStatus)
            delete pendingMessageStatusRef.current[String(incoming.id)]
          }

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
    if (!chat) return

    let cancelled = false

    const syncMessageStatuses = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_APP_URL}/api/chat/messages/${chat.id}?limit=50`)
        if (!res.ok || cancelled) return

        const data = await res.json()
        const rows = Array.isArray(data) ? data : data.messages
        if (!Array.isArray(rows)) return

        const statusesById = new Map<string, Message["status"]>()
        rows.forEach((row: any) => {
          if (row?.id === undefined || row?.id === null) return
          statusesById.set(String(row.id), row.status ?? null)
        })

        setMessages((prev) =>
          prev.map((message) => {
            const syncedStatus = statusesById.get(String(message.id))
            if (!syncedStatus) return message

            return {
              ...message,
              status: pickNewestMessageStatus(message.status, syncedStatus),
            }
          }),
        )
      } catch (error) {
        console.error("Error sincronizando estados de mensajes:", error)
      }
    }

    const interval = window.setInterval(() => {
      void syncMessageStatuses()
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [chat?.id])

  useEffect(() => {
    if (searchOpen && searchQuery.trim()) return
    if (prependingMessagesRef.current) {
      prependingMessagesRef.current = false
      return
    }
    if (!messagesEndRef.current) return
    messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
  }, [messages.length, chat?.id, searchOpen, searchQuery])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const updateVisibility = () => {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      setShowScrollToBottom(distanceToBottom > 220)
      if (container.scrollTop <= 80) void loadOlderMessages()
    }

    updateVisibility()
    container.addEventListener("scroll", updateVisibility)

  return () => container.removeEventListener("scroll", updateVisibility)
  }, [chat?.id, messages.length, hasOlderMessages, loadingOlderMessages])

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
    closeAllModals()
    setLocationSubmitted(false)
    setContactSubmitted(false)
  }, [chat?.id])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const hasOpenModal = Boolean(preview || locationModalOpen || contactModalOpen || saveContactPromptOpen)
      if (!hasOpenModal) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      closeAllModals()
    }

    document.addEventListener("keydown", handleEscape, true)
    return () => document.removeEventListener("keydown", handleEscape, true)
  }, [preview, locationModalOpen, contactModalOpen, saveContactPromptOpen])

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

  const openContactModal = () => {
    setAttachmentMenuOpen(false)
    setMediaError(null)
    setContactDraft(emptyAgendaContact)
    setContactSubmitted(false)
    setContactTouchedFields({})
    setContactModalOpen(true)
  }

  const openLocationModal = () => {
    setAttachmentMenuOpen(false)
    setMediaError(null)
    setLocationDraft(emptyLocationDraft)
    setLocationSearchQuery("")
    setLocationSearchResults([])
    setLocationHistory(readLocationHistory())
    setLocationSubmitted(false)
    setLocationModalOpen(true)
  }

  const readLocationHistory = (): LocationHistoryItem[] => {
    try {
      const raw = localStorage.getItem(LOCATION_HISTORY_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.slice(0, 8) : []
    } catch {
      return []
    }
  }

  const saveLocationToHistory = (location: LocationDraft) => {
    if (!location.latitude || !location.longitude) return

    const item: LocationHistoryItem = {
      ...location,
      id: `${location.latitude},${location.longitude}`,
      saved_at: new Date().toISOString(),
    }

    const next = [
      item,
      ...readLocationHistory().filter((saved) => saved.id !== item.id),
    ].slice(0, 8)

    localStorage.setItem(LOCATION_HISTORY_KEY, JSON.stringify(next))
    setLocationHistory(next)
  }

  const ensureLeaflet = async () => {
    const win = window as Window & { L?: any; __leafletLoading?: Promise<any> }
    if (win.L) return win.L
    if (win.__leafletLoading) return win.__leafletLoading

    win.__leafletLoading = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-leaflet="true"]')) {
        const link = document.createElement("link")
        link.rel = "stylesheet"
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        link.dataset.leaflet = "true"
        document.head.appendChild(link)
      }

      const script = document.createElement("script")
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
      script.async = true
      script.onload = () => win.L ? resolve(win.L) : reject(new Error("Leaflet no disponible"))
      script.onerror = () => reject(new Error("No se pudo cargar Leaflet"))
      document.head.appendChild(script)
    })

    return win.__leafletLoading
  }

  const moveLocationMarker = (latitude: number, longitude: number, zoom = 16) => {
    const map = leafletMapRef.current
    const L = (window as Window & { L?: any }).L
    if (!map || !L) return

    const updatePinPosition = () => {
      if (!locationPinRef.current) return
      const point = map.latLngToContainerPoint(L.latLng(latitude, longitude))
      locationPinRef.current.style.left = `${point.x}px`
      locationPinRef.current.style.top = `${point.y}px`
      locationPinRef.current.style.opacity = "1"
    }

    locationPinPositionRef.current = { latitude, longitude }
    map.flyTo([latitude, longitude], Math.max(map.getZoom(), zoom), { duration: 0.35 })
    updatePinPosition()
  }

  const reverseLocation = async (latitude: number, longitude: number) => {
    try {
      const params = new URLSearchParams({
        lat: String(latitude),
        lon: String(longitude),
      })
      const response = await fetch(`${import.meta.env.VITE_APP_URL}/api/location/reverse?${params.toString()}`)
      if (!response.ok) return null
      const payload = await response.json()
      const data = payload?.data ?? payload
      return {
        name: String(data?.name ?? "").trim(),
        address: String(data?.display_name ?? "").trim(),
      }
    } catch (error) {
      console.error("Error buscando direccion inversa:", error)
      return null
    }
  }

  const selectLocation = async (
    latitude: number,
    longitude: number,
    name?: string,
    address?: string,
    shouldReverse = true,
  ) => {
    const roundedLatitude = Number(latitude.toFixed(6))
    const roundedLongitude = Number(longitude.toFixed(6))
    let nextName = name?.trim() ?? ""
    let nextAddress = address?.trim() ?? ""

    moveLocationMarker(roundedLatitude, roundedLongitude)

    if (shouldReverse && (!nextName || !nextAddress)) {
      const reversed = await reverseLocation(roundedLatitude, roundedLongitude)
      nextName = nextName || reversed?.name || ""
      nextAddress = nextAddress || reversed?.address || ""
    }

    const nextLocation = {
      latitude: String(roundedLatitude),
      longitude: String(roundedLongitude),
      name: nextName,
      address: nextAddress,
    }

    setLocationDraft((current) => ({
      ...current,
      ...nextLocation,
    }))
    saveLocationToHistory(nextLocation)
    setLocationSubmitted(false)
  }

  const messageStatusRank = (status?: Message["status"]) => {
    switch (String(status ?? "").toLowerCase()) {
      case "failed":
        return 0
      case "sent":
        return 1
      case "delivered":
        return 2
      case "read":
        return 3
      default:
        return -1
    }
  }

  const pickNewestMessageStatus = (current?: Message["status"], incoming?: Message["status"]) => {
    if (String(incoming ?? "").toLowerCase() === "failed") return incoming
    return messageStatusRank(incoming) >= messageStatusRank(current) ? incoming : current
  }

  useEffect(() => {
    if (!locationModalOpen) return

    let cancelled = false

    ensureLeaflet()
      .then((L) => {
        if (cancelled || !locationMapRef.current || leafletMapRef.current) return

        const initialLatitudeRaw = locationDraft.latitude.trim()
        const initialLongitudeRaw = locationDraft.longitude.trim()
        const initialLatitude = Number(initialLatitudeRaw)
        const initialLongitude = Number(initialLongitudeRaw)
        const hasInitialPoint =
          initialLatitudeRaw.length > 0 &&
          initialLongitudeRaw.length > 0 &&
          Number.isFinite(initialLatitude) &&
          Number.isFinite(initialLongitude)
        const center = hasInitialPoint ? [initialLatitude, initialLongitude] : [-32.889459, -68.845839]

        const map = L.map(locationMapRef.current, {
          zoomControl: false,
          zoomAnimation: false,
          markerZoomAnimation: false,
          fadeAnimation: false,
        }).setView(center, hasInitialPoint ? 16 : 12)
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map)
        L.control.zoom({ position: "bottomright" }).addTo(map)

        map.on("click", async (event: any) => {
          await selectLocation(event.latlng.lat, event.latlng.lng)
        })
        map.on("move zoom resize viewreset", () => {
          const position = locationPinPositionRef.current
          if (position) {
            const point = map.latLngToContainerPoint(L.latLng(position.latitude, position.longitude))
            if (locationPinRef.current) {
              locationPinRef.current.style.left = `${point.x}px`
              locationPinRef.current.style.top = `${point.y}px`
              locationPinRef.current.style.opacity = "1"
            }
          }
        })

        leafletMapRef.current = map
        if (hasInitialPoint) {
          moveLocationMarker(initialLatitude, initialLongitude)
        }

        setTimeout(() => map.invalidateSize(), 100)
      })
      .catch((error) => {
        console.error("Error inicializando mapa:", error)
        toast.error("No se pudo cargar el mapa")
      })

    return () => {
      cancelled = true
        if (leafletMapRef.current) {
          leafletMapRef.current.remove()
          leafletMapRef.current = null
          locationPinPositionRef.current = null
        }
      }
  }, [locationModalOpen])

  const searchLocationAddress = async () => {
    if (locationSearching) return
    const query = locationSearchQuery.trim()
    if (query.length < 3) {
      setLocationSearchResults([])
      toast.error("Escribi al menos 3 caracteres para buscar")
      return
    }

    setLocationSearching(true)
    try {
      const params = new URLSearchParams({
        limit: "6",
        q: query,
      })
      const response = await fetch(`${import.meta.env.VITE_APP_URL}/api/location/search?${params.toString()}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        toast.error(payload?.message || "No se pudo buscar la direccion")
        return
      }

      const payload = await response.json()
      const results = payload?.data ?? payload
      setLocationSearchResults(Array.isArray(results) ? results : [])
      if (!Array.isArray(results) || results.length === 0) {
        toast.error("No encontramos resultados para esa direccion")
      }
    } catch (error) {
      console.error("Error buscando direccion:", error)
      toast.error("No se pudo buscar la direccion")
    } finally {
      setLocationSearching(false)
    }
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("El navegador no permite obtener la ubicacion actual")
      return
    }

    setLocationDetecting(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void selectLocation(position.coords.latitude, position.coords.longitude)
        setLocationDetecting(false)
      },
      () => {
        toast.error("No se pudo obtener la ubicacion actual")
        setLocationDetecting(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  useEffect(() => {
    if (!attachmentMenuOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (!attachmentMenuRef.current?.contains(event.target as Node)) {
        setAttachmentMenuOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [attachmentMenuOpen])

  useEffect(() => {
    if (!quickRepliesOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (!quickRepliesMenuRef.current?.contains(event.target as Node)) {
        setQuickRepliesOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQuickRepliesOpen(false)
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [quickRepliesOpen])

  useEffect(() => {
    if (!quickRepliesOpen) return

    const loadQuickReplies = async () => {
      setQuickRepliesLoading(true)
      try {
        const response = await fetch(`${import.meta.env.VITE_APP_URL}/api/quick-replies`)
        if (!response.ok) throw new Error(await response.text())
        const data = await response.json()
        setQuickReplies(Array.isArray(data.quick_replies) ? data.quick_replies : [])
      } catch (error) {
        console.error("Error cargando respuestas rápidas:", error)
        toast.error("No se pudieron cargar las respuestas rápidas")
      } finally {
        setQuickRepliesLoading(false)
      }
    }

    void loadQuickReplies()
  }, [quickRepliesOpen])

  const selectQuickReply = (text: string) => {
    setNewMessage(text)
    setQuickRepliesOpen(false)
    requestAnimationFrame(() => messageInputRef.current?.focus())
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

  const validateLocationDraft = (draft: LocationDraft) => {
    const latitude = Number(draft.latitude)
    const longitude = Number(draft.longitude)

    if (!draft.latitude.trim()) return "La latitud es obligatoria."
    if (!Number.isFinite(latitude)) return "La latitud debe ser un numero valido."
    if (latitude < -90 || latitude > 90) return "La latitud debe estar entre -90 y 90."
    if (!draft.longitude.trim()) return "La longitud es obligatoria."
    if (!Number.isFinite(longitude)) return "La longitud debe ser un numero valido."
    if (longitude < -180 || longitude > 180) return "La longitud debe estar entre -180 y 180."

    return ""
  }

  const sendLocationFromModal = async () => {
    if (!chat || sendingLocation || readOnly) return
    setLocationSubmitted(true)

    const validationError = validateLocationDraft(locationDraft)
    if (validationError) {
      toast.error(validationError)
      return
    }

    setSendingLocation(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_APP_URL}/api/message/send-location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chat.id,
          latitude: Number(locationDraft.latitude),
          longitude: Number(locationDraft.longitude),
          name: locationDraft.name.trim(),
          address: locationDraft.address.trim(),
        }),
      })

      if (!res.ok) {
        const raw = await res.text()
        toast.error(raw || "No se pudo enviar la ubicacion")
        return
      }

      saveLocationToHistory({
        latitude: locationDraft.latitude,
        longitude: locationDraft.longitude,
        name: locationDraft.name.trim(),
        address: locationDraft.address.trim(),
      })
      setLocationModalOpen(false)
      setLocationDraft(emptyLocationDraft)
      setLocationSubmitted(false)
    } catch (error) {
      console.error("Error enviando ubicacion:", error)
      toast.error("No se pudo enviar la ubicacion")
    } finally {
      setSendingLocation(false)
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
  const locationDraftError = locationSubmitted ? validateLocationDraft(locationDraft) : ""

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

  const ChatMessagesLoader = () => (
    <div className="flex h-full min-h-[360px] flex-col justify-end gap-5 px-2 py-4">
      <div className="mx-auto mb-auto mt-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#013765]/50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#013765]" />
        </span>
        Cargando conversacion
      </div>

      {[
        { side: "left", width: "w-[260px]", lines: ["w-44", "w-28"] },
        { side: "right", width: "w-[330px]", lines: ["w-56", "w-36"] },
        { side: "left", width: "w-[300px]", lines: ["w-52", "w-40", "w-24"] },
        { side: "right", width: "w-[220px]", lines: ["w-32", "w-20"] },
      ].map((item, index) => (
        <div
          key={`${item.side}-${index}`}
          className={cn("flex items-start gap-3", item.side === "right" ? "justify-end" : "justify-start")}
        >
          {item.side === "left" && (
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[#2b5f90]/25" />
          )}
          <div
            className={cn(
              "rounded-2xl border p-3 shadow-sm",
              item.width,
              item.side === "right" ? "border-[#5f86aa]/40 bg-[#013765]/10" : "border-[#8eb0cf]/40 bg-[#2b5f90]/10",
            )}
          >
            <div className="space-y-2">
              {item.lines.map((line, lineIndex) => (
                <div
                  key={`${line}-${lineIndex}`}
                  className={cn("h-3 animate-pulse rounded-full bg-slate-300/80", line)}
                />
              ))}
            </div>
            <div className="mt-3 h-2 w-12 animate-pulse rounded-full bg-slate-300/60" />
          </div>
          {item.side === "right" && (
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[#013765]/25" />
          )}
        </div>
      ))}
    </div>
  )

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

  const MessageDeliveryStatus = ({ status }: { status?: Message["status"] }) => {
    const normalized = String(status ?? "sent").toLowerCase()

    if (normalized === "read") {
      return (
        <span title="Visto" className="inline-flex items-center text-sky-300">
          <CheckCheck className="h-3.5 w-3.5" />
        </span>
      )
    }

    if (normalized === "delivered") {
      return (
        <span title="Entregado" className="inline-flex items-center text-white/75">
          <CheckCheck className="h-3.5 w-3.5" />
        </span>
      )
    }

    if (normalized === "failed") {
      return (
        <span title="No enviado" className="inline-flex items-center text-red-200">
          <X className="h-3.5 w-3.5" />
        </span>
      )
    }

    return (
      <span title="Enviado" className="inline-flex items-center text-white/75">
        <Check className="h-3.5 w-3.5" />
      </span>
    )
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
      case "location":
        return "Nodo: Ubicación"
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

  const getLocationCardData = (message: Message) => {
    const rawBody = (message.body || "").trim()

    try {
      const parsed = JSON.parse(rawBody)
      const latitude = Number(parsed?.latitude)
      const longitude = Number(parsed?.longitude)

      return {
        latitude,
        longitude,
        name: String(parsed?.name ?? "").trim(),
        address: String(parsed?.address ?? "").trim(),
        isValid: Number.isFinite(latitude) && Number.isFinite(longitude),
      }
    } catch {
      return {
        latitude: Number.NaN,
        longitude: Number.NaN,
        name: rawBody.replace(/^\[?Ubicaci[oó]n\]?\s*/i, "").trim(),
        address: "",
        isValid: false,
      }
    }
  }

  const LocationMessageMap = ({
    latitude,
    longitude,
    className = "h-40",
    interactive = false,
  }: {
    latitude: number
    longitude: number
    className?: string
    interactive?: boolean
  }) => {
    const mapRef = useRef<HTMLDivElement | null>(null)
    const pinRef = useRef<HTMLSpanElement | null>(null)

    useEffect(() => {
      if (!mapRef.current) return

      let cancelled = false
      let map: any = null
      let LRef: any = null
      let invalidateTimer: ReturnType<typeof setTimeout> | null = null

      const updatePinPosition = () => {
        if (!map || !pinRef.current || !LRef) return
        const point = map.latLngToContainerPoint(LRef.latLng(latitude, longitude))
        pinRef.current.style.left = `${point.x}px`
        pinRef.current.style.top = `${point.y}px`
      }

      ensureLeaflet()
        .then((L) => {
          if (cancelled || !mapRef.current) return
          LRef = L

          map = L.map(mapRef.current, {
            attributionControl: interactive,
            zoomControl: interactive,
            dragging: interactive,
            scrollWheelZoom: interactive,
            doubleClickZoom: interactive,
            boxZoom: interactive,
            keyboard: interactive,
            touchZoom: interactive,
            zoomAnimation: false,
            markerZoomAnimation: false,
            fadeAnimation: false,
          }).setView([latitude, longitude], 15)

          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map)
          map.on("move zoom resize viewreset", updatePinPosition)
          updatePinPosition()
          invalidateTimer = setTimeout(() => {
            map?.invalidateSize?.()
            updatePinPosition()
          }, 80)
        })
        .catch((error) => {
          console.error("Error cargando mini mapa:", error)
        })

      return () => {
        cancelled = true
        if (invalidateTimer) clearTimeout(invalidateTimer)
        map?.off?.("move zoom resize viewreset", updatePinPosition)
        map?.off?.()
        map?.remove?.()
        map = null
        LRef = null
      }
    }, [latitude, longitude])

    return (
      <div className={`relative isolate w-full overflow-hidden bg-slate-200 ${className}`}>
        <div ref={mapRef} className={`${interactive ? "" : "pointer-events-none"} h-full w-full`} />
        <span className="pointer-events-none absolute inset-0 z-[900] bg-gradient-to-b from-transparent via-transparent to-black/10" />
        <span
          ref={pinRef}
          className="pointer-events-none absolute z-[910] flex h-10 w-10 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full bg-[#013765] text-white shadow-lg ring-4 ring-white"
        >
          <MapPin className="h-5 w-5 fill-current" />
        </span>
      </div>
    )
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

    if (type === "location") {
      const locationData = getLocationCardData(message)
      const label = locationData.name || locationData.address || "Ubicacion"
      const mapsUrl = locationData.isValid
        ? `https://www.google.com/maps?q=${locationData.latitude},${locationData.longitude}`
        : null

      const openLocationPreview = () => {
        setPreview({
          type: "location",
          name: label,
          location: {
            latitude: locationData.latitude,
            longitude: locationData.longitude,
            name: label,
            address: locationData.address,
            isValid: locationData.isValid,
          },
        })
      }

      return (
        <div
          role="button"
          tabIndex={0}
          className="w-full overflow-hidden bg-slate-100 text-left"
          onClick={openLocationPreview}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              openLocationPreview()
            }
          }}
        >
          {locationData.isValid ? (
            <div
              className="group block w-full overflow-hidden bg-slate-200"
              title="Abrir ubicacion"
            >
              <LocationMessageMap latitude={locationData.latitude} longitude={locationData.longitude} />
            </div>
          ) : (
            <div className="flex h-28 items-center justify-center bg-slate-200 text-[#013765]">
              <MapPin className="h-8 w-8" />
            </div>
          )}

          <div className="flex items-start gap-3 px-3 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-[#013765] shadow-sm">
              <MapPin className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-sm font-semibold text-slate-900">{label}</p>
              {locationData.address && locationData.address !== label ? (
                <p className="mt-0.5 line-clamp-2 text-xs font-medium leading-relaxed text-slate-600">{locationData.address}</p>
              ) : null}
              {locationData.isValid ? (
                <p className="mt-1 truncate text-[11px] font-medium text-slate-500">
                  {locationData.latitude.toFixed(6)}, {locationData.longitude.toFixed(6)}
                </p>
              ) : null}
            </div>
            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#013765] shadow-sm transition-colors hover:bg-slate-50"
                title="Abrir en Maps"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          </div>
        </div>
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
  const showContactAvatar = Boolean(chat?.avatar && !contactAvatarFailed)

  return (
    <div className="flex flex-col h-full">
      {/* Header del chat */}
      <div className="border-b border-gray-300 bg-gray-100">
        <div className="flex h-[72px] items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Avatar className="h-10 w-10 overflow-hidden flex items-center justify-center bg-[#2b5f90] text-white">
                {showContactAvatar ? (
                  <img
                    src={chat.avatar ?? ""}
                    alt={chat.name}
                    className="h-full w-full object-cover"
                    onError={() => setContactAvatarFailed(true)}
                  />
                ) : (
                  <User className="h-4 w-4" />
                )}
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
          <ChatMessagesLoader />
        ) : (
          <div className="space-y-4">
            {loadingOlderMessages && (
              <div className="flex justify-center py-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#013765] border-t-transparent" />
                  Cargando mensajes anteriores
                </span>
              </div>
            )}
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
              const isLocationCard = message.message_type === "location"
              const isMediaCard = isVisualMedia || isAudio || isDocument || isContactCard || isLocationCard
              const isBotMessage = message.sender === "user" && message.sender_subtype === "bot"
              const isOperatorMessage = message.sender === "user" && !isBotMessage
              const operatorTooltip = isOperatorMessage
                ? `${message.operator_name ?? chat?.operator_name ?? "Sin nombre"}`
                : undefined
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
                      <Avatar className="h-8 w-8 mt-1 overflow-hidden bg-[#2b5f90] text-white flex items-center justify-center">
                        {showContactAvatar ? (
                          <img
                            src={chat.avatar ?? ""}
                            alt={chat.name}
                            className="h-full w-full object-cover"
                            onError={() => setContactAvatarFailed(true)}
                          />
                        ) : (
                          <User className="h-4 w-4" />
                        )}
                      </Avatar>
                    )}

                    <div
                      className={cn(
                        "min-w-0 overflow-hidden",
                        isMediaCard
                          ? "inline-flex w-[min(420px,70vw)] flex-col rounded-xl border shadow-sm"
                          : "max-w-[70%] rounded-lg px-4 py-2",
                        message.sender === "user"
                          ? (isBotMessage ? "text-white bg-slate-600" : "text-white bg-[#013765]")
                          : "text-white bg-[#2b5f90]",
                        isMediaCard && (
                          message.sender === "user"
                            ? (isBotMessage ? "border-slate-300/70" : "border-[#5f86aa]/70")
                            : "border-[#8eb0cf]/70"
                        ),
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
                          "flex items-center gap-3",
                          message.sender === "user" && !(
                            message.sender_subtype === "bot" && message.bot_node_type
                          )
                            ? "justify-end"
                            : "justify-between",
                          isMediaCard ? "px-3 pb-2 pt-1" : "mt-1",
                        )}
                      >
                        {message.sender === "user" && message.sender_subtype === "bot" && message.bot_node_type ? (
                          <p className="text-[11px] font-semibold text-white/80">
                            {getNodeTypeLabel(message.bot_node_type)}
                          </p>
                        ) : null}
                        <div
                          className={cn(
                            "flex items-center gap-1 text-xs font-medium",
                            message.sender === "user"
                              ? "text-white/70"
                              : "text-white/70",
                          )}
                        >
                          <span>{formatMessageTime(message.timestamp)}</span>
                          {message.sender === "user" ? (
                            <MessageDeliveryStatus status={message.status} />
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {message.sender === "user" && (
                      isOperatorMessage && operatorTooltip ? (
                        <HoverTooltip label={operatorTooltip} position="top">
                          <Avatar
                            aria-label={operatorTooltip}
                            className="h-8 w-8 mt-1 flex items-center justify-center bg-[#013765] text-white"
                          >
                            <Headset className="h-4 w-4" />
                          </Avatar>
                        </HoverTooltip>
                      ) : (
                        <Avatar className="h-8 w-8 mt-1 flex items-center justify-center bg-slate-600 text-white">
                          <Bot className="h-4 w-4" />
                        </Avatar>
                      )
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

          <div ref={attachmentMenuRef} className="relative">
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
              <div className="absolute bottom-14 left-0 z-[9997] w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
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
                  onClick={openLocationModal}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <MapPin className="h-4 w-4" />
                  </span>
                  <span className="flex-1">Ubicacion</span>
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

          <div ref={quickRepliesMenuRef} className="relative">
            <Button
              type="button"
              variant="outline"
              disabled={sending || !chat || recordingAudio || readOnly}
              aria-label="Abrir respuestas rápidas"
              aria-expanded={quickRepliesOpen}
              onClick={() => {
                setQuickRepliesOpen((open) => !open)
                setAttachmentMenuOpen(false)
              }}
              className={cn(
                "h-11 w-11 border-gray-300 p-0",
                quickRepliesOpen && "border-[#013765] bg-[#013765] text-white hover:bg-[#012e54]",
              )}
              title="Respuestas rápidas"
            >
              <MessageSquareText className="h-5 w-5" />
            </Button>

            {quickRepliesOpen && !readOnly && chat && (
              <div className="absolute bottom-14 left-0 z-[9997] w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">Respuestas rápidas</p>
                  <p className="mt-0.5 text-xs text-slate-500">Elegí una para cargarla en el mensaje.</p>
                </div>
                <div className="max-h-80 space-y-1 overflow-y-auto p-2 custom-scrollbar">
                  {quickRepliesLoading ? (
                    <div className="py-6 text-center text-xs text-slate-500">Cargando respuestas...</div>
                  ) : quickReplies.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500">No hay respuestas guardadas.</div>
                  ) : quickReplies.map((reply) => (
                    <button
                      key={reply.id}
                      type="button"
                      onClick={() => selectQuickReply(reply.body)}
                      className="block w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#013765]/30"
                    >
                      <span className="block text-xs font-semibold text-[#013765]">{reply.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-600">{reply.body}</span>
                    </button>
                  ))}
                </div>
                <a
                  href={`${import.meta.env.VITE_APP_URL}/quick-replies-panel`}
                  className="flex items-center justify-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs font-semibold text-[#013765] transition-colors hover:bg-slate-50"
                >
                  Administrar respuestas
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 relative">
            {activeSpellingMatch &&
              dismissedSpellingKey !== `${activeSpellingMatch.start}-${activeSpellingMatch.word}` && (
                <div className="absolute bottom-full left-2 z-[9996] mb-2 w-max max-w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{activeSpellingMatch.word}</span>
                    <button
                      type="button"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      onClick={() => setDismissedSpellingKey(`${activeSpellingMatch.start}-${activeSpellingMatch.word}`)}
                      aria-label="Ocultar sugerencias"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {activeSpellingMatch.suggestions.length > 0 ? (
                    <div className="flex max-w-full flex-wrap gap-1.5 p-2">
                      {activeSpellingMatch.suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-[#013765] hover:border-[#013765]/40 hover:bg-[#013765]/5"
                          onClick={() => replaceSpellingMatch(activeSpellingMatch, suggestion)}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="px-3 py-2 text-xs text-slate-500">No encontramos una corrección sugerida.</p>
                  )}
                </div>
              )}
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
            <div className="relative h-11">
              {newMessage && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-0 flex items-center overflow-hidden whitespace-pre px-3 pr-20 text-sm text-slate-900"
                >
                  {renderSpellingOverlay()}
                </div>
              )}
              <Input
                ref={messageInputRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                onClick={activateSpellingMatchAtCaret}
                onKeyUp={(event) => {
                  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) activateSpellingMatchAtCaret()
                }}
                lang="es-AR"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="sentences"
                placeholder={
                  readOnly
                    ? readOnlyReason === "bot"
                      ? "Solo lectura: bot activo"
                      : "Solo lectura: chat atendido por otro operador"
                    : "Escribe un mensaje..."
                }
                disabled={readOnly}
                className={cn(
                  "relative z-10 min-h-[44px] resize-none border-gray-300 bg-transparent pr-20",
                  newMessage && "text-transparent caret-slate-900 selection:bg-blue-200/70",
                )}
              />
            </div>
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

      {locationModalOpen && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Enviar ubicacion</h3>
                <p className="text-xs text-slate-500">Buscá una dirección o marcá el punto directamente en el mapa.</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl border border-gray-300 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setLocationModalOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid max-h-[75vh] gap-0 overflow-y-auto md:grid-cols-[360px_1fr]">
              <div className="border-b border-slate-200 bg-slate-50 p-5 md:border-b-0 md:border-r">
                <div>
                  <label className="text-xs font-semibold text-slate-600">Buscar direccion</label>
                  <div className="mt-1 flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        value={locationSearchQuery}
                        onChange={(event) => setLocationSearchQuery(event.target.value)}
                        autoComplete="off"
                        name="location_search_query"
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()
                            void searchLocationAddress()
                          }
                        }}
                        placeholder="Ej: Plaza Independencia, Mendoza"
                        className="pl-9"
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={() => void searchLocationAddress()}
                      disabled={locationSearching}
                      className="bg-[#013765] text-white hover:bg-[#012e54]"
                    >
                      {locationSearching ? "Buscando..." : "Buscar"}
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={useCurrentLocation}
                    disabled={locationDetecting}
                    className="mt-2 w-full border-slate-300 bg-white text-[#013765] hover:bg-slate-100"
                  >
                    <MapPin className="mr-2 h-4 w-4" />
                    {locationDetecting ? "Obteniendo ubicacion..." : "Usar mi ubicacion actual"}
                  </Button>
                </div>

                {locationSearchResults.length > 0 && (
                  <div className="mt-3 max-h-[440px] space-y-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                    {locationSearchResults.map((result) => (
                      <button
                        key={result.place_id}
                        type="button"
                        onClick={() => {
                          const latitude = Number(result.lat)
                          const longitude = Number(result.lon)
                          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
                          void selectLocation(
                            latitude,
                            longitude,
                            result.name || result.display_name.split(",")[0],
                            result.display_name,
                            false,
                          )
                        }}
                        className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-slate-100"
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#013765]" />
                        <span className="line-clamp-2 text-xs font-medium text-slate-700">{result.display_name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {locationHistory.length > 0 && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                    <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Ubicaciones recientes
                    </div>
                    <div className="max-h-[220px] space-y-1 overflow-y-auto">
                      {locationHistory.map((item) => (
                        <button
                          key={`${item.id}-${item.saved_at}`}
                          type="button"
                          onClick={() => {
                            const latitude = Number(item.latitude)
                            const longitude = Number(item.longitude)
                            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
                            void selectLocation(latitude, longitude, item.name, item.address, false)
                          }}
                          className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-slate-100"
                        >
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#013765]" />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-slate-800">
                              {item.name || "Ubicacion"}
                            </span>
                            <span className="line-clamp-2 text-[11px] font-medium leading-relaxed text-slate-500">
                              {item.address || `${item.latitude}, ${item.longitude}`}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4 p-5">
                <div className="relative h-[380px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-inner xl:h-[430px]">
                  <div ref={locationMapRef} className="h-full w-full" />
                  <span
                    ref={locationPinRef}
                    className="pointer-events-none absolute z-[910] flex h-12 w-12 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full bg-[#013765] text-white opacity-0 shadow-lg ring-4 ring-white"
                  >
                    <MapPin className="h-6 w-6 fill-current" />
                  </span>
                  <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-white/95 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm">
                    Click en el mapa para seleccionar la ubicacion
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#013765] shadow-sm">
                      <MapPin className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {locationDraft.name.trim() || "Nombre del lugar"}
                      </p>
                      <p className="line-clamp-2 text-xs font-medium leading-relaxed text-slate-500">
                        {locationDraft.address.trim() || "Direccion opcional"}
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600">Nombre del lugar</label>
                  <Input
                    value={locationDraft.name}
                    onChange={(event) => setLocationDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Ej: Oficina central"
                    className="mt-1"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600">Direccion</label>
                  <textarea
                    value={locationDraft.address}
                    onChange={(event) => setLocationDraft((current) => ({ ...current, address: event.target.value }))}
                    autoComplete="off"
                    name="location_address"
                    placeholder="Ej: Av. Siempre Viva 742"
                    rows={2}
                    className="mt-1 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Latitud</label>
                    <Input
                      value={locationDraft.latitude}
                      readOnly
                      placeholder="Seleccioná en el mapa"
                      className="mt-1 bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Longitud</label>
                    <Input
                      value={locationDraft.longitude}
                      readOnly
                      placeholder="Seleccioná en el mapa"
                      className="mt-1 bg-slate-50"
                    />
                  </div>
                </div>

                {locationDraftError ? (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {locationDraftError}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <Button variant="outline" onClick={() => setLocationModalOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={sendLocationFromModal}
                disabled={sendingLocation}
                className="bg-[#013765] text-white hover:bg-[#012e54]"
              >
                {sendingLocation ? "Enviando..." : "Enviar ubicacion"}
              </Button>
            </div>
          </div>
        </div>
      )}

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
                    ) : preview.type === "location" ? (
                      <MapPin className="h-5 w-5" />
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
                              : preview.type === "location"
                                ? "Ubicacion"
                            : "Documento"}
                    </div>
                    <div className="truncate text-sm font-semibold text-slate-900">{preview.name}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
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

                {preview.type === "location" && preview.location && (
                  <div className="bg-white p-6">
                    <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                      {preview.location.isValid ? (
                        <LocationMessageMap
                          latitude={preview.location.latitude}
                          longitude={preview.location.longitude}
                          className="h-[420px]"
                          interactive
                        />
                      ) : (
                        <div className="flex h-64 items-center justify-center bg-slate-100 text-[#013765]">
                          <MapPin className="h-10 w-10" />
                        </div>
                      )}
                      <div className="flex items-start gap-3 p-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[#013765] shadow-sm">
                          <MapPin className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900">{preview.location.name}</p>
                          {preview.location.address ? (
                            <p className="mt-1 text-sm font-medium leading-relaxed text-slate-600">{preview.location.address}</p>
                          ) : null}
                          {preview.location.isValid ? (
                            <p className="mt-1 text-xs font-medium text-slate-500">
                              {preview.location.latitude.toFixed(6)}, {preview.location.longitude.toFixed(6)}
                            </p>
                          ) : null}
                        </div>
                        {preview.location.isValid ? (
                          <a
                            href={`https://www.google.com/maps?q=${preview.location.latitude},${preview.location.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#013765] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#012e54]"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Abrir en Google Maps
                          </a>
                        ) : null}
                      </div>
                    </div>
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
