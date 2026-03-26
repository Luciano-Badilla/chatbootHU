"use client"
// Componente principal del panel de chat.
import { useState, useEffect, useRef } from "react"
import ChatSidebar from "./ChatSidebar"
import ChatMain from "./ChatMain"
import ChatInfo from "./ChatInfo"
import mqtt from "mqtt"
import { usePage } from "@inertiajs/react"
import { AlertTriangle, Eye } from "lucide-react"

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
  const mqttClientRef = useRef<any>(null)
  const lastOperatorStateRef = useRef<Record<string, boolean>>({})
  const [operatorConflict, setOperatorConflict] = useState<{
    chatId: string
    operatorId?: number | null
    operatorName?: string | null
  } | null>(null)


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
      if (!currentChatId) return
      const payload = {
        chat_id: Number(currentChatId),
        active: true,
        operator_id: authUser?.id ?? null,
        operator_name: authUser?.name ?? null,
        source: "frontend",
        ts: new Date().toISOString(),
      }
      client.publish(`operator/chat/${currentChatId}`, JSON.stringify(payload), { retain: true })
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

  const updateOperatorPresence = async (chatId: string, active: boolean, keepalive = false) => {
    if (!chatId) return
    const normalizedChatId = String(chatId)
    if (lastOperatorStateRef.current[normalizedChatId] === active) return
    lastOperatorStateRef.current[normalizedChatId] = active

    // 1) reflejo inmediato local
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

    // 2) emito MQTT inmediato para otras PCs
    const client = mqttClientRef.current
    if (client?.connected) {
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

    // 3) persisto en DB (source of truth)
    try {
      const res = await fetch(`${import.meta.env.VITE_APP_URL}/api/chats/${normalizedChatId}/operator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive,
        body: JSON.stringify({
          active,
          operator_id: authUser?.id ?? null,
          operator_name: authUser?.name ?? null,
        }),
      })

      if (!res.ok) {
        if (res.status === 409) {
          const conflictData = await res.json()
          setChats((prevChats) =>
            prevChats.map((c) =>
              String(c.id) === normalizedChatId
                ? {
                  ...c,
                  operator_id: conflictData.operator_id ?? null,
                  operator_name: conflictData.operator_name ?? null,
                }
                : c,
            ),
          )
          setOperatorConflict({
            chatId: normalizedChatId,
            operatorId: conflictData.operator_id ?? null,
            operatorName: conflictData.operator_name ?? null,
          })
          lastOperatorStateRef.current[normalizedChatId] = false
          return
        }
        console.error("Error guardando operador del chat:", await res.text())
      }
    } catch (error) {
      console.error("Error actualizando operador del chat:", error)
    }
  }

  useEffect(() => {
    const previousChatId = previousSelectedChatIdRef.current
    const currentChatId = String(selectedChatId || "")

    if (previousChatId && previousChatId !== currentChatId) {
      updateOperatorPresence(previousChatId, false)
    }
    if (currentChatId && previousChatId !== currentChatId) {
      const currentChat = chats.find((c) => String(c.id) === currentChatId)
      const myOperatorId = Number(authUser?.id ?? 0)
      const occupiedByAnotherOperator =
        Boolean(currentChat?.operator_id) &&
        Number(currentChat?.operator_id) !== myOperatorId

      if (occupiedByAnotherOperator) {
        setOperatorConflict({
          chatId: currentChatId,
          operatorId: currentChat?.operator_id ?? null,
          operatorName: currentChat?.operator_name ?? null,
        })
        lastOperatorStateRef.current[currentChatId] = false
        previousSelectedChatIdRef.current = currentChatId
        return
      }

      setOperatorConflict(null)
      updateOperatorPresence(currentChatId, true)
    }
    if (currentChatId && previousChatId === currentChatId) {
      const currentChat = chats.find((c) => String(c.id) === currentChatId)
      const myOperatorId = Number(authUser?.id ?? 0)
      const occupiedByAnotherOperator =
        Boolean(currentChat?.operator_id) &&
        Number(currentChat?.operator_id) !== myOperatorId
      const chatIsFree = !currentChat?.operator_id

      if (!occupiedByAnotherOperator && chatIsFree) {
        setOperatorConflict(null)
        updateOperatorPresence(currentChatId, true)
      }
    }

    previousSelectedChatIdRef.current = currentChatId
  }, [selectedChatId, chats, authUser?.id])

  useEffect(() => {
    return () => {
      const lastChatId = previousSelectedChatIdRef.current
      if (!lastChatId) return
      updateOperatorPresence(lastChatId, false, true)
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
        <ChatMain
          chat={selectedChat}
          readOnly={Boolean(
            selectedChat?.operator_id &&
            Number(selectedChat.operator_id) !== Number(authUser?.id ?? 0),
          )}
          readOnlyOperatorName={selectedChat?.operator_name ?? null}
        />
      </div>


      {/* Panel derecho */}
      <div className="w-80 border-l border-gray-300 bg-gray-100 flex flex-col min-h-0">
        <ChatInfo chat={selectedChat} />
      </div>

      {operatorConflict && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">Chat en uso por otro operador</h3>
                <p className="mt-0.5 text-sm text-slate-600">Acceso en modo solo lectura.</p>
              </div>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm text-slate-700">
              <p>
                Este chat ya esta siendo atendido por{" "}
                <span className="font-semibold text-slate-900">
                  {operatorConflict.operatorName ?? `Operador #${operatorConflict.operatorId ?? "?"}`}
                </span>
                .
              </p>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                <Eye className="h-3.5 w-3.5" />
                Solo lectura habilitada
              </div>
            </div>
            <div className="flex justify-end border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setOperatorConflict(null)}
                className="inline-flex items-center rounded-lg bg-[#013765] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#012e54]"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


