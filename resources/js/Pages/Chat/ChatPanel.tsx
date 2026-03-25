"use client"
// Componente principal del panel de chat.
import { useState, useEffect, useRef } from "react"
import ChatSidebar from "./ChatSidebar"
import ChatMain from "./ChatMain"
import ChatInfo from "./ChatInfo"
import mqtt from "mqtt"
import { usePage } from "@inertiajs/react"

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
  operator_id?: number | null
  operator_name?: string | null

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
  // Lista inicial de chats enviada desde Laravel vÃ­a Inertia.
  chats: Chat[]
}

// Componente principal del panel de chat.
// Se encarga de:
// - Mantener el estado global de los chats.
// - Conectarse a MQTT para recibir mensajes en tiempo real.
// - Coordinar Sidebar, Main y Info.
export function ChatPanel({ chats: initialChats }: ChatPanelProps) {
  const { props } = usePage() as any
  const authUser = props?.auth?.user as { id?: number; name?: string } | undefined

  // Estado local con la lista de chats (se inicializa con lo que viene del backend).
  const [chats, setChats] = useState<Chat[]>(initialChats)

  // ID del chat seleccionado actualmente en la UI.
  const [selectedChatId, setSelectedChatId] = useState<string>("")
  const previousSelectedChatIdRef = useRef<string>("")
  const selectedChatIdRef = useRef<string>("")
  const operatorPresenceSentRef = useRef<Record<string, boolean>>({})
  const mqttClientRef = useRef<any>(null)


  // Obtenemos el objeto del chat seleccionado a partir del estado.
  const selectedChat = chats.find((chat) => String(chat.id) === String(selectedChatId))

  // ðŸ”¹ NUEVO: marcar como leÃ­dos al abrir el chat
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
    selectedChatIdRef.current = String(selectedChatId || "")
  }, [selectedChatId])

  useEffect(() => {
    const mosquitto_host = (import.meta.env.VITE_MOSQUITTO_HOST);
    const client = mqtt.connect("ws://" + mosquitto_host + ":9001", {
      clean: true,
      reconnectPeriod: 2000,
      clientId: `front_chatpanel_${Math.random().toString(16).slice(2)}`,
    })
    mqttClientRef.current = client

    client.on("connect", () => {
      client.subscribe("sidebar/chat")
      client.subscribe("status_bot/chat/+")
      client.subscribe("operator/chat/+")

      const currentChatId = selectedChatIdRef.current
      if (currentChatId) {
        const payload = {
          chat_id: Number(currentChatId),
          active: true,
          operator_id: authUser?.id ?? null,
          operator_name: authUser?.name ?? null,
          source: "frontend",
          ts: new Date().toISOString(),
        }
        operatorPresenceSentRef.current[currentChatId] = true
        client.publish(`operator/chat/${currentChatId}`, JSON.stringify(payload), { retain: true })
      }
    })

    client.on("message", (topic, message) => {
      try {
        const data = JSON.parse(message.toString())

        if (topic.startsWith("status_bot/chat/")) {
          const topicChatId = topic.split("/").pop()
          const chatId = String(data.chat_id ?? topicChatId ?? "")
          if (!chatId) return

          const botEnabled = String(data.status ?? "").toLowerCase() === "enabled"
          setChats((prevChats) =>
            prevChats.map((c) =>
              String(c.id) === chatId
                ? { ...c, bot_enabled: botEnabled }
                : c,
            ),
          )
          return
        }

        if (topic.startsWith("operator/chat/")) {
          const topicChatId = topic.split("/").pop()
          const chatId = String(data.chat_id ?? topicChatId ?? "")
          if (!chatId) return

          const active = Boolean(data.active)
          operatorPresenceSentRef.current[chatId] = active
          setChats((prevChats) =>
            prevChats.map((c) =>
              String(c.id) === chatId
                ? {
                  ...c,
                  operator_id: active ? (data.operator_id ?? null) : null,
                  operator_name: active ? (data.operator_name ?? null) : null,
                }
                : c,
            ),
          )
          return
        }

        if (topic !== "sidebar/chat") return

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
                    // si estÃ¡ abierto, siempre 0
                    chatId === selectedChatIdRef.current
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
                bot_enabled: typeof data.bot_enabled === "boolean" ? data.bot_enabled : true,
                operator_id: data.operator_id ?? null,
                operator_name: data.operator_name ?? null,
              },
              ...prevChats,
            ]
          }
        })
      } catch (error) {
        console.error("Error al procesar mensaje MQTT:", error)
      }
    })

    return () => {
      try {
        client.end(true)
      } finally {
        mqttClientRef.current = null
      }
    }
  }, [])

  const updateOperatorPresence = (chatId: string, active: boolean) => {
    if (!chatId) return
    const normalizedChatId = String(chatId)
    if (operatorPresenceSentRef.current[normalizedChatId] === active) return
    operatorPresenceSentRef.current[normalizedChatId] = active

    setChats((prevChats) =>
      prevChats.map((c) =>
        String(c.id) === normalizedChatId
          ? {
            ...c,
            operator_id: active ? (authUser?.id ?? null) : null,
            operator_name: active ? (authUser?.name ?? null) : null,
          }
          : c,
      ),
    )

    const client = mqttClientRef.current
    if (!client?.connected) return

    const payload = {
      chat_id: Number(normalizedChatId),
      active,
      operator_id: authUser?.id ?? null,
      operator_name: authUser?.name ?? null,
      source: "frontend",
      ts: new Date().toISOString(),
    }
    client.publish(`operator/chat/${normalizedChatId}`, JSON.stringify(payload), { retain: true })
  }

  useEffect(() => {
    const previousChatId = previousSelectedChatIdRef.current
    const currentChatId = String(selectedChatId || "")

    if (previousChatId && previousChatId !== currentChatId) {
      updateOperatorPresence(previousChatId, false)
    }
    if (currentChatId && previousChatId !== currentChatId) {
      updateOperatorPresence(currentChatId, true)
    }

    previousSelectedChatIdRef.current = currentChatId
  }, [selectedChatId])

  useEffect(() => {
    return () => {
      const lastChatId = previousSelectedChatIdRef.current
      if (!lastChatId) return
      updateOperatorPresence(lastChatId, false)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key !== "Escape") return
      if (!selectedChatId) return
      setSelectedChatId("")
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
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

