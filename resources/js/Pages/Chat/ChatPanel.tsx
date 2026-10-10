"use client"
// Componente principal del panel de chat.
import { useState, useEffect, useRef, useCallback } from "react"
import ChatSidebar from "./ChatSidebar"
import ChatMain from "./ChatMain"
import ChatInfo from "./ChatInfo"
import mqtt from "mqtt"
import { mqttWebSocketUrl } from "../../lib/mqtt"
import { usePage } from "@inertiajs/react"
import { AlertTriangle, Eye, X } from "lucide-react"
import { toast } from "sonner"
import StartupCurtain from "../../Components/StartupCurtain"

export type Chat = {
  id: number | string
  name: string
  number: string
  channel?: "whatsapp" | "webchat" | string
  lastMessage: string
  timestamp: string
  sidebar_timestamp?: string | null
  unread: number
  online: boolean
  avatar?: string | null
  bot_enabled: boolean
  bot_name?: string | null
  operator_id?: number | null
  operator_name?: string | null
  last_operator_id?: number | null
  last_operator_name?: string | null
  status?: "open" | "closed" | string
  attention_status?: "bot" | "pending_assignment" | "assigned" | "archived" | string
  assigned_at?: string | null
  closed_at?: string | null
  closed_by?: "bot" | "operator" | string | null
  bot_flow_id?: number | null
  bot_flow_name?: string | null
  bot_node_id?: number | null
  bot_node_name?: string | null
  bot_step?: string | null

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
  operator_name?: string | null
  bot_node_type?: string | null
  interactive_options?: Array<{
    id: string
    label: string
    description?: string
    kind?: "button" | "list" | string
  }> | null
  body: string | null
  timestamp: string
  status?: "sent" | "delivered" | "read" | "failed" | "received" | string | null
  message_type?: "text" | "image" | "video" | "audio" | "document" | "template" | "contacts" | "location"
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
  const { props } = usePage() as any
  const authUser = props?.auth?.user as { id?: number; name?: string; role_name?: string; operator_availability?: "available" | "paused" | "unavailable" } | undefined

  // Estado local con la lista de chats (se inicializa con lo que viene del backend).
  const [chats, setChats] = useState<Chat[]>(initialChats)
  const [dbHydrated, setDbHydrated] = useState(false)
  const [panelMqttConnected, setPanelMqttConnected] = useState(false)
  const [showStartupCurtain, setShowStartupCurtain] = useState(true)
  const [startupCurtainLeaving, setStartupCurtainLeaving] = useState(false)

  // ID del chat seleccionado actualmente en la UI.
  const [selectedChatId, setSelectedChatId] = useState<string>(() => {
    if (typeof window === "undefined") return ""
    return new URLSearchParams(window.location.search).get("chat") || ""
  })
  const previousSelectedChatIdRef = useRef<string>("")
  const selectedChatIdRef = useRef<string>("")
  const mqttClientRef = useRef<any>(null)
  const syncChatsInFlightRef = useRef(false)
  const startupCurtainResolvedRef = useRef(false)
  const startupCurtainStartedAtRef = useRef(Date.now())
  const lastOperatorStateRef = useRef<Record<string, boolean>>({})
  const operatorRequestInFlightRef = useRef<Record<string, boolean>>({})
  const pendingOperatorStateRef = useRef<Record<string, boolean | undefined>>({})
  const didRestoreSelectionFromDbRef = useRef(false)
  const waitingForChatReleaseRef = useRef<Record<string, boolean>>({})
  const [viewerReadOnlyChatId, setViewerReadOnlyChatId] = useState<string | null>(null)
  const [operatorConflict, setOperatorConflict] = useState<{
    chatId: string
    operatorId?: number | null
    operatorName?: string | null
  } | null>(null)
  const [finishAttentionPrompt, setFinishAttentionPrompt] = useState<{
    chatId: string
    chatName?: string | null
    nextChatId: string
  } | null>(null)
  const [finishingAttention, setFinishingAttention] = useState(false)
  const [takingChat, setTakingChat] = useState(false)

  const dismissStartupCurtain = useCallback(() => {
    if (startupCurtainResolvedRef.current) return
    startupCurtainResolvedRef.current = true

    const elapsed = Date.now() - startupCurtainStartedAtRef.current
    setShowStartupCurtain(true)
    setStartupCurtainLeaving(false)
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        setStartupCurtainLeaving(true)
        window.setTimeout(() => setShowStartupCurtain(false), 850)
      })
    }, Math.max(0, 600 - elapsed))
  }, [])

  const showConnectionCurtain = useCallback(() => {
    startupCurtainResolvedRef.current = false
    startupCurtainStartedAtRef.current = Date.now()
    setStartupCurtainLeaving(false)
    setShowStartupCurtain(true)
  }, [])

  useEffect(() => {
    if (!showStartupCurtain) return
    const fallback = window.setTimeout(dismissStartupCurtain, 3000)
    return () => window.clearTimeout(fallback)
  }, [dismissStartupCurtain, showStartupCurtain])

  useEffect(() => {
    const reconnectWhenVisible = () => {
      if (document.visibilityState === "visible" && !panelMqttConnected) {
        showConnectionCurtain()
      }
    }

    document.addEventListener("visibilitychange", reconnectWhenVisible)
    return () => document.removeEventListener("visibilitychange", reconnectWhenVisible)
  }, [panelMqttConnected, showConnectionCurtain])


  // Obtenemos el objeto del chat seleccionado a partir del estado.
  const selectedChat = chats.find((chat) => String(chat.id) === String(selectedChatId))
  const readOnlyByOperator = Boolean(
    selectedChat?.operator_id &&
    Number(selectedChat.operator_id) !== Number(authUser?.id ?? 0),
  )
  const readOnlyByViewerLock = Boolean(
    viewerReadOnlyChatId &&
    String(viewerReadOnlyChatId) === String(selectedChat?.id ?? ""),
  )
  const readOnlyByBot = Boolean(selectedChat?.bot_enabled)
  const isReadOnly = readOnlyByOperator || readOnlyByViewerLock || readOnlyByBot
  const readOnlyReason: "operator" | "bot" | null = readOnlyByBot ? "bot" : (isReadOnly ? "operator" : null)
  const canToggleBot = Boolean(
    props?.auth?.permissions?.can_toggle_bot,
  )
  const canFinishAttention = Boolean(
    selectedChat?.status === "open" &&
    selectedChat?.attention_status === "assigned" &&
    Number(selectedChat?.operator_id ?? 0) === Number(authUser?.id ?? 0),
  )
  const canTakeChat = Boolean(
    authUser?.id &&
    selectedChat?.status === "open" &&
    !selectedChat?.operator_id &&
    selectedChat?.attention_status !== "archived" &&
    props?.auth?.permissions?.can_assign_chats,
  )

  useEffect(() => {
    if (!["operator", "admin"].includes(authUser?.role_name ?? "")) return

    const currentChatId = selectedChat?.attention_status === "assigned" && Number(selectedChat?.operator_id ?? 0) === Number(authUser.id ?? 0)
      ? selectedChat.id
      : null
    const notifyCurrentChat = () => {
      fetch(`${import.meta.env.VITE_APP_URL}/api/operators/me/current-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: currentChatId }),
      }).catch(() => undefined)
    }

    notifyCurrentChat()
    const heartbeat = window.setInterval(notifyCurrentChat, 30000)
    return () => window.clearInterval(heartbeat)
  }, [authUser?.id, authUser?.role_name, selectedChat?.id, selectedChat?.operator_id, selectedChat?.attention_status])

  const requestChatSelection = (nextChatId: string) => {
    const currentChatId = String(selectedChatId || "")
    const normalizedNextChatId = String(nextChatId || "")

    if (currentChatId === normalizedNextChatId) return

    setSelectedChatId(normalizedNextChatId)
  }

  const continueAfterFinishPrompt = (nextChatId: string) => {
    setFinishAttentionPrompt(null)
    setSelectedChatId(nextChatId)
  }

  const leaveChatWithoutFinishing = async () => {
    if (!finishAttentionPrompt) return
    const { chatId, nextChatId } = finishAttentionPrompt
    setFinishingAttention(true)
    try {
      await updateOperatorPresence(chatId, false)
      continueAfterFinishPrompt(nextChatId)
    } finally {
      setFinishingAttention(false)
    }
  }

  const finishAttentionAndReactivateBot = async () => {
    if (!finishAttentionPrompt) return
    const { chatId, nextChatId } = finishAttentionPrompt
    setFinishingAttention(true)

    try {
      const res = await fetch(`${import.meta.env.VITE_APP_URL}/api/chats/${chatId}/finish-operator-attention`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      if (!res.ok) {
        console.error("Error finalizando atencion del operador:", await res.text())
        return
      }

      lastOperatorStateRef.current[chatId] = false
      setChats((prevChats) =>
        prevChats.map((chat) =>
          String(chat.id) === chatId
            ? {
              ...chat,
              bot_enabled: true,
              operator_id: null,
              operator_name: null,
            }
            : chat,
        ),
      )
      continueAfterFinishPrompt(nextChatId)
    } catch (error) {
      console.error("Error finalizando atencion del operador:", error)
    } finally {
      setFinishingAttention(false)
    }
  }

  const finishSelectedAttention = async () => {
    if (!selectedChatId || !canFinishAttention) return
    setFinishingAttention(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_APP_URL}/api/chats/${selectedChatId}/finish-operator-attention`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      if (!res.ok) {
        console.error("Error finalizando atencion del operador:", await res.text())
        return
      }
      setChats((current) => current.map((chat) => String(chat.id) === String(selectedChatId)
        ? { ...chat, status: "closed", attention_status: "archived", bot_enabled: true, operator_id: null, operator_name: null, closed_by: "operator", closed_at: new Date().toISOString() }
        : chat,
      ))
      setSelectedChatId("")
    } finally {
      setFinishingAttention(false)
    }
  }

  const takeSelectedChat = async () => {
    if (!selectedChatId || !authUser?.id || takingChat) return
    setTakingChat(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_APP_URL}/api/chats/${selectedChatId}/operator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.message || "No se pudo tomar el chat.")
      setChats((current) => current.map((chat) => String(chat.id) === String(selectedChatId)
        ? { ...chat, operator_id: payload.operator_id ?? authUser.id, operator_name: payload.operator_name ?? authUser.name ?? null, attention_status: "assigned", status: "open", bot_enabled: false, assigned_at: new Date().toISOString() }
        : chat,
      ))
    } catch (error) {
      console.error("Error tomando chat:", error)
    } finally {
      setTakingChat(false)
    }
  }

  // NUEVO: marcar como leídos al abrir el chat
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

  // Sincroniza estado local con DB al cargar y después de reconectar MQTT.
  const syncChatsFromDb = useCallback(async () => {
    if (syncChatsInFlightRef.current) return
    syncChatsInFlightRef.current = true

    try {
      const res = await fetch(`${import.meta.env.VITE_APP_URL}/api/chats/snapshot`)
      if (!res.ok) {
        console.error("Error cargando snapshot de chats:", await res.text())
        return
      }

      const payload = await res.json()
      const rows = Array.isArray(payload?.data) ? payload.data : []
      const byChatId = new Map<string, any>(
        rows.map((row: any) => [String(row.chat_id), row]),
      )

      setChats((prevChats) => {
          const currentIds = new Set(prevChats.map((chat) => String(chat.id)))
          const merged = prevChats.map((chat) => {
            const row = byChatId.get(String(chat.id))
            if (!row) return chat
            return {
              ...chat,
              name: row.name ?? chat.name,
              number: row.number ?? chat.number,
              channel: row.channel ?? chat.channel,
              lastMessage: row.lastMessage ?? chat.lastMessage,
              timestamp: row.timestamp ?? chat.timestamp,
              avatar: row.avatar ?? chat.avatar,
              operator_id: row.operator_id ?? null,
              operator_name: row.operator_name ?? null,
              last_operator_id: row.last_operator_id ?? null,
              last_operator_name: row.last_operator_name ?? null,
              bot_enabled: typeof row.bot_enabled === "boolean" ? row.bot_enabled : chat.bot_enabled,
              bot_name: row.bot_name ?? chat.bot_name,
              status: row.status ?? chat.status,
              attention_status: row.attention_status ?? chat.attention_status,
              assigned_at: row.assigned_at ?? null,
              closed_at: row.closed_at ?? null,
              closed_by: row.closed_by ?? null,
              bot_flow_id: row.bot_flow_id ?? null,
              bot_flow_name: row.bot_flow_name ?? null,
              bot_node_id: row.bot_node_id ?? null,
              bot_node_name: row.bot_node_name ?? null,
              bot_step: row.bot_step ?? null,
              bot_state: row.bot_state ?? {},
            }
          })

          const missing = rows
            .filter((row: any) => !currentIds.has(String(row.chat_id)))
            .map((row: any) => ({
              id: row.chat_id,
              name: row.name ?? "Sin nombre",
              number: row.number ?? "",
              channel: row.channel ?? "whatsapp",
              lastMessage: row.lastMessage ?? "",
              timestamp: row.timestamp ?? new Date().toISOString(),
              unread: 0,
              online: false,
              avatar: row.avatar ?? null,
              bot_enabled: typeof row.bot_enabled === "boolean" ? row.bot_enabled : true,
              bot_name: row.bot_name ?? "Asistente virtual",
              operator_id: row.operator_id ?? null,
              operator_name: row.operator_name ?? null,
              last_operator_id: row.last_operator_id ?? null,
              last_operator_name: row.last_operator_name ?? null,
              status: row.status ?? "open",
              attention_status: row.attention_status ?? "bot",
              assigned_at: row.assigned_at ?? null,
              closed_at: row.closed_at ?? null,
              closed_by: row.closed_by ?? null,
              bot_flow_id: row.bot_flow_id ?? null,
              bot_flow_name: row.bot_flow_name ?? null,
              bot_node_id: row.bot_node_id ?? null,
              bot_node_name: row.bot_node_name ?? null,
              bot_step: row.bot_step ?? null,
              bot_state: row.bot_state ?? {},
            }))

          return [...missing, ...merged]
      })
    } catch (error) {
      console.error("Error de red cargando snapshot de chats:", error)
    } finally {
      syncChatsInFlightRef.current = false
      setDbHydrated(true)
    }
  }, [])

  useEffect(() => {
    syncChatsFromDb()
  }, [syncChatsFromDb])

  useEffect(() => {
    const interval = window.setInterval(() => {
      syncChatsFromDb()
    }, 3000)

    return () => window.clearInterval(interval)
  }, [syncChatsFromDb])

  // En F5/hard reload priorizamos el estado de DB (Inertia): abrir ultimo chat asignado al operador.
  useEffect(() => {
    if (!dbHydrated) return
    if (didRestoreSelectionFromDbRef.current) return
    didRestoreSelectionFromDbRef.current = true
    if (selectedChatId) return
    const myOperatorId = Number(authUser?.id ?? 0)
    if (!myOperatorId) return

    const assignedChats = chats.filter((c) => Number(c.operator_id ?? 0) === myOperatorId)
    if (assignedChats.length === 0) return

    const pickLatest = [...assignedChats].sort((a, b) => {
      const aTs = a.timestamp ? new Date(a.timestamp).getTime() : 0
      const bTs = b.timestamp ? new Date(b.timestamp).getTime() : 0
      return bTs - aTs
    })[0]

    if (pickLatest?.id !== undefined && pickLatest?.id !== null) {
      setSelectedChatId(String(pickLatest.id))
    }
  }, [dbHydrated, selectedChatId, chats, authUser?.id])

  useEffect(() => {
    const brokerUrl = mqttWebSocketUrl()
    if (!brokerUrl) {
      dismissStartupCurtain()
      return
    }
    const client = mqtt.connect(brokerUrl, {
      clean: true,
      reconnectPeriod: 2000,
      clientId: `front_chatpanel_${Math.random().toString(16).slice(2)}`,
    })
    mqttClientRef.current = client

    client.on("connect", () => {
      setPanelMqttConnected(true)
      startupCurtainResolvedRef.current = false
      dismissStartupCurtain()
      client.subscribe("sidebar/chat")
      client.subscribe("status_bot/chat/+")
      client.subscribe("operator/chat/+")
      syncChatsFromDb()
    })

    client.on("reconnect", () => {
      setPanelMqttConnected(false)
    })

    client.on("offline", () => {
      setPanelMqttConnected(false)
    })

    client.on("close", () => {
      setPanelMqttConnected(false)
    })

    client.on("error", () => {
      setPanelMqttConnected(false)
    })

    client.on("message", (topic, message, packet) => {
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
          // Ignora retained viejos para no pisar el snapshot real de DB al reconectar/F5.
          if (packet?.retain) return
          const topicChatId = topic.split("/").pop()
          const chatId = String(data.chat_id ?? topicChatId ?? "")
          if (!chatId) return

          const active = Boolean(data.active)
          setChats((prevChats) =>
            prevChats.map((c) =>
              String(c.id) === chatId
                ? (() => {
                  return {
                    ...c,
                    operator_id: active ? (data.operator_id ?? null) : null,
                    operator_name: active ? (data.operator_name ?? null) : null,
                    status: data.status ?? c.status,
                    attention_status: data.attention_status ?? c.attention_status,
                    bot_enabled: typeof data.bot_enabled === "boolean" ? data.bot_enabled : c.bot_enabled,
                    assigned_at: Object.prototype.hasOwnProperty.call(data, "assigned_at") ? data.assigned_at : c.assigned_at,
                    closed_at: Object.prototype.hasOwnProperty.call(data, "closed_at") ? data.closed_at : c.closed_at,
                    closed_by: Object.prototype.hasOwnProperty.call(data, "closed_by") ? data.closed_by : c.closed_by,
                    bot_flow_id: data.bot_flow_id ?? c.bot_flow_id,
                    bot_node_id: data.bot_node_id ?? c.bot_node_id,
                    bot_node_name: data.bot_node_name ?? c.bot_node_name,
                    bot_step: Object.prototype.hasOwnProperty.call(data, "bot_step") ? data.bot_step : c.bot_step,
                    bot_state: data.bot_state ?? c.bot_state,
                  }
                })()
                : c,
            ),
          )

          const currentChatId = selectedChatIdRef.current
          const isCurrentChat = currentChatId && String(currentChatId) === chatId
          const chatWasWaiting = Boolean(waitingForChatReleaseRef.current[chatId])
          if (isCurrentChat && chatWasWaiting && !active) {
            waitingForChatReleaseRef.current[chatId] = false
            setOperatorConflict(null)
            setViewerReadOnlyChatId(chatId)
          }
          return
        }

        if (topic !== "sidebar/chat") return

        const chatId = String(data.chat_id)

        setChats((prevChats) => {
          const existingChat = prevChats.find((c) => String(c.id) === chatId)

          if (existingChat) {
            const isDuplicateUpdate =
              existingChat.lastMessage === data.lastMessage &&
              existingChat.sidebar_timestamp === (data.timestamp ?? null)

            return prevChats.map((c) =>
              String(c.id) === chatId
                ? {
                  ...c,
                  name: data.name ?? c.name,
                  number: data.number ?? c.number,
                  channel: data.channel ?? c.channel,
                  lastMessage: data.lastMessage,
                  // La fecha que trae el canal externo puede estar desfasada.
                  // Para la lista usamos el momento real en que llega al panel.
                  timestamp: new Date().toISOString(),
                  sidebar_timestamp: data.timestamp ?? null,
                  avatar: data.avatar ?? c.avatar ?? null,
                  bot_enabled: typeof data.bot_enabled === "boolean" ? data.bot_enabled : c.bot_enabled,
                  operator_id: data.operator_id ?? c.operator_id,
                  operator_name: data.operator_name ?? c.operator_name,
                  last_operator_id: data.last_operator_id ?? c.last_operator_id,
                  last_operator_name: data.last_operator_name ?? c.last_operator_name,
                  status: data.status ?? c.status,
                  attention_status: data.attention_status ?? c.attention_status,
                  assigned_at: Object.prototype.hasOwnProperty.call(data, "assigned_at") ? data.assigned_at : c.assigned_at,
                  closed_at: Object.prototype.hasOwnProperty.call(data, "closed_at") ? data.closed_at : c.closed_at,
                  closed_by: Object.prototype.hasOwnProperty.call(data, "closed_by") ? data.closed_by : c.closed_by,
                  bot_flow_id: data.bot_flow_id ?? c.bot_flow_id,
                  bot_node_id: data.bot_node_id ?? c.bot_node_id,
                  bot_step: Object.prototype.hasOwnProperty.call(data, "bot_step") ? data.bot_step : c.bot_step,
                  bot_state: data.bot_state ?? c.bot_state,
                  unread:
                    // si está abierto, siempre 0
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
                name: data.name ?? "Webchat",
                number: data.number ?? (data.channel === "webchat" ? "Webchat" : ""),
                channel: data.channel ?? "whatsapp",
                lastMessage: data.lastMessage,
                timestamp: new Date().toISOString(),
                sidebar_timestamp: data.timestamp ?? null,
                unread: 1,
                online: false,
                avatar: data.avatar ?? null,
                bot_enabled: typeof data.bot_enabled === "boolean" ? data.bot_enabled : true,
                operator_id: data.operator_id ?? null,
                operator_name: data.operator_name ?? null,
                last_operator_id: data.last_operator_id ?? null,
                last_operator_name: data.last_operator_name ?? null,
                status: data.status ?? "open",
                attention_status: data.attention_status ?? "bot",
                assigned_at: data.assigned_at ?? null,
                closed_at: data.closed_at ?? null,
                closed_by: data.closed_by ?? null,
                bot_flow_id: data.bot_flow_id ?? null,
                bot_flow_name: data.bot_flow_name ?? null,
                bot_node_id: data.bot_node_id ?? null,
                bot_node_name: data.bot_node_name ?? null,
                bot_step: data.bot_step ?? null,
                bot_state: data.bot_state ?? {},
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
        setPanelMqttConnected(false)
        mqttClientRef.current = null
      }
    }
  }, [dismissStartupCurtain, syncChatsFromDb])

  const updateOperatorPresence = async (chatId: string, active: boolean, keepalive = false) => {
    // La asignación ya la resuelve el backend al entrar al handoff. Abrir o salir no la modifica.
    return
    if (!chatId) return
    if (active && !authUser?.id) return
    const normalizedChatId = String(chatId)
    if (operatorRequestInFlightRef.current[normalizedChatId]) {
      pendingOperatorStateRef.current[normalizedChatId] = active
      return
    }
    if (lastOperatorStateRef.current[normalizedChatId] === active) return
    lastOperatorStateRef.current[normalizedChatId] = active
    operatorRequestInFlightRef.current[normalizedChatId] = true
    pendingOperatorStateRef.current[normalizedChatId] = undefined

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

    // 2) esquema hibrido: emite por websocket y persiste en DB
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
      client.publish(`operator/chat/${normalizedChatId}`, JSON.stringify(payload))
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
        lastOperatorStateRef.current[normalizedChatId] = !active
        console.error("Error guardando operador del chat:", await res.text())
        return
      }

      const okData = await res.json()
      setChats((prevChats) =>
        prevChats.map((c) =>
          String(c.id) === normalizedChatId
            ? {
              ...c,
              operator_id: okData.operator_id ?? null,
              operator_name: okData.operator_name ?? null,
            }
            : c,
        ),
      )
      lastOperatorStateRef.current[normalizedChatId] = Boolean(okData.active)
    } catch (error) {
      lastOperatorStateRef.current[normalizedChatId] = !active
      console.error("Error actualizando operador del chat:", error)
    } finally {
      operatorRequestInFlightRef.current[normalizedChatId] = false
      const pending = pendingOperatorStateRef.current[normalizedChatId]
      pendingOperatorStateRef.current[normalizedChatId] = undefined
      if (typeof pending === "boolean" && pending !== lastOperatorStateRef.current[normalizedChatId]) {
        updateOperatorPresence(normalizedChatId, pending)
      }
    }
  }

  useEffect(() => {
    const previousChatId = previousSelectedChatIdRef.current
    const currentChatId = String(selectedChatId || "")

    if (previousChatId && previousChatId !== currentChatId) {
      waitingForChatReleaseRef.current[previousChatId] = false
      if (viewerReadOnlyChatId === previousChatId) {
        setViewerReadOnlyChatId(null)
      }
      updateOperatorPresence(previousChatId, false)
    }
    if (currentChatId && previousChatId !== currentChatId) {
      const currentChat = chats.find((c) => String(c.id) === currentChatId)
      const myOperatorId = Number(authUser?.id ?? 0)
      const occupiedByAnotherOperator =
        Boolean(currentChat?.operator_id) &&
        Number(currentChat?.operator_id) !== myOperatorId

      if (occupiedByAnotherOperator) {
        waitingForChatReleaseRef.current[currentChatId] = true
        setViewerReadOnlyChatId(currentChatId)
        setOperatorConflict({
          chatId: currentChatId,
          operatorId: currentChat?.operator_id ?? null,
          operatorName: currentChat?.operator_name ?? null,
        })
        lastOperatorStateRef.current[currentChatId] = false
        previousSelectedChatIdRef.current = currentChatId
        return
      }

      waitingForChatReleaseRef.current[currentChatId] = false
      setViewerReadOnlyChatId(null)
      setOperatorConflict(null)
      updateOperatorPresence(currentChatId, true)
    }

    previousSelectedChatIdRef.current = currentChatId
  }, [selectedChatId, chats, authUser?.id])

  // No liberamos al cerrar pestaña: la asignacion persiste en DB.

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key !== "Escape") return
      if (!selectedChatId) return
      requestChatSelection("")
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectedChatId, chats, authUser?.id])

  return (
    // Antes: <div className="flex flex-1">
    <div className="relative flex h-full min-h-0">
      {/* Sidebar de chats */}
      <div className="w-80 border-r border-gray-300 bg-gray-100 flex flex-col min-h-0">
        <ChatSidebar
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={requestChatSelection}
          canViewAll={Boolean(props?.auth?.permissions?.can_view_all_chats)}
          currentOperatorId={authUser?.id ?? null}
        />
      </div>

      {/* Panel principal */}
      <div className="flex-1 flex flex-col min-h-0">
        <ChatMain
          chat={selectedChat}
          readOnly={isReadOnly}
          readOnlyOperatorName={
            selectedChat?.operator_name ?? null
          }
          readOnlyReason={readOnlyReason}
        />
      </div>


      {/* Panel derecho */}
      <div className="w-80 border-l border-gray-300 bg-gray-100 flex flex-col min-h-0">
        <ChatInfo
          chat={selectedChat}
          readOnly={isReadOnly}
          canToggleBot={canToggleBot && (
            Boolean(props?.auth?.permissions?.can_administer_chats) ||
            (!readOnlyByOperator && !readOnlyByViewerLock)
          )}
          canReassign={Boolean(
            props?.auth?.permissions?.can_administer_chats ||
            (props?.auth?.permissions?.can_assign_chats &&
              selectedChat?.attention_status === "assigned" &&
              Number(selectedChat?.operator_id ?? 0) === Number(authUser?.id ?? 0)),
          )}
          canAdminister={Boolean(props?.auth?.permissions?.can_administer_chats)}
          canViewAudit={Boolean(props?.auth?.permissions?.can_view_chat_audit)}
          canFinishAttention={canFinishAttention}
          canTakeChat={canTakeChat}
          takingChat={takingChat}
          finishingAttention={finishingAttention}
          onFinishAttention={finishSelectedAttention}
          onTakeChat={takeSelectedChat}
          onChatUpdated={(update) => setChats((current) => current.map((item) => String(item.id) === String(selectedChat?.id) ? { ...item, ...update } : item))}
        />
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

      {finishAttentionPrompt && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-slate-900">Finalizar atencion</h3>
                <p className="mt-0.5 text-sm text-slate-600">El bot esta pausado en este chat.</p>
              </div>
              <button
                type="button"
                onClick={() => setFinishAttentionPrompt(null)}
                disabled={finishingAttention}
                aria-label="Cerrar modal"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm text-slate-700">
              <p>
                Terminaste de atender a{" "}
                <span className="font-semibold text-slate-900">
                  {finishAttentionPrompt.chatName ?? "este paciente"}
                </span>
                ?
              </p>
              <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-[#013765]">
                Si confirmas, el flujo del bot vuelve al inicio y queda activo para la proxima respuesta del paciente.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                disabled={finishingAttention}
                onClick={leaveChatWithoutFinishing}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                No, dejar pausado
              </button>
              <button
                type="button"
                disabled={finishingAttention}
                onClick={finishAttentionAndReactivateBot}
                className="inline-flex items-center rounded-lg bg-[#013765] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#012e54] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {finishingAttention ? "Finalizando..." : "Si, finalizar y activar bot"}
              </button>
            </div>
          </div>
        </div>
      )}

      <StartupCurtain
        visible={showStartupCurtain || !panelMqttConnected}
        leaving={startupCurtainLeaving && panelMqttConnected}
        logoSrc={`${import.meta.env.VITE_APP_URL}/images/hu_icon_new.png`}
        subtitle="Conectando el panel de atención"
        error={!showStartupCurtain && !panelMqttConnected ? "reconnecting" : undefined}
      />
    </div>
  )
}
