"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { Send, User, MoreVertical } from "lucide-react"
import { Button } from "shadcn/components/ui/button"
import { Input } from "shadcn/components/ui/input"
import { Avatar, AvatarFallback } from "shadcn/components/ui/avatar"
import type { Chat, Message } from "./ChatPanel"
import { cn } from "shadcn/lib/utils"
import mqtt from "mqtt"
import { format, isToday, isYesterday, parseISO } from "date-fns"
import { es } from "date-fns/locale"

interface ChatMainProps {
  chat?: Chat
}

export default function ChatMain({ chat }: ChatMainProps) {
  const [newMessage, setNewMessage] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)

  const [botEnabled, setBotEnabled] = useState<boolean>(chat?.bot_enabled ?? true)
  const [togglingBot, setTogglingBot] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  // 🔹 Sync de estado del bot cuando cambia el chat
  useEffect(() => {
    if (chat) {
      setBotEnabled(chat.bot_enabled ?? true)
    }
  }, [chat?.id, chat?.bot_enabled])

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

    const client = mqtt.connect("ws://127.0.0.1:9001")

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
    if (!messagesEndRef.current) return
    messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
  }, [messages.length, chat?.id])

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !chat || sending) return

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

  // 🔹 Pausar / reanudar bot para este chat
  const handleToggleBot = async () => {
    if (!chat || togglingBot) return

    const nextEnabled = !botEnabled
    setTogglingBot(true)

    // Optimista
    setBotEnabled(nextEnabled)

    try {
      const res = await fetch(
        `${import.meta.env.VITE_APP_URL}/api/chats/${chat.id}/bot`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ bot_enabled: nextEnabled }),
        },
      )

      if (!res.ok) {
        console.error("Error al actualizar estado del bot", await res.text())
        // revertimos
        setBotEnabled(!nextEnabled)
      }
    } catch (err) {
      console.error("Error de red al actualizar bot:", err)
      setBotEnabled(!nextEnabled)
    } finally {
      setTogglingBot(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

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

  function formatChatTimestamp(timestamp: string) {
    const date = parseISO(timestamp)

    if (isToday(date)) {
      return format(date, "HH:mm", { locale: es })
    }

    if (isYesterday(date)) {
      return "Ayer " + format(date, "HH:mm", { locale: es })
    }

    return format(date, "dd/MM HH:mm", { locale: es })
  }

  // 🔹 Render según tipo de mensaje
  const renderMessageContent = (message: Message) => {
    const type = message.message_type ?? "text"
    const src = buildMediaSrc(message.media_url || undefined)
    const isSticker = type === "image" && message.body === "[Sticker]"

    if (isSticker && src) {
      return (
        <img
          src={src}
          alt="Sticker"
          className="w-48 h-48 object-contain rounded-lg"
        />
      )
    }

    // Imagen normal
    if (type === "image" && src) {
      return (
        <div className="space-y-1">
          <img
            src={src}
            alt={message.media_name ?? "Imagen"}
            className="block max-w-[400px] max-h-[400px] rounded-lg"
          />
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
          <video
            src={src}
            controls
            className="rounded-lg max-w-[400px] max-h-[400px]"
          />
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
          <audio src={src} controls className="w-full" />
        </div>
      )
    }

    if (type === "document" && src) {
      return (
        <div className="space-y-1">
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="underline text-sm"
          >
            {message.media_name ?? "Ver documento"}
          </a>
          {message.body && (
            <p className="text-sm leading-relaxed mt-1 break-words">
              {message.body}
            </p>
          )}
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

  return (
    <div className="flex flex-col h-full">
      {/* Header del chat */}
      <div className="flex items-center justify-between p-4 border-b border-gray-300 bg-gray-100">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10 flex items-center justify-center bg-gray-300 text-black">
              <User />
            </Avatar>
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold text-foreground">{chat.name}</h2>

            {/* Estado del bot */}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  botEnabled
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-gray-200 text-gray-700",
                )}
              >
                <span
                  className={cn(
                    "mr-1 h-2 w-2 rounded-full",
                    botEnabled ? "bg-emerald-500" : "bg-gray-400",
                  )}
                />
                {botEnabled ? "Bot activo" : "Bot pausado"}
              </span>

              <Button
                variant="outline"
                size="xs"
                className="h-6 text-xs px-2 bg-[#013765] text-white rounded-xl"
                onClick={handleToggleBot}
                disabled={togglingBot}
              >
                {togglingBot
                  ? "Guardando..."
                  : botEnabled
                  ? "Pausar bot"
                  : "Reanudar bot"}
              </Button>
            </div>
          </div>
        </div>

        <Button variant="ghost" size="icon">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </div>

      {/* Área de mensajes */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center">
            Cargando mensajes...
          </p>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => {
              const isSticker =
                message.message_type === "image" && message.body === "[Sticker]"

              const isVisualMedia =
                (message.message_type === "image" && !isSticker) ||
                message.message_type === "video"

              return (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-3",
                    message.sender === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  {message.sender !== "user" && (
                    <Avatar className="h-8 w-8 mt-1 bg-gray-300 flex items-center justify-center">
                      <User />
                    </Avatar>
                  )}

                  <div
                    className={cn(
                      isVisualMedia
                        ? "inline-flex flex-col items-end rounded-lg p-1"
                        : "max-w-[70%] rounded-lg px-4 py-2",
                      message.sender === "user"
                        ? "text-white bg-[#013765]"
                        : "text-foreground bg-gray-300",
                    )}
                  >
                    {renderMessageContent(message)}

                    <p
                      className={cn(
                        "text-xs mt-1",
                        message.sender === "user"
                          ? "text-white/70"
                          : "text-muted-foreground",
                      )}
                    >
                      {formatChatTimestamp(message.timestamp)}
                    </p>
                  </div>

                  {message.sender === "user" && (
                    <Avatar className="h-8 w-8 mt-1 bg-[#013765] text-white">
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                        TU
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              )
            })}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-300">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe un mensaje..."
              className="pr-20 min-h-[44px] resize-none bg-muted/50 border-gray-300"
            />
          </div>

          <Button
            disabled={!newMessage.trim() || sending}
            onClick={handleSendMessage}
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
    </div>
  )
}
