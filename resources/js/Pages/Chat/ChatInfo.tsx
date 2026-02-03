"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { Code, Database, Zap, User, Image as ImageIcon, FileText, Video, Music } from "lucide-react"
import { Avatar } from "shadcn/components/ui/avatar"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import mqtt from "mqtt"
import type { Chat, ChatVariable } from "./ChatPanel"

interface ChatInfoProps {
  chat?: Chat
  variables?: ChatVariable[]
}

type VarType = "string" | "number" | "boolean" | "object" | "array" | "null" | "unknown"
type MediaType = "image" | "video" | "audio" | "document"

interface MediaItem {
  id: number
  sender: "user" | "contact"
  message_type: MediaType
  body?: string | null
  media_url: string
  media_name?: string | null
  created_at?: string | null
}

type PreviewMedia = {
  url: string
  name: string
  type: MediaType
}

const API_BASE = (import.meta.env.VITE_APP_URL || "").replace(/\/$/, "")

export default function ChatInfo({ chat, variables = [] }: ChatInfoProps) {
  if (!chat) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-center">
          <h3 className="text-lg font-medium text-foreground mb-2">Información del Chat</h3>
          <p className="text-muted-foreground text-sm">Selecciona una conversación para ver los detalles</p>
        </div>
      </div>
    )
  }

  // ---------------------------
  // Helpers Variables
  // ---------------------------
  const detectType = (value: any): VarType => {
    if (value === null || value === undefined) return "null"
    if (Array.isArray(value)) return "array"
    const t = typeof value
    if (t === "string") return "string"
    if (t === "number") return "number"
    if (t === "boolean") return "boolean"
    if (t === "object") return "object"
    return "unknown"
  }

  const getVariableIcon = (type: VarType) => {
    switch (type) {
      case "boolean":
        return <Zap className="h-3 w-3" />
      case "object":
      case "array":
        return <Database className="h-3 w-3" />
      default:
        return <Code className="h-3 w-3" />
    }
  }

  const formatVariableValue = (value: any, type: VarType) => {
    if (type === "object" || type === "array") {
      try {
        return JSON.stringify(value, null, 2)
      } catch {
        return String(value)
      }
    }
    if (type === "null") return "null"
    return String(value)
  }

  // ---------------------------
  // ✅ Variables: MAPA (sin duplicados)
  // ---------------------------
  const [varsMap, setVarsMap] = useState<Record<string, any>>(() => {
    if (Array.isArray(variables) && variables.length > 0) {
      const m: Record<string, any> = {}
      for (const v of variables) m[v.name] = v.value
      return m
    }
    const initial = (chat?.bot_state as any)?.vars
    return initial && typeof initial === "object" && !Array.isArray(initial) ? initial : {}
  })

  // rehidrata vars al cambiar chat
  useEffect(() => {
    if (Array.isArray(variables) && variables.length > 0) {
      const m: Record<string, any> = {}
      for (const v of variables) m[v.name] = v.value
      setVarsMap(m)
      return
    }

    const v = (chat?.bot_state as any)?.vars
    setVarsMap(v && typeof v === "object" && !Array.isArray(v) ? v : {})
  }, [chat?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const derivedVars: ChatVariable[] = useMemo(() => {
    const list: ChatVariable[] = Object.entries(varsMap).map(([name, value]) => ({
      name,
      value,
      type: detectType(value),
    }))
    list.sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [varsMap]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasVars = derivedVars.length > 0

  // ---------------------------
  // ✅ Medios
  // ---------------------------
  const [media, setMedia] = useState<MediaItem[]>([])
  const [activeMediaType, setActiveMediaType] = useState<MediaType | "all">("all")
  const [preview, setPreview] = useState<PreviewMedia | null>(null)

  // thumbs de video (dataURL)
  const [videoThumbs, setVideoThumbs] = useState<Record<string, string>>({})

  const resolveMediaUrl = (url: string) => {
    if (!url) return url
    if (url.startsWith("http://") || url.startsWith("https://")) return url
    return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`
  }

  const mediaFiltered = useMemo(() => {
    if (activeMediaType === "all") return media
    return media.filter((m) => m.message_type === activeMediaType)
  }, [media, activeMediaType])

  const mediaCounts = useMemo(() => {
    const c = { image: 0, video: 0, audio: 0, document: 0 }
    for (const m of media) c[m.message_type]++
    return c
  }, [media])

  // ---------------------------
  // Thumbnails de video (captura de frame)
  // ---------------------------
  const captureVideoThumb = (url: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const video = document.createElement("video")
      video.src = url
      video.muted = true
      video.playsInline = true
      video.preload = "metadata"

      // Si servís desde otro dominio, necesitás CORS + esto:
      // video.crossOrigin = "anonymous"

      const cleanup = () => {
        try {
          video.pause()
          video.removeAttribute("src")
          video.load()
        } catch { }
      }

      video.onloadedmetadata = () => {
        const t = Math.min(0.1, Math.max(0, (video.duration || 0) * 0.01))
        video.currentTime = t
      }

      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas")
          canvas.width = video.videoWidth || 320
          canvas.height = video.videoHeight || 180
          const ctx = canvas.getContext("2d")
          if (!ctx) {
            cleanup()
            return resolve(null)
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const dataUrl = canvas.toDataURL("image/jpeg", 0.75)
          cleanup()
          resolve(dataUrl)
        } catch {
          cleanup()
          resolve(null)
        }
      }

      video.onerror = () => {
        cleanup()
        resolve(null)
      }
    })
  }

  useEffect(() => {
    if (!chat?.id) return

    const videos = mediaFiltered.filter((m) => m.message_type === "video" && m.media_url)
    let cancelled = false

    const run = async () => {
      for (const v of videos) {
        const key = String(v.id)
        if (videoThumbs[key]) continue

        const url = resolveMediaUrl(v.media_url)
        const thumb = await captureVideoThumb(url)

        if (!cancelled && thumb) {
          setVideoThumbs((prev) => ({ ...prev, [key]: thumb }))
        }
      }
    }

    run()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id, mediaFiltered])

  // ---------------------------
  // Cargar medios iniciales (REST)
  // ---------------------------
  useEffect(() => {
    if (!chat?.id) return

    setMedia([])
    setVideoThumbs({}) // opcional: limpiar thumbs al cambiar chat
    setPreview(null)

    fetch(`${API_BASE}/api/chats/${chat.id}/media?limit=80`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => {
        const list: MediaItem[] = data.media ?? data ?? []
        list.sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
        setMedia(list)
      })
      .catch(() => {
        setMedia([])
      })
  }, [chat?.id])

  // ---------------------------
  // MQTT (vars + chat messages -> media)
  // ---------------------------
  const clientRef = useRef<any>(null)

  useEffect(() => {
    if (!chat?.id) return

    try {
      clientRef.current?.end?.(true)
    } catch { }

    const host = import.meta.env.VITE_MOSQUITTO_HOST
    const client = mqtt.connect(`ws://${host}:9001`, {
      clientId: `front_chatinfo_${chat.id}_${Math.random().toString(16).slice(2)}`,
      clean: true,
      reconnectPeriod: 2000,
    })

    clientRef.current = client

    const topicVars = `chat/${chat.id}/vars`
    const topicChat = `chat/${chat.id}`

    client.on("connect", () => {
      client.subscribe(topicVars)
      client.subscribe(topicChat)
    })

    client.on("message", (t, payload) => {
      try {
        const data = JSON.parse(payload.toString())

        // Vars
        if (t === topicVars) {
          if (String(data.chat_id) !== String(chat.id)) return

          if (data.vars && typeof data.vars === "object" && !Array.isArray(data.vars)) {
            setVarsMap(data.vars)
            return
          }

          if (data.var?.name) {
            const k = String(data.var.name)
            setVarsMap((prev) => ({ ...prev, [k]: data.var.value }))
          }
          return
        }

        // Chat messages
        if (t === topicChat) {
          if (String(data.chat_id) !== String(chat.id)) return

          const msgType = String(data.message_type || "")
          const mediaUrl = data.media_url ? String(data.media_url) : ""
          if (!mediaUrl) return

          if (!["image", "video", "audio", "document"].includes(msgType)) return

          const item: MediaItem = {
            id: Number(data.message_id),
            sender: data.sender === "contact" ? "contact" : "user",
            message_type: msgType as MediaType,
            body: data.body ?? null,
            media_url: mediaUrl,
            media_name: data.media_name ?? null,
            created_at: data.timestamp ?? null,
          }

          setMedia((prev) => {
            if (prev.some((x) => String(x.id) === String(item.id))) return prev
            return [item, ...prev]
          })
        }
      } catch (err) {
        console.error("Error MQTT ChatInfo:", err)
      }
    })

    return () => {
      try {
        client.end(true)
      } catch { }
    }
  }, [chat?.id])

  // ---------------------------
  // UI helpers
  // ---------------------------
  const MediaTabBtn = ({
    label,
    value,
    icon,
    count,
  }: {
    label: string
    value: MediaType | "all"
    icon: React.ReactNode
    count?: number
  }) => {
    const active = activeMediaType === value
    return (
      <Button
        type="button"
        size="sm"
        variant={active ? "default" : "outline"}
        className={active ? "bg-[#013765] hover:bg-[#024a8a] text-white" : "border-gray-200 bg-blue-100 text-black"}
        onClick={() => setActiveMediaType(value)}
      >
        <span className="flex items-center gap-2">
          {icon}
          <span className="text-xs">{label}</span>
          {typeof count === "number" && (
            <span className={active ? "text-white/90" : "text-muted-foreground"}>({count})</span>
          )}
        </span>
      </Button>
    )
  }

  const MediaCard = ({
    name,
    children,
  }: {
    name: string
    children: React.ReactNode
  }) => (
    <div className="rounded-lg overflow-hidden border hover:opacity-95 transition">
      <div className="h-24 w-full bg-blue-100 flex items-center justify-center">{children}</div>
      <div className="px-2 py-1 border-t bg-white">
        <div className="text-[10px] text-muted-foreground truncate">{name}</div>
      </div>
    </div>
  )

  // ---------------------------
  // Render
  // ---------------------------
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-300 bg-gray-50">
        <h2 className="text-lg font-semibold text-foreground">Información del Chat</h2>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-4">
          {/* Contacto */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="relative mb-3">
              <Avatar className="h-16 w-16 bg-gray-300 flex items-center justify-center">
                <User />
              </Avatar>
            </div>
            <h3 className="font-semibold text-foreground text-lg">{chat.name}</h3>
            <p className="text-sm text-muted-foreground">{chat.number}</p>

            {chat.unread > 0 && (
              <Badge variant="secondary" className="mt-2 bg-[#013765] text-white">
                {chat.unread} mensajes sin leer
              </Badge>
            )}
          </div>

          {/* Variables */}
          <div className="mb-8">
            <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <Database className="h-4 w-4" />
              Variables del Chat
            </h4>

            {!hasVars ? (
              <div className="bg-muted/30 rounded-lg p-3 border border-gray-300">
                <p className="text-sm text-muted-foreground">Todavía no hay variables capturadas en este chat.</p>
              </div>
            ) : (
              <div className="space-y-3 bg-blue-500 rounded-xl">
                {derivedVars.map((variable) => {
                  const t = (variable.type as VarType) ?? detectType(variable.value)
                  return (
                    <div
                      key={variable.name}
                      className="rounded-lg border border-gray-200 bg-gray-100/80 px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {getVariableIcon(t)}
                          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                            {variable.name}
                          </span>
                        </div>

                        <span className="text-[11px] text-muted-foreground">{t}</span>
                      </div>

                      <div className="mt-1">
                        <div className="text-sm font-medium text-foreground break-words">
                          {formatVariableValue(variable.value, t)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Medios */}
          <div className="mb-8">
            <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Medios
            </h4>

            <div className="flex flex-wrap gap-2 mb-3">
              <MediaTabBtn label="Todos" value="all" icon={<ImageIcon className="h-4 w-4" />} count={media.length} />
              <MediaTabBtn
                label="Imágenes"
                value="image"
                icon={<ImageIcon className="h-4 w-4" />}
                count={mediaCounts.image}
              />
              <MediaTabBtn label="Videos" value="video" icon={<Video className="h-4 w-4" />} count={mediaCounts.video} />
              <MediaTabBtn label="Audio" value="audio" icon={<Music className="h-4 w-4" />} count={mediaCounts.audio} />
              <MediaTabBtn
                label="Docs"
                value="document"
                icon={<FileText className="h-4 w-4" />}
                count={mediaCounts.document}
              />
            </div>

            {mediaFiltered.length === 0 ? (
              <div className="bg-muted/30 rounded-lg p-3 border border-gray-300">
                <p className="text-sm text-muted-foreground">Todavía no hay medios en este chat.</p>
              </div>
            ) : (
              <div className="border rounded-lg p-3 bg-white">
                <div className="grid grid-cols-3 gap-2">
                  {mediaFiltered.slice(0, 90).map((m) => {
                    const url = resolveMediaUrl(m.media_url)
                    const name = m.media_name ?? `${m.message_type} #${m.id}`

                    if (m.message_type === "image") {
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setPreview({ url, name, type: "image" })}
                          className="text-left"
                          title={name}
                        >
                          <MediaCard name={name}>
                            <img src={url} alt={name} className="w-full h-24 object-cover" loading="lazy" />
                          </MediaCard>
                        </button>
                      )
                    }

                    if (m.message_type === "video") {
                      const vidThumb = videoThumbs[String(m.id)]

                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setPreview({ url, name, type: "video" })}
                          className="text-left"
                          title={name}
                        >
                          <MediaCard name={name}>
                            {vidThumb ? (
                              <div className="relative w-full h-24">
                                <img src={vidThumb} className="w-full h-24 object-cover" alt={name} loading="lazy" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className="rounded-full bg-black/50 p-2">
                                    <Video className="h-5 w-5 text-white" />
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="w-full h-24 flex flex-col items-center justify-center gap-1">
                                <Video className="h-6 w-6 text-muted-foreground" />
                                <div className="text-[10px] text-muted-foreground">Cargando vista previa...</div>
                              </div>
                            )}
                          </MediaCard>
                        </button>
                      )
                    }

                    if (m.message_type === "audio") {
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setPreview({ url, name, type: "audio" })}
                          className="text-left"
                          title={name}
                        >
                          <MediaCard name={name}>
                            <div className="w-full h-24 flex flex-col items-center justify-center gap-1">
                              <Music className="h-6 w-6 text-muted-foreground" />
                              <div className="text-[10px] text-muted-foreground">Reproducir</div>
                            </div>
                          </MediaCard>
                        </button>
                      )
                    }

                    // document
                    return (
                      <a
                        key={m.id}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        title={name}
                        className="block"
                      >
                        <MediaCard name={name}>
                          <div className="flex flex-col items-center justify-center gap-2 px-2">
                            <FileText className="h-6 w-6 text-muted-foreground" />
                            <div className="text-[11px] text-muted-foreground text-center line-clamp-2">{name}</div>
                          </div>
                        </MediaCard>
                      </a>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Preview modal */}
            {preview && (
              <div
                className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-4"
                onClick={() => setPreview(null)}
              >
                <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
                  <div className="bg-white rounded-xl overflow-hidden">
                    {/* Header con nombre */}
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

                    {/* Body */}
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
                        <div className="p-4 bg-white">
                          <p className="text-sm text-muted-foreground mb-2">Documento:</p>
                          <a href={preview.url} target="_blank" rel="noreferrer" className="text-sm underline">
                            {preview.name}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* fin Medios */}
        </div>
      </div>
    </div>
  )
}
