"use client"
// Componente principal del panel de chat.
import { useState, useEffect } from "react"
import ChatSidebar from "./ChatSidebar"
import ChatMain from "./ChatMain"
import ChatInfo from "./ChatInfo"
import mqtt from "mqtt"
import { formatDistanceToNow, parseISO } from "date-fns" // (no se usan acá, pero sí en otros componentes)

export type Chat = {
  id: number | string
  name: string
  number: string
  lastMessage: string
  timestamp: string
  unread: number
  online: boolean
  avatar?: string | null
  bot_enabled: boolean

  bot_state?: {
    vars?: Record<string, any>
    pending_input?: any
    handoff?: any
    [k: string]: any
  }
}

export type ChatVariable = {
  name: string
  type: "string" | "number" | "boolean" | "object" | "array" | "null"
  value: any
  description?: string
}

export type Message = {
  id: number | string
  sender: "user" | "contact"
  sender_subtype?: "operator" | "bot" | "contact" | null
  bot_node_type?: string | null
  interactive_options?: Array<{
    id: string
    label: string
    description?: string
    kind?: "button" | "list" | string
  }> | null
  body: string | null
  timestamp: string
  message_type?: "text" | "image" | "video" | "audio" | "document" | "template"
  media_url?: string | null
  media_name?: string | null
}

interface ChatPanelProps {
  // Lista inicial de chats enviada desde Laravel vía Inertia.
  chats: Chat[]
}

// Componente principal del panel de chat.
// Se encarga de:
// - Mantener el estado global de los chats.
// - Conectarse a MQTT para recibir mensajes en tiempo real.
// - Coordinar Sidebar, Main y Info.
export function ChatPanel({ chats: initialChats }: ChatPanelProps) {
  // Estado local con la lista de chats (se inicializa con lo que viene del backend).
  const [chats, setChats] = useState<Chat[]>(initialChats)

  // ID del chat seleccionado actualmente en la UI.
  const [selectedChatId, setSelectedChatId] = useState<string>("")


  // Obtenemos el objeto del chat seleccionado a partir del estado.
  const selectedChat = chats.find((chat) => String(chat.id) === String(selectedChatId))

  // 🔹 NUEVO: marcar como leídos al abrir el chat
  useEffect(() => {
    if (!selectedChatId) return

    setChats((prevChats) =>
      prevChats.map((chat) =>
        String(chat.id) === String(selectedChatId)
          ? { ...chat, unread: 0 }
          : chat
      )
    )
  }, [selectedChatId])

  useEffect(() => {
    const mosquitto_host = (import.meta.env.VITE_MOSQUITTO_HOST);

    const client = mqtt.connect("ws://" + mosquitto_host + ":9001")

    client.on("connect", () => {
      client.subscribe("sidebar/chat")
    })

    client.on("message", (topic, message) => {
      try {
        const data = JSON.parse(message.toString())
        const chatId = String(data.chat_id)

        setChats((prevChats) => {
          const existingChat = prevChats.find((c) => String(c.id) === chatId)

          if (existingChat) {
            const isDuplicateUpdate =
              existingChat.lastMessage === data.lastMessage &&
              existingChat.timestamp === data.timestamp

            return prevChats.map((c) =>
              String(c.id) === chatId
                ? {
                  ...c,
                  lastMessage: data.lastMessage,
                  timestamp: data.timestamp,
                  unread:
                    // si está abierto, siempre 0
                    chatId === selectedChatId
                      ? 0
                      // si es un update duplicado, no sumamos
                      : isDuplicateUpdate
                        ? c.unread
                        : (c.unread || 0) + 1,
                }
                : c,
            )
          } else {
            // Chat nuevo
            return [
              {
                id: chatId,
                name: data.name,
                lastMessage: data.lastMessage,
                timestamp: data.timestamp,
                unread: 1,
                online: false,
                avatar: null,
              },
              ...prevChats,
            ]
          }
        })
      } catch (error) {
        console.error("Error al procesar mensaje MQTT:", error)
      }
    })

    return () => client.end()
  }, [selectedChatId])

  return (
    // Antes: <div className="flex flex-1">
    <div className="flex h-[calc(100vh-64px)] min-h-0">
      {/* Sidebar de chats */}
      <div className="w-80 border-r border-gray-300 bg-gray-100 flex flex-col min-h-0">
        <ChatSidebar
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={setSelectedChatId}
        />
      </div>

      {/* Panel principal */}
      <div className="flex-1 flex flex-col min-h-0">
        <ChatMain chat={selectedChat} />
      </div>


      {/* Panel derecho */}
      <div className="w-80 border-l border-gray-300 bg-gray-100 flex flex-col min-h-0">
        <ChatInfo chat={selectedChat} />
      </div>
    </div>
  )
}
