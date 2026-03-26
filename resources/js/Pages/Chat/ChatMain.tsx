"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Bot, ChevronDown, ChevronUp, FileText, Headset, Mic, Paperclip, Search, Send, Square, User, X } from "lucide-react"
import { Button } from "shadcn/components/ui/button"
import { Input } from "shadcn/components/ui/input"
import { Avatar } from "shadcn/components/ui/avatar"
import type { Chat, Message } from "./ChatPanel"
import { cn } from "shadcn/lib/utils"
import mqtt from "mqtt"
import { format, isToday, isYesterday, parseISO } from "date-fns"
import { es } from "date-fns/locale"

interface ChatMainProps {
  chat?: Chat
  readOnly?: boolean
  readOnlyOperatorName?: string | null
  readOnlyReason?: "operator" | "bot" | null
}

type PreviewMedia = {
  url: string
  name: string
  type: "image" | "video" | "audio" | "document"
}

type PendingMedia = {
  file: File
  type: "image" | "video" | "audio" | "document"
  previewUrl: string
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

  const handlePickFile = () => {
    if (sending || readOnly) return
    setMediaError(null)
    fileInputRef.current?.click()
  }

  const resolvePendingType = (file: File): PendingMedia["type"] => {
    const mime = file.type || ""
    if (mime.startsWith("image/")) return "image"
    if (mime.startsWith("video/")) return "video"
    if (mime.startsWith("audio/")) return "audio"
    return "document"
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
    const rejectedAudio: string[] = []

    selectedFiles.forEach((file) => {
      const kind = resolvePendingType(file)
      if (kind !== "audio") {
        validFiles.push(file)
        return
      }

      const mime = (file.type || "").toLowerCase()
      const validAudio =
        mime.startsWith("audio/ogg") ||
        mime === "audio/mpeg" ||
        mime === "audio/mp4" ||
        mime === "audio/aac" ||
        mime === "audio/amr"

      if (validAudio) {
        validFiles.push(file)
      } else {
        rejectedAudio.push(file.name || mime || "audio")
      }
    })

    if (rejectedAudio.length > 0) {
      setMediaError(`Audio no soportado: ${rejectedAudio.join(", ")}. Usa OGG/MP3/M4A.`)
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
          console.error("Error al enviar media", await res.text())
          setMediaError(`No se pudo enviar: ${item.file.name}`)
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
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <h3 className="text-lg font-medium text-foreground mb-2">
            Selecciona una conversación
          </h3>
          <p className="text-muted-foreground">
            Elige un chat de la lista para comenzar a conversar
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
        <div className="space-y-1">
          <button
            type="button"
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
              className="block max-w-[400px] max-h-[400px] rounded-lg"
            />
          </button>
          {message.body && (
            <p className="text-sm leading-relaxed mt-1 break-words">
              {message.body}
            </p>
          )}
        </div>
      )
    }

    if (type === "video" && src) {

  return (
        <div className="space-y-1">
          <button
            type="button"
            className="text-left"
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
              controls
              className="rounded-lg max-w-[400px] max-h-[400px]"
            />
          </button>
          {message.body && (
            <p className="text-sm leading-relaxed mt-1 break-words">
              {message.body}
            </p>
          )}
        </div>
      )
    }

    if (type === "audio" && src) {

  return (
        <div className="space-y-1 w-full">
          <audio src={src} controls className="w-full min-w-[240px]" />
        </div>
      )
    }

    if (type === "document" && src) {
      const documentLabel = getDocumentLabel(message)

  return (
        <div className="space-y-2">
          <button
            type="button"
            className="text-left"
            onClick={() =>
              setPreview({
                url: src,
                name: documentLabel,
                type: "document",
              })
            }
          >
            <div className="w-32 rounded-lg overflow-hidden border border-gray-300 bg-white">
              <div className="h-20 w-full flex items-center justify-center bg-gray-50">
                <FileText className="h-8 w-8 text-gray-600" />
              </div>
              <div className="px-2 py-1 border-t bg-white">
                <div className="text-[10px] text-gray-700 truncate">
                  {documentLabel}
                </div>
              </div>
            </div>
          </button>
        </div>
      )
    }

    // Texto por defecto

  return (
      <p className="text-sm leading-relaxed break-words">
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
                        isVisualMedia
                          ? "inline-flex flex-col items-end rounded-lg p-1"
                          : isAudio
                            ? "min-w-[260px] max-w-[360px] rounded-lg px-3 py-2"
                          : "max-w-[70%] rounded-lg px-4 py-2",
                        message.sender === "user"
                          ? (isBotMessage ? "text-white bg-slate-600" : "text-white bg-[#013765]")
                          : "text-white bg-[#2b5f90]",
                      )}
                    >
                      {renderMessageContent(message)}

                      {message.sender === "user" &&
                        message.sender_subtype === "bot" &&
                        (message.bot_node_type === "buttons" || message.bot_node_type === "list") &&
                        Array.isArray(message.interactive_options) &&
                        message.interactive_options.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {message.interactive_options.map((opt, idx) => (
                              <span
                                key={`${message.id}-opt-${idx}-${opt.id}`}
                                className="inline-flex items-center rounded-full border border-white/30 bg-white/15 px-2 py-0.5 text-[11px] text-white"
                              >
                                {opt.label}
                              </span>
                            ))}
                          </div>
                        )}

                      <div className="mt-1 flex items-center justify-between gap-3">
                        <p
                          className={cn(
                            "text-xs",
                            message.sender === "user"
                              ? "text-white/70"
                              : "text-white/70",
                          )}
                        >
                          {formatMessageTime(message.timestamp)}
                        </p>
                        <p
                          className={cn(
                            "text-[11px]",
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

          <Button
            type="button"
            variant="outline"
            disabled={sending || !chat || recordingAudio || readOnly}
            onClick={handlePickFile}
            className="h-11 w-11 p-0 border-gray-300"
            title="Adjuntar archivo"
          >
            <Paperclip className="h-4 w-4" />
          </Button>

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
            className="h-11 px-4 bg-[#013765]"
          >
            {sending ? (
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <Send className="h-4 w-4 text-white" />
            )}
          </Button>
        </div>
      </div>

      {preview && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-4"
          onClick={() => setPreview(null)}
        >
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white rounded-xl overflow-hidden">
              <div className="p-2 border-b flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] text-muted-foreground">Vista previa</div>
                  <div className="text-sm font-medium truncate">{preview.name}</div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={preview.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline text-muted-foreground hover:text-foreground"
                  >
                    Abrir
                  </a>

                  <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
                    Cerrar
                  </Button>
                </div>
              </div>

              <div className="bg-black">
                {preview.type === "image" && (
                  <img src={preview.url} alt={preview.name} className="w-full max-h-[75vh] object-contain" />
                )}

                {preview.type === "video" && (
                  <video controls preload="metadata" className="w-full max-h-[75vh] object-contain">
                    <source src={preview.url} />
                  </video>
                )}

                {preview.type === "audio" && (
                  <div className="p-4 bg-white">
                    <audio controls className="w-full">
                      <source src={preview.url} />
                    </audio>
                  </div>
                )}

                {preview.type === "document" && (
                  <div className="bg-white">
                    {isPreviewableDocument(preview.name, preview.url) ? (
                      <iframe
                        src={preview.url}
                        title={preview.name}
                        className="w-full h-[75vh]"
                      />
                    ) : (
                      <div className="p-4">
                        <p className="text-sm text-muted-foreground mb-2">
                          Vista previa no disponible para este formato.
                        </p>
                        <a href={preview.url} target="_blank" rel="noreferrer" className="text-sm underline">
                          Abrir documento: {preview.name}
                        </a>
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



