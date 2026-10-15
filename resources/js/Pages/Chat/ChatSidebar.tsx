"use client"

import { useState, useMemo, useEffect } from "react"
import { motion } from "framer-motion"
import { Archive, Bot, Clock3, Globe2, Headset, MessageCircle, Search, User } from "lucide-react"
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
  canViewAll?: boolean
  currentOperatorId?: number | null
}

function InboxChats({
  chats,
  selectedChatId,
  onSelectChat,
  formatTimestamp,
  formatPreview,
  showAssignment,
}: {
  chats: Chat[]
  selectedChatId: string
  onSelectChat: (chatId: string | number) => void
  formatTimestamp: (timestamp?: string) => string
  formatPreview: (message?: string | null) => string
  showAssignment: boolean
}) {
  const [failedAvatars, setFailedAvatars] = useState<Record<string, boolean>>({})

  if (chats.length === 0) {
    return (
      <div className="flex items-center gap-3 px-3 py-4 text-sm text-slate-500">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <Headset className="h-4 w-4" />
        </span>
        <span>Sin conversaciones</span>
      </div>
    )
  }

  return (
    <div className="divide-y divide-slate-100">
      {chats.map((chat) => {
        const selected = String(chat.id) === String(selectedChatId)
        return (
          <motion.button
            key={chat.id}
            type="button"
            onClick={() => onSelectChat(chat.id)}
            layout="position"
            transition={{
              layout: {
                duration: 0.42,
                ease: [0.22, 1, 0.36, 1],
              },
            }}
            className={cn(
              "group flex w-full items-center gap-3 px-3 py-3 text-left transition-[background-color,color,box-shadow] duration-200 hover:bg-[#013765] hover:text-white",
              selected
                ? "bg-[#b9d8ee] shadow-[inset_4px_0_0_#013765]"
                : "hover:shadow-[inset_3px_0_0_#7fc7ff]",
            )}
          >
            <Avatar className="h-10 w-10 shrink-0 overflow-hidden bg-[#2b5f90] text-white">
              {chat.avatar && !failedAvatars[String(chat.id)] ? (
                <img src={chat.avatar} alt={chat.name} className="h-full w-full object-cover" onError={() => setFailedAvatars((current) => ({ ...current, [String(chat.id)]: true }))} />
              ) : <User className="m-auto h-5 w-5" />}
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className={cn("truncate text-sm font-semibold group-hover:text-white", selected ? "text-[#013765]" : "text-slate-800")}>{chat.name}</span>
                <span className="shrink-0 text-xs text-slate-500 group-hover:text-slate-200">{formatTimestamp(chat.timestamp)}</span>
              </span>
              <span className="mt-0.5 flex items-center gap-2">
                <span className="truncate text-sm text-slate-500 group-hover:text-slate-100">{formatPreview(chat.lastMessage)}</span>
                {(chat.bot_enabled || (chat.unread ?? 0) > 0) && (
                  <span className="ml-auto flex min-w-[3.25rem] shrink-0 items-center justify-between gap-2">
                    {chat.bot_enabled ? <Bot className="h-3.5 w-3.5 text-blue-700 group-hover:text-sky-200" /> : <span />}
                    {(chat.unread ?? 0) > 0 ? <Badge className="h-5 min-w-5 bg-[#013765] text-xs text-white">{chat.unread}</Badge> : <span />}
                  </span>
                )}
              </span>
              {showAssignment && (
                <span className={cn("mt-1 inline-flex max-w-full items-center gap-1 text-xs group-hover:text-slate-200", selected ? "text-[#013765]/80" : "text-slate-500")}>
                  <Headset className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{chat.attention_status === "archived"
                    ? `Archivado por: ${chat.closed_by === "system" ? "Sistema" : chat.last_operator_name ?? (chat.last_operator_id ? `Operador #${chat.last_operator_id}` : "Sistema")}`
                    : chat.operator_id
                      ? `Asignado a: ${chat.operator_name ?? `Operador #${chat.operator_id}`}`
                      : chat.bot_enabled
                        ? `Atendido por: ${chat.bot_name ?? "Asistente virtual"}`
                        : "Sin asignar"}</span>
                </span>
              )}
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}

function CompactFilterButton({
  label,
  count,
  active,
  onClick,
  Icon,
  tooltipAlign = "center",
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  Icon: any
  tooltipAlign?: "start" | "center"
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "group relative grid h-8 w-8 place-items-center rounded-full border transition",
        active
          ? "border-[#013765] bg-[#013765] text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-500 hover:border-[#013765]/45 hover:bg-[#e8f0f6] hover:text-[#013765]",
      )}
    >
      <Icon className="h-4 w-4" />
      {count > 0 && <span className={cn("absolute -right-1.5 -top-1.5 grid min-w-4 h-4 place-items-center rounded-full px-1 text-[9px] font-bold", active ? "bg-white text-[#013765]" : "bg-slate-200 text-slate-600")}>{count}</span>}
      <span role="tooltip" className={cn("pointer-events-none absolute top-full z-40 mt-2 whitespace-nowrap rounded-md bg-[#013765] px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100", tooltipAlign === "start" ? "left-4" : "left-1/2 -translate-x-1/2")}>{label}</span>
    </button>
  )
}

export default function ChatSidebar({ chats, selectedChatId, onSelectChat, canViewAll = false, currentOperatorId = null }: ChatSidebarProps) {
  const [search, setSearch] = useState("")
  const [statusFilters, setStatusFilters] = useState<Array<"bot" | "assigned" | "pending_assignment" | "archived">>(
    () => canViewAll ? [] : ["assigned"],
  )
  const [channelFilters, setChannelFilters] = useState<Array<"whatsapp" | "webchat">>([])
  const [now, setNow] = useState(Date.now())
  const [failedAvatars, setFailedAvatars] = useState<Record<string, boolean>>({})

  const normalizePhone = (value?: string | null) => String(value ?? "").replace(/\D/g, "")

  const formatLastMessagePreview = (raw?: string | null) => {
    const message = String(raw ?? "").trim()
    if (!message) return ""

    const icons = {
      contact: "\u{1F464}",
      location: "\u{1F4CD}",
      sticker: "\u{1F3F7}\uFE0F",
      audio: "\u{1F3B5}",
      video: "\u{1F3AC}",
      image: "\u{1F5BC}\uFE0F",
      document: "\u{1F4C4}",
    }

    const formatLocationPreview = (parsed: any) => {
      if (!Number.isFinite(Number(parsed?.latitude)) || !Number.isFinite(Number(parsed?.longitude))) {
        return null
      }

      const label = String(parsed?.name ?? parsed?.address ?? "").trim()
      return label ? `${icons.location} Ubicación: ${label}` : `${icons.location} Ubicación`
    }

    try {
      const parsed = JSON.parse(message)
      const locationPreview = formatLocationPreview(parsed)
      if (locationPreview) return locationPreview

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

      if (name || phone) {
        return `${icons.contact} Contacto${name ? `: ${name}` : ""}${phone ? ` · ${phone}` : ""}`
      }
    } catch {
      // no es JSON de contacto o ubicacion
    }

    const jsonStart = message.indexOf("{")
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(message.slice(jsonStart))
        const locationPreview = formatLocationPreview(parsed)
        if (locationPreview) return locationPreview
      } catch {
        // no es JSON embebido de ubicacion
      }
    }

    const lower = message.toLowerCase()
    const withoutTags = message.replace(/\[[^\]]+\]\s*/g, "").trim()

    if (lower.includes("[mensaje tipo contacts]")) {
      return `${icons.contact} Contacto`
    }
    if (lower.startsWith("contacto:")) {
      return `${icons.contact} ${message}`
    }
    if (lower.includes("[ubicacion]") || lower.includes("[ubicación]") || lower.includes("[location]")) {
      const label = withoutTags.replace(/^ubicaci[oó]n:\s*/i, "").trim()
      return label ? `${icons.location} Ubicación: ${label}` : `${icons.location} Ubicación`
    }

    if (lower.includes("[sticker]")) {
      return withoutTags ? `${icons.sticker} Sticker: ${withoutTags}` : `${icons.sticker} Sticker`
    }
    if (lower.includes("[audio]")) {
      return withoutTags ? `${icons.audio} Audio: ${withoutTags}` : `${icons.audio} Audio`
    }
    if (lower.includes("[video]")) {
      return withoutTags ? `${icons.video} Video: ${withoutTags}` : `${icons.video} Video`
    }
    if (lower.includes("[imagen]") || lower.includes("[image]")) {
      return withoutTags ? `${icons.image} Imagen: ${withoutTags}` : `${icons.image} Imagen`
    }
    if (lower.includes("[documento]") || lower.includes("[document]")) {
      return withoutTags ? `${icons.document} Documento: ${withoutTags}` : `${icons.document} Documento`
    }

    return message
  }
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 30_000)

    return () => clearInterval(interval)
  }, [])

  // Filtrar + ordenar por la última actividad: abrir un chat no debe bajarlo
  // solo por haber marcado sus mensajes como leídos.
  const visibleChats = useMemo(() => {
    const query = search.toLowerCase()
    const phoneQuery = normalizePhone(search)

    const filtered = chats.filter((chat) => {
      const chatStatus = chat.attention_status as "bot" | "assigned" | "pending_assignment" | "archived"
      const chatChannel = chat.channel === "webchat" ? "webchat" : "whatsapp"
      const belongsToCurrentOperator = chatStatus === "archived"
        ? Number(chat.last_operator_id ?? 0) === Number(currentOperatorId ?? 0)
        : Number(chat.operator_id ?? 0) === Number(currentOperatorId ?? 0)
      const matchesStatus = chatStatus === "archived"
        ? statusFilters.includes("archived") && (canViewAll || belongsToCurrentOperator)
        : statusFilters.length === 0 || (
          statusFilters.includes(chatStatus) &&
          (canViewAll || chatStatus !== "assigned" || belongsToCurrentOperator)
        )
      const matchesChannel = channelFilters.length === 0 || channelFilters.includes(chatChannel)

      return matchesStatus && matchesChannel && (
        chat.name.toLowerCase().includes(query) ||
        formatLastMessagePreview(chat.lastMessage).toLowerCase().includes(query) ||
        (phoneQuery.length > 0 && normalizePhone(chat.number).includes(phoneQuery))
      )
    })

    return [...filtered].sort((a, b) => {
      const dateA = a.timestamp ? new Date(a.timestamp.replace(" ", "T")).getTime() : 0
      const dateB = b.timestamp ? new Date(b.timestamp.replace(" ", "T")).getTime() : 0

      return dateB - dateA
    })
  }, [search, chats, statusFilters, channelFilters, canViewAll, currentOperatorId])

  const inboxCounts = useMemo(() => ({
    bot: chats.filter((chat) => chat.attention_status === "bot").length,
    assigned: chats.filter((chat) =>
      chat.attention_status === "assigned" &&
      (canViewAll || Number(chat.operator_id ?? 0) === Number(currentOperatorId ?? 0)),
    ).length,
    pending_assignment: chats.filter((chat) => chat.attention_status === "pending_assignment").length,
    archived: chats.filter((chat) =>
      chat.attention_status === "archived" &&
      (canViewAll || Number(chat.last_operator_id ?? 0) === Number(currentOperatorId ?? 0)),
    ).length,
  }), [chats, canViewAll, currentOperatorId])

  const toggleStatusFilter = (filter: "bot" | "assigned" | "pending_assignment" | "archived") => {
    setStatusFilters((current) => current.includes(filter) ? current.filter((item) => item !== filter) : [...current, filter])
  }

  const toggleChannelFilter = (filter: "whatsapp" | "webchat") => {
    setChannelFilters((current) => current.includes(filter) ? current.filter((item) => item !== filter) : [...current, filter])
  }

  const statusFilterOptions = [
    ...(canViewAll ? [{ key: "bot" as const, label: "Atendidos por bot", icon: Bot, count: inboxCounts.bot }] : []),
    { key: "assigned" as const, label: canViewAll ? "Asignados" : "Mis asignados", icon: Headset, count: inboxCounts.assigned },
    ...(canViewAll ? [{ key: "pending_assignment" as const, label: "Pendientes de asignación", icon: Clock3, count: inboxCounts.pending_assignment }] : []),
    { key: "archived" as const, label: canViewAll ? "Archivados" : "Mis archivados", icon: Archive, count: inboxCounts.archived },
  ]

  const channelFilterOptions = [
    { key: "whatsapp" as const, label: "WhatsApp", icon: MessageCircle, count: chats.filter((chat) => chat.channel !== "webchat").length },
    { key: "webchat" as const, label: "Webchat", icon: Globe2, count: chats.filter((chat) => chat.channel === "webchat").length },
  ]

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
      await fetch(`${import.meta.env.VITE_APP_URL}/api/chats/${normalizedChatId}/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    } catch (err) {
      console.error("Error auditando apertura de chat:", err)
    }

    try {
      await fetch(`${import.meta.env.VITE_APP_URL}/api/message/markAsRead/${normalizedChatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    } catch (err) {
      console.error("Error marcando como leÃ­do:", err)
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
            className="pl-10 border-gray-300 bg-white text-black"
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3" aria-label="Filtros de conversaciones">
          <div className="flex flex-wrap items-center gap-1.5">
            {statusFilterOptions.map((option, index) => <CompactFilterButton key={option.key} label={option.label} count={option.count} active={statusFilters.includes(option.key)} onClick={() => toggleStatusFilter(option.key)} Icon={option.icon} tooltipAlign={index === 0 ? "start" : "center"} />)}
          </div>
          <div className="h-6 w-px shrink-0 bg-slate-200" />
          <div className="flex items-center gap-1.5">
            {channelFilterOptions.map((option) => <CompactFilterButton key={option.key} label={option.label} count={option.count} active={channelFilters.includes(option.key)} onClick={() => toggleChannelFilter(option.key)} Icon={option.icon} />)}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <InboxChats chats={visibleChats} selectedChatId={selectedChatId} onSelectChat={handleSelectChat} formatTimestamp={formatTimestamp} formatPreview={formatLastMessagePreview} showAssignment />
      </div>

      {false && <div className="flex-1 overflow-y-auto custom-scrollbar">
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
                    <Avatar className="h-12 w-12 overflow-hidden flex items-center justify-center bg-[#2b5f90] text-white">
                      {chat.avatar && !failedAvatars[String(chat.id)] ? (
                        <img
                          src={chat.avatar}
                          alt={chat.name}
                          className="h-full w-full object-cover"
                          onError={() =>
                            setFailedAvatars((prev) => ({
                              ...prev,
                              [String(chat.id)]: true,
                            }))
                          }
                        />
                      ) : (
                        <User />
                      )}
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

                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("text-sm truncate", isSelected ? "text-[#013765]/85" : "text-muted-foreground")}>
                          {formatLastMessagePreview(chat.lastMessage)}
                        </p>

                        <div className="ml-2 flex items-center gap-2 shrink-0">
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
                          {chat.unread > 0 && (
                            <Badge
                              variant="default"
                              className="h-5 min-w-5 text-xs bg-[#013765] text-white"
                            >
                              {chat.unread}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {operatorActive && (
                        <div
                          className={cn(
                            "mt-1 flex items-center gap-2 min-w-0",
                            "justify-start",
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
            <div className="mx-2 mt-4 rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center shadow-sm">
              <div className="mb-3 flex justify-center">
                <Badge variant="secondary" className="bg-[#dce8f5] text-[#013765]">
                  Sin resultados
                </Badge>
              </div>
              <p className="text-sm font-medium text-foreground">No se encontraron conversaciones</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Probá con otro nombre, número o fragmento del mensaje.
              </p>
            </div>
          )}
        </div>
      </div>}
    </div>
  )
}
