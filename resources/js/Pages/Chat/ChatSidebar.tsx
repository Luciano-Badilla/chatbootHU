"use client"

import { useState, useMemo, useEffect } from "react"
import { Search, User } from "lucide-react"
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

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 30_000)

    return () => clearInterval(interval)
  }, [])

  // 🔹 Filtrar + ordenar: primero no leídos, luego por timestamp desc
  const visibleChats = useMemo(() => {
    const query = search.toLowerCase()

    const filtered = chats.filter(
      (chat) =>
        chat.name.toLowerCase().includes(query) ||
        chat.lastMessage.toLowerCase().includes(query),
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

  const handleSelectChat = async (chatId: string) => {
    onSelectChat(chatId)

    try {
      await fetch(`${import.meta.env.VITE_APP_URL}/api/message/markAsRead/${chatId}`, {
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
            placeholder="Buscar conversaciones..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-muted/50 border-gray-300 bg-gray-100 text-black"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-2">
          {visibleChats.length > 0 ? (
            visibleChats.map((chat) => (
              <div
                key={chat.id}
                onClick={() => handleSelectChat(chat.id)}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-muted/50",
                  selectedChatId === chat.id && "bg-muted",
                )}
              >
                <Avatar className="h-12 w-12 flex items-center justify-center bg-[#013765] text-white">
                  <User />
                </Avatar>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-medium text-foreground truncate">
                      {chat.name}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(chat.timestamp)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground truncate">
                      {chat.lastMessage}
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
                </div>
              </div>
            ))
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
