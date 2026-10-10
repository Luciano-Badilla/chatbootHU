"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { Gallery, Item } from "react-photoswipe-gallery"
import "photoswipe/dist/photoswipe.css"
import { AudioLines, Code, Contact, Database, Zap, User, Image as ImageIcon, FileText, Video, Bot, Clock3, MessageSquare, PowerOff, Power, Loader2, RotateCcw, ChevronDown, ChevronRight, ExternalLink, MapPin, X, Users, History, ArchiveRestore, CheckCircle2 } from "lucide-react"
import { Avatar } from "shadcn/components/ui/avatar"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "shadcn/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "shadcn/components/ui/dialog"
import mqtt from "mqtt"
import { mqttWebSocketUrl } from "../../lib/mqtt"
import { formatDistanceToNow, format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import type { Chat, ChatVariable } from "./ChatPanel"

interface ChatInfoProps {
  chat?: Chat
  variables?: ChatVariable[]
  readOnly?: boolean
  canToggleBot?: boolean
  canAdminister?: boolean
  canReassign?: boolean
  canViewAudit?: boolean
  canFinishAttention?: boolean
  canTakeChat?: boolean
  takingChat?: boolean
  finishingAttention?: boolean
  onFinishAttention?: () => void
  onTakeChat?: () => void
  onChatUpdated?: (update: Partial<Chat>) => void
}

type VarType = "string" | "number" | "boolean" | "object" | "array" | "null" | "unknown"
type MediaType = "image" | "video" | "audio" | "document" | "contacts" | "location"

interface MediaItem {
  id: number
  sender: "user" | "contact"
  message_type: MediaType
  body?: string | null
  media_url?: string | null
  media_name?: string | null
  created_at?: string | null
}

type VarEntry = {
  value: any
  updated_at?: string | null
}

type VarsByDateMap = Record<string, Record<string, VarEntry>>
type DisplayVar = ChatVariable & { updated_at?: string | null }

type PreviewMedia = {
  url?: string
  name: string
  type: MediaType
  contact?: {
    name: string
    phone: string
    organization?: string
    title?: string
  }
  location?: {
    latitude: number
    longitude: number
    name: string
    address: string
    isValid: boolean
  }
}

type PendingAdminAction = {
  title: string
  description: string
  url: string
  body: Record<string, unknown>
  onSuccess: (payload: any) => void
}

const API_BASE = (import.meta.env.VITE_APP_URL || "").replace(/\/$/, "")

const ensureLeaflet = async () => {
  const win = window as any
  if (win.L) return win.L

  if (!document.querySelector("link[data-leaflet-css]")) {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
    link.dataset.leafletCss = "true"
    document.head.appendChild(link)
  }

  return await new Promise<any>((resolve, reject) => {
    const existingScript = document.querySelector("script[data-leaflet-js]")
    if (existingScript) {
      existingScript.addEventListener("load", () => win.L ? resolve(win.L) : reject(new Error("Leaflet no disponible")), { once: true })
      existingScript.addEventListener("error", () => reject(new Error("No se pudo cargar Leaflet")), { once: true })
      return
    }

    const script = document.createElement("script")
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
    script.dataset.leafletJs = "true"
    script.onload = () => win.L ? resolve(win.L) : reject(new Error("Leaflet no disponible"))
    script.onerror = () => reject(new Error("No se pudo cargar Leaflet"))
    document.body.appendChild(script)
  })
}

const LocationPreviewMap = ({ latitude, longitude }: { latitude: number; longitude: number }) => {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const pinRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!mapRef.current) return

    let cancelled = false
    let map: any = null
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null
    let LRef: any = null

    const updatePinPosition = () => {
      if (!map || !pinRef.current || !LRef) return
      const point = map.latLngToContainerPoint(LRef.latLng(latitude, longitude))
      pinRef.current.style.left = `${point.x}px`
      pinRef.current.style.top = `${point.y}px`
    }

    ensureLeaflet()
      .then((L) => {
        if (cancelled || !mapRef.current) return
        LRef = L

        map = L.map(mapRef.current, {
          zoomControl: true,
          attributionControl: true,
          scrollWheelZoom: true,
          zoomAnimation: false,
          markerZoomAnimation: false,
          fadeAnimation: false,
        }).setView([latitude, longitude], 15)

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map)

        map.on("move zoom resize viewreset", updatePinPosition)
        updatePinPosition()

        invalidateTimer = setTimeout(() => {
          map?.invalidateSize?.()
          updatePinPosition()
        }, 80)
      })
      .catch((error) => {
        console.error("Error cargando mapa de ubicacion:", error)
      })

    return () => {
      cancelled = true
      if (invalidateTimer) clearTimeout(invalidateTimer)
      map?.off?.("move zoom resize viewreset", updatePinPosition)
      map?.off?.()
      map?.remove?.()
      map = null
      LRef = null
    }
  }, [latitude, longitude])

  return (
    <div className="relative h-full w-full bg-slate-100">
      <div ref={mapRef} className="h-full w-full" />
      <span
        ref={pinRef}
        className="pointer-events-none absolute z-[500] flex h-12 w-12 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full bg-[#013765] text-white shadow-lg ring-4 ring-white"
      >
        <MapPin className="h-6 w-6 fill-current" />
      </span>
    </div>
  )
}

function WebchatGalleryImage({ src, alt }: { src: string; alt: string }) {
  const [loading, setLoading] = useState(true)
  return <div className="relative flex h-full w-full items-center justify-center bg-black"><img src={src} alt={alt} onLoad={() => setLoading(false)} onError={() => setLoading(false)} className="h-auto w-auto max-h-[82vh] max-w-[96vw] object-contain" />{loading ? <span className="absolute inset-0 grid place-items-center bg-black/70 text-white"><Loader2 className="h-9 w-9 animate-spin" /><span className="sr-only">Cargando imagen</span></span> : null}</div>
}

function WebchatGalleryVideo({ src }: { src: string }) {
  const [loading, setLoading] = useState(true)
  return <div className="relative flex h-full w-full items-center justify-center bg-black"><video src={src} controls autoPlay playsInline onLoadedData={() => setLoading(false)} onError={() => setLoading(false)} className="h-auto w-auto max-h-[82vh] max-w-[96vw] object-contain" />{loading ? <span className="absolute inset-0 grid place-items-center bg-black/70 text-white"><Loader2 className="h-9 w-9 animate-spin" /><span className="sr-only">Cargando video</span></span> : null}</div>
}

export default function ChatInfo({
  chat,
  variables = [],
  readOnly = false,
  canToggleBot = false,
  canAdminister = false,
  canReassign = false,
  canViewAudit = false,
  canFinishAttention = false,
  canTakeChat = false,
  takingChat = false,
  finishingAttention = false,
  onFinishAttention,
  onTakeChat,
  onChatUpdated,
}: ChatInfoProps) {
  const canUseBotControls = canToggleBot && chat?.status !== "closed"
  const [contactAvatarFailed, setContactAvatarFailed] = useState(false)

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

  const normalizeVarsByDate = (raw: any): VarsByDateMap => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}

    const out: VarsByDateMap = {}
    for (const [dateKey, varsOfDate] of Object.entries(raw)) {
      if (!varsOfDate || typeof varsOfDate !== "object" || Array.isArray(varsOfDate)) continue
      out[dateKey] = {}
      for (const [name, entry] of Object.entries(varsOfDate as Record<string, any>)) {
        if (entry && typeof entry === "object" && !Array.isArray(entry) && ("value" in entry)) {
          out[dateKey][name] = {
            value: (entry as any).value,
            updated_at: (entry as any).updated_at ?? null,
          }
        } else {
          out[dateKey][name] = {
            value: entry,
            updated_at: null,
          }
        }
      }
    }
    return out
  }

  const deriveVarsByDateFromFlat = (rawVars: Record<string, any>): VarsByDateMap => {
    const dateKey = format(new Date(), "yyyy-MM-dd")
    const bucket: Record<string, VarEntry> = {}
    for (const [name, value] of Object.entries(rawVars || {})) {
      bucket[name] = { value, updated_at: null }
    }
    return Object.keys(bucket).length ? { [dateKey]: bucket } : {}
  }

  // ---------------------------
  // Variables: MAPA (sin duplicados)
  // ---------------------------
  const [varsByDateMap, setVarsByDateMap] = useState<VarsByDateMap>(() => {
    const byDate = normalizeVarsByDate((chat?.bot_state as any)?.vars_by_date)
    if (Object.keys(byDate).length > 0) return byDate

    if (Array.isArray(variables) && variables.length > 0) {
      const m: Record<string, any> = {}
      for (const v of variables) m[v.name] = v.value
      return deriveVarsByDateFromFlat(m)
    }

    const flat = (chat?.bot_state as any)?.vars
    return flat && typeof flat === "object" && !Array.isArray(flat)
      ? deriveVarsByDateFromFlat(flat)
      : {}
  })

  // rehidrata vars al cambiar chat
  useEffect(() => {
    if (Array.isArray(variables) && variables.length > 0) {
      const m: Record<string, any> = {}
      for (const v of variables) m[v.name] = v.value
      setVarsByDateMap(deriveVarsByDateFromFlat(m))
      return
    }

    const v = (chat?.bot_state as any)?.vars
    const byDate = normalizeVarsByDate((chat?.bot_state as any)?.vars_by_date)
    if (Object.keys(byDate).length > 0) {
      setVarsByDateMap(byDate)
    } else {
      const flat = v && typeof v === "object" && !Array.isArray(v) ? v : {}
      setVarsByDateMap(deriveVarsByDateFromFlat(flat))
    }
  }, [chat?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const varGroups = useMemo(() => {
    return Object.entries(varsByDateMap)
      .filter(([, vars]) => vars && Object.keys(vars).length > 0)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, vars]) => {
        const list: DisplayVar[] = Object.entries(vars).map(([name, entry]) => ({
          name,
          value: (entry as VarEntry).value,
          type: detectType((entry as VarEntry).value),
          updated_at: (entry as VarEntry).updated_at ?? null,
        }))
        list.sort((x, y) => x.name.localeCompare(y.name))
        return { date, vars: list }
      })
  }, [varsByDateMap]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalVarsCount = useMemo(
    () => varGroups.reduce((acc, group) => acc + group.vars.length, 0),
    [varGroups],
  )

  const hasVars = varGroups.length > 0
  const [expandedVarDate, setExpandedVarDate] = useState<string | null>(null)

  useEffect(() => {
    if (!hasVars) {
      setExpandedVarDate(null)
      return
    }

    const todayKey = format(new Date(), "yyyy-MM-dd")
    if (varGroups.some((group) => group.date === todayKey)) {
      setExpandedVarDate(todayKey)
      return
    }

    setExpandedVarDate(varGroups[0]?.date ?? null)
  }, [chat?.id, hasVars, varGroups])

  // ---------------------------
  // Información general
  // ---------------------------
  const [botEnabled, setBotEnabled] = useState<boolean>(chat?.bot_enabled ?? true)
  const [togglingBot, setTogglingBot] = useState(false)
  const [resettingBot, setResettingBot] = useState(false)
  const [adminOperators, setAdminOperators] = useState<Array<{ id: number; name: string; availability: string; assigned_count: number; capacity: number }>>([])
  const [selectedOperatorId, setSelectedOperatorId] = useState("")
  const [adminBusy, setAdminBusy] = useState(false)
  const [adminMessage, setAdminMessage] = useState<string | null>(null)
  const [pendingAdminAction, setPendingAdminAction] = useState<PendingAdminAction | null>(null)
  const [adminActionReason, setAdminActionReason] = useState("")
  const [adminModalError, setAdminModalError] = useState<string | null>(null)
  const [reassignmentOpen, setReassignmentOpen] = useState(false)
  const [reassignmentReason, setReassignmentReason] = useState("")
  const [lastReassignmentReason, setLastReassignmentReason] = useState<string | null>(null)
  const [finishAttentionOpen, setFinishAttentionOpen] = useState(false)
  const [auditLogs, setAuditLogs] = useState<Array<{ id: number; event: string; description: string; created_at?: string; causer_name?: string | null; properties?: any }>>([])
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditSearch, setAuditSearch] = useState("")
  const [totalMessages, setTotalMessages] = useState<number | null>(null)
  const [lastMessageAt, setLastMessageAt] = useState<string | null>(chat?.timestamp ?? null)
  const knownMessageIdsRef = useRef<Set<string>>(new Set())

  type MqttStatus = "connected" | "connecting" | "reconnecting" | "offline" | "disconnected" | "error"
  const [mqttStatus, setMqttStatus] = useState<MqttStatus>("disconnected")
  const [mqttLastEventAt, setMqttLastEventAt] = useState<string | null>(null)

  // Reiniciar contadores/estado de red solo cuando cambia el chat seleccionado.
  useEffect(() => {
    setTotalMessages(null)
    setMqttStatus("disconnected")
    setMqttLastEventAt(null)
    setAuditOpen(false)
    setAuditLogs([])
    setAuditSearch("")
    knownMessageIdsRef.current = new Set()
  }, [chat?.id])

  useEffect(() => {
    if (!chat?.id || !canViewAudit) {
      setLastReassignmentReason(null)
      return
    }

    let cancelled = false
    fetch(`${API_BASE}/api/chats/${chat.id}/audit?limit=100`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        if (cancelled) return
        const entry = (Array.isArray(payload.logs) ? payload.logs : []).find((item) =>
          ["operator_reassigned", "operator_auto_reassigned"].includes(String(item.event)) &&
          typeof item?.properties?.meta?.reason === "string" && item.properties.meta.reason.trim(),
        )
        setLastReassignmentReason(entry?.properties?.meta?.reason?.trim() ?? null)
      })
      .catch(() => {
        if (!cancelled) setLastReassignmentReason(null)
      })

    return () => { cancelled = true }
  }, [chat?.id, canViewAudit])

  useEffect(() => {
    setContactAvatarFailed(false)
  }, [chat?.id, chat?.avatar])

  // Mantener sincronizado el estado del bot con la data del chat.
  useEffect(() => {
    setBotEnabled(chat?.bot_enabled ?? true)
  }, [chat?.bot_enabled])

  // Actualizar timestamp del último mensaje sin resetear tarjetas.
  useEffect(() => {
    setLastMessageAt(chat?.timestamp ?? null)
  }, [chat?.timestamp])

  const formatDateSafe = (raw?: string | null) => {
    if (!raw) return "Sin datos"
    try {
      const parsed = raw.includes("T") ? parseISO(raw) : new Date(raw.replace(" ", "T"))
      if (isNaN(parsed.getTime())) return "Sin datos"
      return format(parsed, "dd/MM/yyyy HH:mm")
    } catch {
      return "Sin datos"
    }
  }

  const formatDateOnlySafe = (rawDate?: string | null) => {
    if (!rawDate) return "Sin fecha"
    try {
      const parsed = rawDate.includes("T") ? parseISO(rawDate) : new Date(rawDate.replace(" ", "T"))
      if (isNaN(parsed.getTime())) return rawDate
      return format(parsed, "dd/MM/yyyy")
    } catch {
      return rawDate
    }
  }

  const formatRelativeSafe = (raw?: string | null) => {
    if (!raw) return "Sin actividad reciente"
    try {
      const parsed = raw.includes("T") ? parseISO(raw) : new Date(raw.replace(" ", "T"))
      if (isNaN(parsed.getTime())) return "Sin actividad reciente"
      return formatDistanceToNow(parsed, { addSuffix: true, locale: es })
    } catch {
      return "Sin actividad reciente"
    }
  }

  useEffect(() => {
    if (!chat?.id) return

    let cancelled = false
    setTotalMessages(null)

    fetch(`${API_BASE}/api/chat/messages/${chat.id}?limit=10`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => {
        const list = Array.isArray(data) ? data : (data?.messages ?? [])
        const ids = new Set<string>()
        for (const m of list) {
          if (m?.id !== undefined && m?.id !== null) ids.add(String(m.id))
        }
        knownMessageIdsRef.current = ids
        if (!cancelled) setTotalMessages(Number(data?.total ?? list.length))
      })
      .catch(() => {
        if (!cancelled) setTotalMessages(0)
      })

    return () => {
      cancelled = true
    }
  }, [chat?.id])

  // ---------------------------
  // Medios
  // ---------------------------
  const [media, setMedia] = useState<MediaItem[]>([])
  const [activeMediaType, setActiveMediaType] = useState<MediaType | "all">("all")
  const [preview, setPreview] = useState<PreviewMedia | null>(null)
  const [mediaDimensions, setMediaDimensions] = useState<Record<string, { width: number; height: number }>>({})

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

  const galleryPreviews = mediaFiltered.flatMap((item) => item.media_url && ["image", "video"].includes(item.message_type) ? [{ type: item.message_type as "image" | "video", url: resolveMediaUrl(item.media_url) }] : [])

  const addMediaThumbnails = (photoswipe: any) => {
    const strip = document.createElement("div")
    Object.assign(strip.style, { position: "absolute", bottom: "112px", left: "50%", transform: "translateX(-50%)", display: "flex", maxWidth: "calc(100% - 32px)", gap: "8px", overflowX: "auto", scrollBehavior: "smooth", padding: "6px", borderRadius: "12px", background: "rgba(0, 0, 0, 0.48)", zIndex: "10" })
    const render = () => {
      const previews: HTMLButtonElement[] = []
      strip.replaceChildren(...galleryPreviews.map((mediaItem, index) => {
        const button = document.createElement("button")
        button.type = "button"
        button.setAttribute("aria-label", `Ver medio ${index + 1}`)
        Object.assign(button.style, { width: "52px", height: "40px", flex: "0 0 auto", overflow: "hidden", borderRadius: "8px", border: index === photoswipe.currIndex ? "2px solid #ffffff" : "1px solid rgba(255,255,255,.45)", background: "#0f172a", padding: "0", cursor: "pointer" })
        if (mediaItem.type === "image") {
          const image = document.createElement("img")
          image.src = mediaItem.url
          image.alt = ""
          Object.assign(image.style, { width: "100%", height: "100%", objectFit: "cover" })
          button.appendChild(image)
        } else {
          const video = document.createElement("video")
          video.src = mediaItem.url
          video.muted = true
          video.preload = "metadata"
          Object.assign(video.style, { width: "100%", height: "100%", objectFit: "cover" })
          button.appendChild(video)
          const play = document.createElement("span")
          play.textContent = "▶"
          Object.assign(play.style, { position: "absolute", inset: "0", display: "grid", placeItems: "center", color: "#ffffff", fontSize: "14px", textShadow: "0 1px 3px #000" })
          button.style.position = "relative"
          button.appendChild(play)
        }
        button.onclick = () => photoswipe.goTo(index)
        previews.push(button)
        return button
      }))
      window.requestAnimationFrame(() => previews[photoswipe.currIndex]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }))
    }
    photoswipe.element.appendChild(strip)
    render()
    photoswipe.on("change", render)
    const syncControlsVisibility = () => {
      strip.style.opacity = photoswipe.element.classList.contains("pswp--ui-visible") ? "1" : "0"
      strip.style.pointerEvents = photoswipe.element.classList.contains("pswp--ui-visible") ? "auto" : "none"
    }
    syncControlsVisibility()
    const controlsObserver = new MutationObserver(syncControlsVisibility)
    controlsObserver.observe(photoswipe.element, { attributes: true, attributeFilter: ["class"] })
    photoswipe.on("destroy", () => { controlsObserver.disconnect(); strip.remove() })
  }

  const mediaCounts = useMemo(() => {
    const c = { image: 0, video: 0, audio: 0, document: 0, contacts: 0, location: 0 }
    for (const m of media) c[m.message_type]++
    return c
  }, [media])

  const getContactCardData = (item: Pick<MediaItem, "body" | "media_name">) => {
    const rawBody = String(item.body ?? "").trim()

    try {
      const parsed = JSON.parse(rawBody)
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
      const organization = String(contact?.org?.company ?? "").trim()
      const title = String(contact?.org?.title ?? "").trim()

      return {
        name: name || item.media_name || "Contacto",
        phone,
        organization,
        title,
      }
    } catch {
      return {
        name: item.media_name || rawBody.replace(/^Contacto:\s*/i, "").trim() || "Contacto",
        phone: "",
        organization: "",
        title: "",
      }
    }
  }

  const getLocationCardData = (item: Pick<MediaItem, "body" | "media_name">) => {
    const rawBody = String(item.body ?? "").trim()

    try {
      const parsed = JSON.parse(rawBody)
      const latitude = Number(parsed?.latitude)
      const longitude = Number(parsed?.longitude)
      const name = String(parsed?.name ?? item.media_name ?? "").trim()
      const address = String(parsed?.address ?? "").trim()

      return {
        latitude,
        longitude,
        name: name || address || "Ubicacion",
        address,
        isValid: Number.isFinite(latitude) && Number.isFinite(longitude),
      }
    } catch {
      return {
        latitude: Number.NaN,
        longitude: Number.NaN,
        name: item.media_name || rawBody.replace(/^\[?Ubicaci[oó]n\]?\s*/i, "").trim() || "Ubicacion",
        address: "",
        isValid: false,
      }
    }
  }

  const getLocationMapsUrl = (location: NonNullable<PreviewMedia["location"]>) =>
    location.isValid ? `https://www.google.com/maps?q=${location.latitude},${location.longitude}` : ""

  const ContactPreviewCard = ({ contact }: { contact: NonNullable<PreviewMedia["contact"]> }) => (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="mb-5 flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white text-[#013765] shadow-sm">
          <Contact className="h-8 w-8" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tarjeta de contacto</p>
          <p className="break-words text-lg font-semibold text-slate-900">{contact.name}</p>
        </div>
      </div>

      <div className="grid gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Nombre</p>
          <p className="mt-1 break-words text-sm font-semibold text-slate-800">{contact.name || "Sin nombre"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Teléfono</p>
          <p className="mt-1 break-words text-sm font-semibold text-slate-800">{contact.phone || "Sin teléfono"}</p>
        </div>
        {(contact.title || contact.organization) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cargo</p>
              <p className="mt-1 break-words text-sm font-semibold text-slate-800">{contact.title || "Sin cargo"}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Empresa</p>
              <p className="mt-1 break-words text-sm font-semibold text-slate-800">{contact.organization || "Sin empresa"}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const isPreviewableDocument = (name: string, url: string) => {
    const target = `${name} ${url}`.toLowerCase()
    return target.includes(".pdf")
  }

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
    setMedia([])
    setVideoThumbs({}) // opcional: limpiar thumbs al cambiar chat
    setPreview(null)

    if (!chat?.id) return

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

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !preview) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      setPreview(null)
    }

    document.addEventListener("keydown", handleEscape, true)
    return () => document.removeEventListener("keydown", handleEscape, true)
  }, [preview])

  // ---------------------------
  // MQTT (vars + chat messages -> media)
  // ---------------------------
  const clientRef = useRef<any>(null)

  useEffect(() => {
    if (!chat?.id) return

    try {
      clientRef.current?.end?.(true)
    } catch { }

    const brokerUrl = mqttWebSocketUrl()
    if (!brokerUrl) return
    const clientId = `front_chatinfo_${chat.id}_${Math.random().toString(16).slice(2)}`
    setMqttStatus("connecting")
    const client = mqtt.connect(brokerUrl, {
      clientId,
      clean: true,
      reconnectPeriod: 2000,
    })

    clientRef.current = client

    const topicVars = `chat/${chat.id}/vars`
    const topicChat = `chat/${chat.id}`
    const topicBotStatus = `status_bot/chat/${chat.id}`

    client.on("connect", () => {
      setMqttStatus("connected")
      setMqttLastEventAt(new Date().toISOString())
      client.subscribe(topicVars)
      client.subscribe(topicChat)
      client.subscribe(topicBotStatus)
    })

    client.on("reconnect", () => {
      setMqttStatus("reconnecting")
      setMqttLastEventAt(new Date().toISOString())
    })

    client.on("offline", () => {
      setMqttStatus("offline")
      setMqttLastEventAt(new Date().toISOString())
    })

    client.on("close", () => {
      setMqttStatus("disconnected")
      setMqttLastEventAt(new Date().toISOString())
    })

    client.on("error", () => {
      setMqttStatus("error")
      setMqttLastEventAt(new Date().toISOString())
    })

    client.on("message", (t, payload) => {
      try {
        const data = JSON.parse(payload.toString())
        setMqttLastEventAt(new Date().toISOString())

        // Vars
        if (t === topicVars) {
          if (String(data.chat_id) !== String(chat.id)) return

          if (data.vars_by_date && typeof data.vars_by_date === "object" && !Array.isArray(data.vars_by_date)) {
            setVarsByDateMap(normalizeVarsByDate(data.vars_by_date))
          }

          if (data.vars && typeof data.vars === "object" && !Array.isArray(data.vars)) {
            if (!(data.vars_by_date && typeof data.vars_by_date === "object")) {
              setVarsByDateMap(deriveVarsByDateFromFlat(data.vars))
            }
            return
          }

          if (data.var?.name) {
            const k = String(data.var.name)
            setVarsByDateMap((prev) => {
              const iso = typeof data.var.updated_at === "string"
                ? data.var.updated_at
                : (typeof data.timestamp === "string" ? data.timestamp : new Date().toISOString())
              const dateKey = typeof data.var.date === "string"
                ? data.var.date
                : format(new Date(iso), "yyyy-MM-dd")

              const next = { ...prev }
              const bucket = { ...(next[dateKey] || {}) }
              bucket[k] = { value: data.var.value, updated_at: iso }
              next[dateKey] = bucket
              return next
            })
          }
          return
        }

        // Estado del bot
        if (t === topicBotStatus) {
          if (String(data.chat_id) !== String(chat.id)) return
          if (typeof data.status === "string") {
            setBotEnabled(data.status === "enabled")
          }
          return
        }

        // Chat messages
        if (t === topicChat) {
          if (String(data.chat_id) !== String(chat.id)) return

          const incomingId = data.message_id ?? data.id
          if (incomingId !== undefined && incomingId !== null) {
            const key = String(incomingId)
            if (!knownMessageIdsRef.current.has(key)) {
              knownMessageIdsRef.current.add(key)
              setTotalMessages((prev) => (typeof prev === "number" ? prev + 1 : 1))
            }
          }

          if (data.timestamp) {
            setLastMessageAt(String(data.timestamp))
          }

          const msgType = String(data.message_type || "")
          const mediaUrl = data.media_url ? String(data.media_url) : ""
          if (!["image", "video", "audio", "document", "contacts", "location"].includes(msgType)) return
          if (!["contacts", "location"].includes(msgType) && !mediaUrl) return

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
        setMqttStatus("disconnected")
        setMqttLastEventAt(new Date().toISOString())
      } catch { }
    }
  }, [chat?.id])

  const mqttStatusMeta = useMemo(() => {
    switch (mqttStatus) {
      case "connected":
        return { label: "Conectado", dot: "bg-green-500" }
      case "connecting":
        return { label: "Conectando", dot: "bg-yellow-500" }
      case "reconnecting":
        return { label: "Reconectando", dot: "bg-amber-500" }
      case "offline":
        return { label: "Offline", dot: "bg-orange-500" }
      case "error":
        return { label: "Error", dot: "bg-red-500" }
      default:
        return { label: "Desconectado", dot: "bg-gray-400" }
    }
  }, [mqttStatus])

  const handleToggleBot = async () => {
    if (!chat?.id || togglingBot || resettingBot || !canToggleBot) return

    const nextEnabled = !botEnabled
    setTogglingBot(true)
    setBotEnabled(nextEnabled)

    try {
      const res = await fetch(`${API_BASE}/api/chats/${chat.id}/bot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bot_enabled: nextEnabled }),
      })

      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBotEnabled(!nextEnabled)
      } else {
        onChatUpdated?.({ bot_enabled: nextEnabled, bot_state: payload.chat?.bot_state ?? chat.bot_state })
      }
    } catch {
      setBotEnabled(!nextEnabled)
    } finally {
      setTogglingBot(false)
    }
  }

  const handleResetBot = async () => {
    if (!chat?.id || togglingBot || resettingBot || !canToggleBot) return

    setResettingBot(true)

    try {
      const res = await fetch(`${API_BASE}/api/chats/${chat.id}/bot/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      })

      const payload = await res.json().catch(() => ({}))
      if (!res.ok) return

      setBotEnabled(true)
      onChatUpdated?.({
        bot_enabled: true,
        bot_flow_id: payload.chat?.bot_flow_id ?? chat.bot_flow_id,
        bot_node_id: payload.chat?.bot_node_id ?? chat.bot_node_id,
        bot_step: payload.chat?.bot_step ?? null,
        bot_state: payload.chat?.bot_state ?? chat.bot_state,
      })
    } finally {
      setResettingBot(false)
    }
  }

  useEffect(() => {
    if (!canReassign) return
    let cancelled = false
    fetch(`${API_BASE}/api/operator-control/snapshot`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        if (!cancelled) setAdminOperators(Array.isArray(payload.operators) ? payload.operators : [])
      })
      .catch(() => {
        if (!cancelled) setAdminMessage("No se pudo cargar la disponibilidad de operadores.")
      })
    return () => { cancelled = true }
  }, [canReassign, chat?.id])

  const attentionStatusLabel = (status?: string | null) => ({
    bot: "Atendido por bot",
    pending_assignment: "Pendiente de asignación",
    assigned: "Asignado a operador",
    archived: "Archivado",
  }[status ?? ""] ?? "Sin datos")

  const executePendingAdminAction = async () => {
    if (!pendingAdminAction) return
    const reason = adminActionReason.trim()
    if (!reason) {
      setAdminModalError("Ingresá un motivo para realizar esta acción.")
      return
    }
    setAdminBusy(true)
    setAdminMessage(null)
    setAdminModalError(null)
    try {
      const response = await fetch(pendingAdminAction.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pendingAdminAction.body, reason }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || "No se pudo completar la acción.")
      pendingAdminAction.onSuccess(payload)
      setPendingAdminAction(null)
      setAdminActionReason("")
    } catch (error) {
      setAdminModalError(error instanceof Error ? error.message : "No se pudo completar la acción.")
    } finally {
      setAdminBusy(false)
    }
  }

  const confirmFinishAttention = () => {
    setFinishAttentionOpen(false)
    onFinishAttention?.()
  }

  const reassignChat = (automatic: boolean) => {
    if (!chat?.id) return
    if (automatic) return
    setAdminMessage(null)
    setAdminModalError(null)
    setReassignmentReason("")
    setReassignmentOpen(true)
  }

  const executeReassignment = async () => {
    if (!chat?.id) return
    const reason = reassignmentReason.trim()
    if (!reason) {
      setAdminModalError("Ingresá un motivo para reasignar el chat.")
      return
    }
    const operatorId = Number(selectedOperatorId)
    if (!operatorId) {
      setAdminModalError("Seleccioná un operador disponible.")
      return
    }
    setAdminBusy(true)
    setAdminMessage(null)
    setAdminModalError(null)
    try {
      const response = await fetch(`${API_BASE}/api/chats/${chat.id}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automatic: false, operator_id: operatorId, reason }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || "No se pudo reasignar el chat.")
      const target = adminOperators.find((operator) => operator.id === Number(payload.operator_id))
      onChatUpdated?.({ operator_id: payload.operator_id ?? null, operator_name: payload.operator_name ?? target?.name ?? null, attention_status: payload.pending ? "pending_assignment" : "assigned", status: "open", bot_enabled: false })
      setLastReassignmentReason(reason)
      setAdminMessage("Chat reasignado correctamente.")
      setReassignmentOpen(false)
      setReassignmentReason("")
    } catch (error) {
      setAdminModalError(error instanceof Error ? error.message : "No se pudo reasignar el chat.")
    } finally {
      setAdminBusy(false)
    }
  }

  const changeLifecycle = (action: "archive" | "reopen") => {
    if (!chat?.id) return
    const isArchive = action === "archive"
    setAdminModalError(null)
    setPendingAdminAction({
      title: isArchive ? "Finalizar atención" : "Reabrir conversación",
      description: isArchive ? "Se liberará al operador, se archivará el chat y se reactivará el bot." : "El chat se reabrirá con el bot activo y sin operador asignado.",
      url: `${API_BASE}/api/chats/${chat.id}/${action}`,
      body: {},
      onSuccess: (result) => {
        if (!result?.chat) return
        onChatUpdated?.({
          operator_id: null, operator_name: null, bot_enabled: true,
          status: result.chat.status, attention_status: result.chat.attention_status,
          assigned_at: result.chat.assigned_at, closed_at: result.chat.closed_at, closed_by: result.chat.closed_by,
          bot_flow_id: result.chat.bot_flow_id, bot_flow_name: result.chat.bot_flow_name, bot_node_id: result.chat.bot_node_id, bot_node_name: result.chat.bot_node_name,
          bot_step: result.chat.bot_step, bot_state: result.chat.bot_state,
        })
        setAdminMessage(isArchive ? "Chat archivado y bot reactivado." : "Chat reabierto con el bot activo.")
      },
    })
    setAdminActionReason("")
  }

  const loadAudit = async () => {
    if (!chat?.id) return
    setAuditOpen(true)
    setAuditLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/chats/${chat.id}/audit?limit=500`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || "No se pudo cargar el historial.")
      setAuditLogs(Array.isArray(payload.logs) ? payload.logs : [])
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "No se pudo cargar el historial.")
    } finally {
      setAuditLoading(false)
    }
  }

  const filteredAuditLogs = auditLogs.filter((entry) => {
    const query = auditSearch.trim().toLowerCase()
    if (!query) return true

    let propertiesText = ""
    try {
      propertiesText = JSON.stringify(entry.properties ?? {})
    } catch {
      propertiesText = ""
    }

    return [entry.causer_name, entry.description, entry.event, entry.created_at, propertiesText]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query)
  })

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
        className={active ? "bg-[#013765] hover:bg-[#024a8a] text-white" : "border-gray-200 bg-white text-black"}
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
    <div className="rounded-lg overflow-hidden border hover:opacity-95 transition min-w-0">
      <div className="h-24 w-full bg-white flex items-center justify-center">{children}</div>
      <div className="px-2 py-1 border-t bg-white">
        <div className="text-[10px] text-muted-foreground truncate min-w-0">{name}</div>
      </div>
    </div>
  )

  if (!chat) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="w-full rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-7 text-center shadow-sm">
          <div className="mb-3 flex justify-center">
            <Badge variant="secondary" className="bg-[#dce8f5] text-[#013765]">
              Sin seleccion
            </Badge>
          </div>
          <h3 className="mb-2 text-lg font-medium text-foreground">Informacion del chat</h3>
          <p className="text-sm text-muted-foreground">Selecciona una conversacion para ver los detalles.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col h-full">
      <Dialog open={finishAttentionOpen} onOpenChange={(open) => { if (!finishingAttention) setFinishAttentionOpen(open) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Finalizar atención</DialogTitle>
            <DialogDescription>
              El chat se archivará, se liberará del operador actual y el bot volverá a quedar activo. ¿Querés continuar?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={finishingAttention} onClick={() => setFinishAttentionOpen(false)}>Cancelar</Button>
            <Button type="button" className="bg-[#013765] hover:bg-[#024a8a]" disabled={finishingAttention} onClick={confirmFinishAttention}>
              {finishingAttention ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {finishingAttention ? "Finalizando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={reassignmentOpen} onOpenChange={(open) => { if (!open && !adminBusy) { setReassignmentOpen(false); setReassignmentReason(""); setAdminModalError(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#013765]">Reasignar conversación</DialogTitle>
            <DialogDescription>Elegí el operador que continuará atendiendo este chat e indicá el motivo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{chat.name}</p>
            <Select value={selectedOperatorId} onValueChange={setSelectedOperatorId} disabled={adminBusy}>
              <SelectTrigger><SelectValue placeholder="Seleccioná un operador" /></SelectTrigger>
              <SelectContent>
                {adminOperators.filter((operator) => operator.id !== Number(chat.operator_id ?? 0)).map((operator) => (
                  <SelectItem key={operator.id} value={String(operator.id)} disabled={operator.availability !== "available" || operator.assigned_count >= operator.capacity}>
                    {operator.name} · {operator.assigned_count}/{operator.capacity}{operator.availability !== "available" ? " · no disponible" : operator.assigned_count >= operator.capacity ? " · sin cupo" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <textarea
              value={reassignmentReason}
              onChange={(event) => setReassignmentReason(event.target.value)}
              placeholder="Motivo de la reasignación"
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#2b5f90] focus:ring-2 focus:ring-[#2b5f90]/20"
              aria-label="Motivo de la reasignación"
            />
            {adminModalError ? <p className="text-xs font-medium text-red-600">{adminModalError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setReassignmentOpen(false); setReassignmentReason(""); setAdminModalError(null) }} disabled={adminBusy}>Cancelar</Button>
            <Button type="button" className="bg-[#013765] hover:bg-[#024a8a]" onClick={executeReassignment} disabled={adminBusy}>
              {adminBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {adminBusy ? "Reasignando…" : "Confirmar reasignación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(pendingAdminAction)} onOpenChange={(open) => { if (!open && !adminBusy) { setPendingAdminAction(null); setAdminActionReason(""); setAdminModalError(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{pendingAdminAction?.title}</DialogTitle>
            <DialogDescription>{pendingAdminAction?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <label htmlFor="admin-action-reason" className="text-sm font-medium text-slate-700">Motivo</label>
            <textarea
              id="admin-action-reason"
              value={adminActionReason}
              onChange={(event) => setAdminActionReason(event.target.value)}
              placeholder="Indica el motivo de esta acción"
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#2b5f90] focus:ring-2 focus:ring-[#2b5f90]/20"
            />
            {adminModalError ? <p className="text-xs font-medium text-red-600">{adminModalError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={adminBusy} onClick={() => { setPendingAdminAction(null); setAdminActionReason(""); setAdminModalError(null) }}>Cancelar</Button>
            <Button type="button" className="bg-[#013765] hover:bg-[#012e54]" disabled={adminBusy} onClick={executePendingAdminAction}>
              {adminBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden border-slate-300 bg-slate-50 p-0">
          <DialogHeader className="border-b border-[#013765] bg-[#013765] px-6 py-4 text-white">
            <DialogTitle className="flex items-center gap-2 text-white">
              <History className="h-5 w-5 text-white" />
              Auditoría del chat
            </DialogTitle>
            <DialogDescription className="text-blue-100">
              Historial completo de acciones y cambios registrados en esta conversación.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(85vh-124px)] overflow-y-auto px-6 py-5">
            <input
              type="search"
              value={auditSearch}
              onChange={(event) => setAuditSearch(event.target.value)}
              placeholder="Buscar por usuario, acción o contenido..."
              className="mb-5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#2b5f90] focus:ring-2 focus:ring-[#2b5f90]/20"
              aria-label="Buscar en la auditoría del chat"
            />
            {auditLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando auditoría...
              </div>
            ) : auditLogs.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">No hay eventos registrados para este chat.</p>
            ) : filteredAuditLogs.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">No se encontraron eventos para esa búsqueda.</p>
            ) : (
              <div className="relative space-y-5">
                <div className="pointer-events-none absolute bottom-0 left-[6.75rem] top-0 w-0.5 -translate-x-1/2 bg-[#6d9bc2]" />
                {filteredAuditLogs.map((entry) => {
                  const changes = Array.isArray(entry.properties?.changes_human) ? entry.properties.changes_human : []
                  return (
                    <div key={entry.id} className="grid grid-cols-[5.5rem_1rem_minmax(0,1fr)] items-stretch gap-3">
                      <div className="pt-0.5 text-right">
                        <p className="break-words text-xs font-bold leading-tight text-[#013765]">{entry.causer_name ?? "Sistema"}</p>
                        <p className="mt-1 text-xs font-medium leading-tight text-slate-500">{formatDateSafe(entry.created_at)}</p>
                      </div>
                      <div className="relative min-h-full">
                        <span className="absolute left-1/2 top-1 z-10 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-white bg-[#013765] ring-2 ring-[#9fc0da]" />
                      </div>
                      <div className="rounded-lg border border-slate-300 bg-white p-4 shadow-md">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">{entry.description}</p>
                          <span className="rounded-full border border-[#9fc0da] bg-[#e7f0f8] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#013765]">{entry.event}</span>
                        </div>
                        {changes.length > 0 && (
                          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                            {changes.map((change: any, index: number) => (
                              <div key={`${entry.id}-${change.key ?? index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-3 text-xs">
                                <span className="font-medium text-slate-600">{change.label ?? change.key}</span>
                                <span className="text-slate-500">
                                  {change.value !== undefined && change.value !== null
                                    ? String(change.value)
                                    : <>{String(change.before ?? "Sin dato")} <span className="px-1 text-slate-400">→</span> {String(change.after ?? "Sin dato")}</>}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div className="flex h-[72px] items-center justify-between gap-3 px-4 border-b border-gray-300 bg-gray-100">
        <h2 className="text-lg font-semibold text-foreground">Información del Chat</h2>
        {canViewAudit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 shrink-0 gap-1.5 bg-white px-2.5"
            disabled={auditLoading}
            onClick={loadAudit}
            title="Ver auditoría del chat"
            aria-label="Ver auditoría del chat"
          >
            {auditLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="flex flex-col p-4">
          {/* Contacto */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="relative mb-3">
              <Avatar className="h-16 w-16 overflow-hidden bg-[#2b5f90] text-white flex items-center justify-center">
                {chat.avatar && !contactAvatarFailed ? (
                  <img
                    src={chat.avatar}
                    alt={chat.name}
                    className="h-full w-full object-cover"
                    onError={() => setContactAvatarFailed(true)}
                  />
                ) : (
                  <User className="h-6 w-6" />
                )}
              </Avatar>
            </div>
            <h3 className="font-semibold text-foreground text-lg">{chat.name}</h3>
            <p className="text-sm text-muted-foreground">{chat.number}</p>
            {chat.channel === "webchat" ? <p className="mt-1 text-xs font-medium text-[#013765]">Canal: Webchat</p> : null}

            {chat.unread > 0 && (
              <Badge variant="secondary" className="mt-2 bg-[#013765] text-white">
                {chat.unread} mensajes sin leer
              </Badge>
            )}
          </div>

          {lastReassignmentReason && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Chat reasignado · Motivo</p>
              <p className="mt-1 break-words text-xs leading-5 text-slate-700">{lastReassignmentReason}</p>
            </div>
          )}

          {/* Acciones */}
          {(canUseBotControls || canFinishAttention || canTakeChat || (canReassign && chat.status === "open") || canAdminister) && (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
              <h4 className="mb-3 flex items-center gap-2 font-medium text-slate-800">
                <Zap className="h-4 w-4 text-[#013765]" />
                Acciones
              </h4>
              {canUseBotControls && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 w-full border-[#013765] bg-[#013765] px-2 text-white hover:bg-[#024a8a] hover:text-white"
                    onClick={handleToggleBot}
                    disabled={togglingBot || resettingBot || !canUseBotControls}
                    title={botEnabled ? "Pausar bot" : "Reanudar bot"}
                  >
                    {togglingBot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : botEnabled ? <PowerOff className="h-3.5 w-3.5 text-white" /> : <Power className="h-3.5 w-3.5 text-white" />}
                    <span className="ml-1.5 text-xs">{botEnabled ? "Pausar bot" : "Reanudar bot"}</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 w-full border-[#013765] bg-[#013765] px-2 text-white hover:bg-[#024a8a] hover:text-white"
                    onClick={handleResetBot}
                    disabled={togglingBot || resettingBot || !canUseBotControls}
                    title="Reiniciar flujo"
                  >
                    {resettingBot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 text-white" />}
                    <span className="ml-1.5 text-xs">Reiniciar flujo</span>
                  </Button>
                </div>
              )}
              {canTakeChat && (
                <Button
                  type="button"
                  size="sm"
                  className="mt-2 w-full border-[#013765] bg-[#013765] text-white hover:bg-[#024a8a] hover:text-white"
                  onClick={onTakeChat}
                  disabled={takingChat}
                >
                  {takingChat ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-1.5 h-3.5 w-3.5" />}
                  {takingChat ? "Tomando chat…" : "Tomar chat"}
                </Button>
              )}
              {(canReassign || canAdminister) && (
                <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                  {canReassign && chat.status === "open" ? (
                    <>
                      <Button type="button" size="sm" variant="outline" className="w-full border-[#013765] bg-[#013765] text-white hover:bg-[#024a8a] hover:text-white" disabled={adminBusy} onClick={() => reassignChat(false)}><Users className="mr-1.5 h-3.5 w-3.5" /> Reasignar</Button>
                    </>
                  ) : null}
                  {canAdminister && chat.status === "open" ? (
                    <>
                      <Button type="button" size="sm" variant="outline" className="w-full border-[#013765] bg-[#013765] text-white hover:bg-[#024a8a] hover:text-white" disabled={adminBusy} onClick={() => changeLifecycle("archive")}>
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Finalizar atención
                      </Button>
                    </>
                  ) : canAdminister ? (
                    <Button type="button" size="sm" variant="outline" className="w-full border-[#013765] bg-[#013765] text-white hover:bg-[#024a8a] hover:text-white" disabled={adminBusy} onClick={() => changeLifecycle("reopen")}>
                      <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" /> Reabrir con bot
                    </Button>
                  ) : null}
                  {adminMessage ? <p className="text-[11px] text-slate-600">{adminMessage}</p> : null}
                </div>
              )}
              {canFinishAttention && !canAdminister && (
                <Button
                  type="button"
                  size="sm"
                  className="mt-2 w-full border-[#013765] bg-[#013765] text-white hover:bg-[#024a8a] hover:text-white"
                  onClick={() => setFinishAttentionOpen(true)}
                  disabled={finishingAttention}
                >
                  {finishingAttention ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                  {finishingAttention ? "Finalizando atención..." : "Finalizar atención"}
                </Button>
              )}
            </div>
          )}

          {/* Información general */}
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
            <h4 className="mb-3 flex items-center gap-2 font-medium text-slate-800">
              <Bot className="h-4 w-4 text-[#013765]" />
              Información general
            </h4>

            <div className="grid grid-cols-1 gap-2 bg-white md:grid-cols-2">
              <div className="rounded-md bg-white">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">BOT</div>
                <div className="space-y-2">
                  <Badge variant="secondary" className={botEnabled ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}>
                    {botEnabled ? "Activado" : "Pausado"}
                  </Badge>
                </div>
              </div>

              <div className="rounded-md bg-white">
                <div className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase mb-1">RED</div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Canal en tiempo real:{" "}
                  <span className="inline-flex items-center gap-1 text-foreground font-medium">
                    <span className={`inline-block h-2 w-2 rounded-full ${mqttStatusMeta.dot}`} />
                    {mqttStatusMeta.label}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Último evento: <span className="text-foreground font-medium">{formatDateSafe(mqttLastEventAt)}</span>
                </div>
              </div>

              <div className="rounded-md bg-white">
                <div className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase mb-1">TOTAL MENSAJES</div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  {totalMessages === null ? "Cargando..." : totalMessages}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Variables: <span className="text-foreground font-medium">{totalVarsCount}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Con archivos: <span className="text-foreground font-medium">{media.length}</span>
                </div>
              </div>

              <div className="rounded-md bg-white">
                <div className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase mb-1">ÚLTIMO MENSAJE</div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatRelativeSafe(lastMessageAt)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{formatDateSafe(lastMessageAt)}</div>
              </div>
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
            <h4 className="mb-3 flex items-center gap-2 font-medium text-slate-800">
              <Clock3 className="h-4 w-4 text-[#013765]" />
              Estado operativo
            </h4>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-slate-700">
              <span className="text-slate-500">Atención</span><span className="font-medium">{attentionStatusLabel(chat.attention_status)}</span>
              <span className="text-slate-500">Operador</span><span className="truncate font-medium">{chat.operator_name ?? "Sin asignar"}</span>
              <span className="text-slate-500">Asignado desde</span><span className="font-medium">{formatDateSafe(chat.assigned_at)}</span>
              <span className="text-slate-500">Cierre</span><span className="font-medium">{formatDateSafe(chat.closed_at)}</span>
              {chat.attention_status === "archived" && (
                <>
                  <span className="text-slate-500">Archivado por</span>
                  <span className="truncate font-medium">{chat.closed_by === "system" ? "Sistema" : chat.last_operator_name ?? (chat.last_operator_id ? `Operador #${chat.last_operator_id}` : "Sistema")}</span>
                </>
              )}
              <span className="text-slate-500">Flujo</span><span className="truncate font-medium">{chat.bot_flow_name ?? "Sin flujo"}</span>
              <span className="text-slate-500">Nombre del nodo</span><span className="truncate font-medium">{chat.bot_node_name ?? "Sin nodo configurado"}</span>
            </div>

          </div>

          {/* Variables */}
          <div className="order-2 mb-4">
            <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <Database className="h-4 w-4" />
              Variables del Chat
            </h4>

            {!hasVars ? (
              <div className="rounded-lg p-3 border border-gray-300">
                <p className="text-sm text-muted-foreground">Todavía no hay variables capturadas en este chat.</p>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl">
                {varGroups.map((group) => (
                  <div key={group.date} className="rounded-lg border border-gray-200 bg-white p-2.5">
                    <button
                      type="button"
                      className="mb-2 w-full flex items-center justify-between text-left"
                      onClick={() => {
                        const willExpand = expandedVarDate !== group.date
                        setExpandedVarDate((prev) => (prev === group.date ? null : group.date))
                        if (willExpand) {
                          window.dispatchEvent(new CustomEvent("chat:scrollToDate", {
                            detail: {
                              chatId: String(chat.id),
                              dateKey: group.date,
                            },
                          }))
                        }
                      }}
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {formatDateOnlySafe(`${group.date}T00:00:00`)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">{group.vars.length}</span>
                        {expandedVarDate === group.date ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                    </button>
                    {expandedVarDate === group.date && (
                      <div className="space-y-2">
                        {group.vars.map((variable) => {
                          const t = (variable.type as VarType) ?? detectType(variable.value)
                          return (
                            <button
                              type="button"
                              key={`${group.date}:${variable.name}`}
                              className="w-full text-left rounded-md border border-gray-200 px-3 py-2"
                              onClick={() => {
                                window.dispatchEvent(new CustomEvent("chat:scrollToVar", {
                                  detail: {
                                    chatId: String(chat.id),
                                    dateKey: group.date,
                                    updatedAt: variable.updated_at ?? null,
                                    varName: variable.name,
                                  },
                                }))
                              }}
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
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Medios */}
          <div className="order-1 mb-4">
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
              <MediaTabBtn label="Audio" value="audio" icon={<AudioLines className="h-4 w-4" />} count={mediaCounts.audio} />
              <MediaTabBtn
                label="Docs"
                value="document"
                icon={<FileText className="h-4 w-4" />}
                count={mediaCounts.document}
              />
              <MediaTabBtn
                label="Contactos"
                value="contacts"
                icon={<Contact className="h-4 w-4" />}
                count={mediaCounts.contacts}
              />
              <MediaTabBtn
                label="Ubicaciones"
                value="location"
                icon={<MapPin className="h-4 w-4" />}
                count={mediaCounts.location}
              />
            </div>

            {mediaFiltered.length === 0 ? (
              <div className="bg-white rounded-lg p-3 border border-gray-300">
                <p className="text-sm text-muted-foreground">Todavía no hay medios en este chat.</p>
              </div>
            ) : (
              <div className="border rounded-lg p-3 bg-white">
                <Gallery withCaption onOpen={addMediaThumbnails} options={{ bgOpacity: 1, closeOnVerticalDrag: true, imageClickAction: "zoom", doubleTapAction: "zoom", secondaryZoomLevel: 2 }}>
                <div className="grid grid-cols-2 gap-2">
                  {mediaFiltered.slice(0, 90).map((m) => {
                    const url = m.media_url ? resolveMediaUrl(m.media_url) : ""
                    const name = m.media_name ?? `${m.message_type} #${m.id}`

                    if (m.message_type === "contacts") {
                      const contactData = getContactCardData(m)

                      return (
                        <button
                          key={m.id}
                          type="button"
                          title={contactData.name}
                          className="block text-left"
                          onClick={() =>
                            setPreview({
                              type: "contacts",
                              name: contactData.name,
                              contact: contactData,
                            })
                          }
                        >
                          <MediaCard name={contactData.name}>
                            <div className="flex h-24 flex-col items-center justify-center gap-1 px-3 text-center">
                              <Contact className="h-6 w-6 shrink-0 text-[#013765]" />
                              <div className="line-clamp-2 w-full break-words text-[11px] font-semibold leading-tight text-slate-700">
                                {contactData.name}
                              </div>
                              {contactData.phone ? (
                                <div className="w-full truncate text-[10px] text-muted-foreground">
                                  {contactData.phone}
                                </div>
                              ) : null}
                            </div>
                          </MediaCard>
                        </button>
                      )
                    }

                    if (m.message_type === "location") {
                      const locationData = getLocationCardData(m)

                      return (
                        <button
                          key={m.id}
                          type="button"
                          title={locationData.name}
                          className="block text-left"
                          onClick={() =>
                            setPreview({
                              type: "location",
                              name: locationData.name,
                              location: locationData,
                            })
                          }
                        >
                          <MediaCard name={locationData.name}>
                            <div className="flex h-24 flex-col items-center justify-center gap-1 px-3 text-center">
                              <MapPin className="h-6 w-6 shrink-0 text-[#013765]" />
                              <div className="line-clamp-2 w-full break-words text-[11px] font-semibold leading-tight text-slate-700">
                                {locationData.name}
                              </div>
                              {locationData.address ? (
                                <div className="line-clamp-1 w-full text-[10px] text-muted-foreground">
                                  {locationData.address}
                                </div>
                              ) : null}
                            </div>
                          </MediaCard>
                        </button>
                      )
                    }

                    if (m.message_type === "image") {
                      const dimensions = mediaDimensions[String(m.id)] ?? { width: 1600, height: 1200 }
                      return (
                        <Item key={m.id} original={url} thumbnail={url} width={dimensions.width} height={dimensions.height} alt={name} caption={name} content={<WebchatGalleryImage src={url} alt={name} />}>
                          {({ ref, open }) => <button ref={ref} type="button" onClick={open} className="text-left" title={name}><MediaCard name={name}><img src={url} alt={name} onLoad={(event) => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setMediaDimensions((current) => current[String(m.id)]?.width === image.naturalWidth && current[String(m.id)]?.height === image.naturalHeight ? current : { ...current, [String(m.id)]: { width: image.naturalWidth, height: image.naturalHeight } }) }} className="h-24 w-full object-cover" loading="lazy" /></MediaCard></button>}
                        </Item>
                      )
                    }

                    if (m.message_type === "video") {
                      const vidThumb = videoThumbs[String(m.id)]

                      return (
                        <Item key={m.id} original={url} width="2400" height="1350" alt={name} caption={name} content={<WebchatGalleryVideo src={url} />}>
                          {({ ref, open }) => <button ref={ref} type="button" onClick={open} className="text-left" title={name}><MediaCard name={name}>{vidThumb ? <div className="relative h-24 w-full"><img src={vidThumb} className="h-24 w-full object-cover" alt={name} loading="lazy" /><div className="absolute inset-0 flex items-center justify-center"><div className="rounded-full bg-black/50 p-2"><Video className="h-5 w-5 text-white" /></div></div></div> : <div className="flex h-24 w-full flex-col items-center justify-center gap-1"><Video className="h-6 w-6 text-muted-foreground" /><div className="text-[10px] text-muted-foreground">Cargando vista previa...</div></div>}</MediaCard></button>}
                        </Item>
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
                              <AudioLines className="h-6 w-6 text-muted-foreground" />
                              <div className="text-[10px] text-muted-foreground">Reproducir</div>
                            </div>
                          </MediaCard>
                        </button>
                      )
                    }

                    // document
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPreview({ url, name, type: "document" })}
                        title={name}
                        className="block text-left"
                      >
                        <MediaCard name={name}>
                          <div className="flex flex-col items-center justify-center gap-2 px-2">
                            <FileText className="h-6 w-6 text-muted-foreground" />
                            <div className="w-full max-w-full text-[11px] text-muted-foreground text-center break-all line-clamp-2">
                              {name}
                            </div>
                          </div>
                        </MediaCard>
                      </button>
                    )
                  })}
                </div>
                </Gallery>
              </div>
            )}

            {/* Preview modal */}
            {preview && (
              <div
                className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
                onClick={() => setPreview(null)}
              >
                <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#013765]/10 text-[#013765]">
                          {preview.type === "image" ? (
                            <ImageIcon className="h-5 w-5" />
                          ) : preview.type === "video" ? (
                            <Video className="h-5 w-5" />
                          ) : preview.type === "audio" ? (
                            <AudioLines className="h-5 w-5" />
                          ) : preview.type === "contacts" ? (
                            <Contact className="h-5 w-5" />
                          ) : preview.type === "location" ? (
                            <MapPin className="h-5 w-5" />
                          ) : (
                            <FileText className="h-5 w-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Vista previa · {preview.type === "image"
                              ? "Imagen"
                              : preview.type === "video"
                                ? "Video"
                                : preview.type === "audio"
                                  ? "Audio"
                                  : preview.type === "contacts"
                                    ? "Contacto"
                                    : preview.type === "location"
                                      ? "Ubicacion"
                                  : "Documento"}
                          </div>
                          <div className="truncate text-sm font-semibold text-slate-900">{preview.name}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setPreview(null)}
                          className="h-9 w-9 rounded-lg border-slate-200 bg-white p-0"
                          title="Cerrar vista previa"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="bg-slate-950">
                      {preview.type === "image" && (
                        <div className="flex max-h-[78vh] min-h-[320px] items-center justify-center p-3">
                          <img src={preview.url ?? ""} alt={preview.name} className="max-h-[75vh] w-full object-contain" />
                        </div>
                      )}

                      {preview.type === "video" && (
                        <div className="flex max-h-[78vh] min-h-[320px] items-center justify-center p-3">
                          <video autoPlay controls playsInline preload="metadata" className="max-h-[75vh] w-full rounded-xl bg-black object-contain">
                            <source src={preview.url ?? ""} />
                          </video>
                        </div>
                      )}

                      {preview.type === "audio" && (
                        <div className="bg-white p-6">
                          <div className="mx-auto max-w-xl rounded-2xl bg-slate-100 p-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-[#013765] shadow-sm">
                                <AudioLines className="h-6 w-6" />
                              </div>
                              <audio controls className="min-w-0 flex-1">
                                <source src={preview.url ?? ""} />
                              </audio>
                            </div>
                          </div>
                        </div>
                      )}

                      {preview.type === "contacts" && (
                        <div className="bg-white p-6">
                          <ContactPreviewCard
                            contact={preview.contact ?? { name: preview.name, phone: "" }}
                          />
                        </div>
                      )}

                      {preview.type === "location" && preview.location && (
                        <div className="bg-white p-6">
                          <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                            {preview.location.isValid ? (
                              <div className="relative h-[420px] w-full overflow-hidden bg-slate-100">
                                <LocationPreviewMap
                                  latitude={preview.location.latitude}
                                  longitude={preview.location.longitude}
                                />
                              </div>
                            ) : (
                              <div className="flex h-64 items-center justify-center bg-slate-100 text-[#013765]">
                                <MapPin className="h-10 w-10" />
                              </div>
                            )}
                            <div className="flex items-start gap-3 p-4">
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[#013765] shadow-sm">
                                <MapPin className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-slate-900">{preview.location.name}</p>
                                {preview.location.address ? (
                                  <p className="mt-1 text-sm font-medium leading-relaxed text-slate-600">{preview.location.address}</p>
                                ) : null}
                                {preview.location.isValid ? (
                                  <p className="mt-1 text-xs font-medium text-slate-500">
                                    {preview.location.latitude.toFixed(6)}, {preview.location.longitude.toFixed(6)}
                                  </p>
                                ) : null}
                              </div>
                              {preview.location.isValid ? (
                                <a
                                  href={getLocationMapsUrl(preview.location)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#013765] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#012e54]"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Abrir en Google Maps
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )}

                      {preview.type === "document" && (
                        <div className="bg-white">
                          {isPreviewableDocument(preview.name, preview.url ?? "") ? (
                            <iframe
                              src={preview.url ?? ""}
                              title={preview.name}
                              className="h-[78vh] w-full bg-white"
                            />
                          ) : (
                            <div className="flex min-h-[320px] items-center justify-center p-6">
                              <div className="max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
                                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#013765] shadow-sm">
                                  <FileText className="h-7 w-7" />
                                </div>
                                <p className="mb-2 text-sm font-semibold text-slate-900">{preview.name}</p>
                                <p className="mb-4 text-sm text-slate-500">
                                  Vista previa no disponible para este formato.
                                </p>
                                <a
                                  href={preview.url ?? ""}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-2 rounded-lg bg-[#013765] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#012e54]"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  Abrir documento
                                </a>
                              </div>
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
          {/* fin Medios */}
        </div>
      </div>
    </div>
  )
}
