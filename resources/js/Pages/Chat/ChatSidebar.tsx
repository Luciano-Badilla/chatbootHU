"use client"

import { useState, useMemo, useEffect } from "react"
import { Bot, Headset, Search, User } from "lucide-react"
import { Input } from "shadcn/components/ui/input"
import { Avatar } from "shadcn/components/ui/avatar"
import { Badge } from "shadcn/components/ui/badge"
import { cn } from "shadcn/lib/utils"
import type { Chat } from "./ChatPanel"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

interface ChatSidebarProps {
  chats: Chat[]
  selectedChatId: string
  onSelectChat: (chatId: string) => void
}

export default function ChatSidebar({ chats, selectedChatId, onSelectChat }: ChatSidebarProps) {
  const [search, setSearch] = useState("")
  const [now, setNow] = useState(Date.now())

  const normalizePhone = (value?: string | null) => String(value ?? "").replace(/\D/g, "")

  const formatLastMessagePreview = (raw?: string | null) => {
    const message = String(raw ?? "").trim()
    if (!message) return ""

    const lower = message.toLowerCase()
    const withoutTags = message.replace(/\[[^\]]+\]\s*/g, "").trim()

    if (lower.includes("[sticker]")) {
      return withoutTags ? `🏷️ Sticker: ${withoutTags}` : "🏷️ Sticker"
    }
    if (lower.includes("[audio]")) {
      return withoutTags ? `🎵 Audio: ${withoutTags}` : "🎵 Audio"
    }
    if (lower.includes("[video]")) {
      return withoutTags ? `🎬 Video: ${withoutTags}` : "🎬 Video"
    }
    if (lower.includes("[imagen]") || lower.includes("[image]")) {
      return withoutTags ? `🖼️ Imagen: ${withoutTags}` : "🖼️ Imagen"
    }
    if (lower.includes("[documento]") || lower.includes("[document]")) {
      return withoutTags ? `📄 Documento: ${withoutTags}` : "📄 Documento"
    }

    return message
  }

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 30_000)

    return () => clearInterval(interval)
  }, [])

  // 🔹 Filtrar + ordenar: primero no leídos, luego por timestamp desc
  const visibleChats = useMemo(() => {
    const query = search.toLowerCase()
    const phoneQuery = normalizePhone(search)

    const filtered = chats.filter(
      (chat) =>
        chat.name.toLowerCase().includes(query) ||
        formatLastMessagePreview(chat.lastMessage).toLowerCase().includes(query) ||
        (phoneQuery.length > 0 && normalizePhone(chat.number).includes(phoneQuery)),
    )

    return [...filtered].sort((a, b) => {
      const aHasUnread = (a.unread ?? 0) > 0
      const bHasUnread = (b.unread ?? 0) > 0

      // primero los que tienen no leídos
      if (aHasUnread !== bHasUnread) {
        return aHasUnread ? -1 : 1
      }

      // si ambos están en el mismo estado de unread, ordenar por timestamp (más nuevo primero)
      if (a.timestamp && b.timestamp) {
        const dateA = new Date(a.timestamp).getTime()
        const dateB = new Date(b.timestamp).getTime()
        return dateB - dateA
      }

      return 0
    })
  }, [search, chats])

  function formatTimestamp(timestamp?: string) {
    if (!timestamp) return ""
    try {
      const isoString = timestamp.replace(" ", "T")
      const date = new Date(isoString)
      if (isNaN(date.getTime())) return ""
      return formatDistanceToNow(date, { addSuffix: true, locale: es })
    } catch {
      return ""
    }
  }

  const handleSelectChat = async (chatId: string | number) => {
    const normalizedChatId = String(chatId)
    if (normalizedChatId === String(selectedChatId)) return
    onSelectChat(normalizedChatId)

    window.dispatchEvent(new CustomEvent("chat:read", { detail: { chatId: normalizedChatId } }))

    try {
      await fetch(`${import.meta.env.VITE_APP_URL}/api/message/markAsRead/${normalizedChatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    } catch (err) {
      console.error("Error marcando como leído:", err)
    }
  }


  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-gray-300">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-foreground">Mensajes</h1>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar... nombre/numero"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-muted/50 border-gray-300 bg-gray-100 text-black"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-2">
          {visibleChats.length > 0 ? (
            visibleChats.map((chat, index) => {
              const isSelected = String(selectedChatId) === String(chat.id)
              const botActive = Boolean(chat.bot_enabled)
              const operatorActive = Boolean(chat.operator_id)
              const operatorLabel = operatorActive
                ? `#${chat.operator_id} ${chat.operator_name ?? "Operador"}`
                : ""
              return (
                <div key={chat.id}>
                  <div
                    onClick={() => handleSelectChat(chat.id)}
                    aria-selected={isSelected}
                    className={cn(
                      "relative flex items-center gap-3 p-3 rounded-lg cursor-pointer border border-transparent transition-colors hover:bg-muted/50",
                      isSelected && "bg-[#dce8f5] border-[#2b5f90]/35",
                    )}
                  >
                    {isSelected && (
                      <div className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[#013765]" />
                    )}
                    <Avatar className="h-12 w-12 flex items-center justify-center bg-[#2b5f90] text-white">
                      <User />
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className={cn("font-medium truncate", isSelected ? "text-[#013765]" : "text-foreground")}>
                          {chat.name}
                        </h3>
                        <div className="flex items-center gap-2 ml-2 shrink-0">
                          <span className={cn("text-xs", isSelected ? "text-[#013765]/80" : "text-muted-foreground")}>
                            {formatTimestamp(chat.timestamp)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <p className={cn("text-sm truncate", isSelected ? "text-[#013765]/85" : "text-muted-foreground")}>
                          {formatLastMessagePreview(chat.lastMessage)}
                        </p>

                        {chat.unread > 0 && (
                          <Badge
                            variant="default"
                            className="ml-2 h-5 min-w-5 text-xs bg-[#013765] text-white"
                          >
                            {chat.unread}
                          </Badge>
                        )}
                      </div>

                      {(operatorActive || botActive) && (
                        <div
                          className={cn(
                            "mt-1 flex items-center gap-2 min-w-0",
                            operatorActive ? "justify-between" : "justify-end",
                          )}
                        >
                          {operatorActive && (
                            <div className="min-w-0">
                              <span
                                title={`Operador atendiendo: ${operatorLabel}`}
                                className={cn(
                                  "inline-flex max-w-[220px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] min-w-0",
                                  isSelected ? "bg-[#013765]/15 text-[#013765]" : "bg-gray-200 text-gray-700",
                                )}
                              >
                                <Headset className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{operatorLabel}</span>
                              </span>
                            </div>
                          )}
                          {botActive && (
                            <span
                              title="Bot activo"
                              className={cn(
                                "inline-flex h-5 w-5 items-center justify-center rounded-full shrink-0",
                                isSelected ? "bg-[#2b5f90]/15 text-[#2b5f90]" : "bg-blue-100 text-blue-700",
                              )}
                            >
                              <Bot className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {index < visibleChats.length - 1 && (
                    <div className="mx-3 my-1 h-px bg-gray-300/70" />
                  )}
                </div>
              )
            })
          ) : (
            <p className="text-center text-sm text-muted-foreground mt-4">
              No se encontraron conversaciones
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
