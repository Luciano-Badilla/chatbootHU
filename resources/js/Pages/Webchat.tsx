import { FormEvent, type ReactNode, useEffect, useRef, useState } from "react"
import mqtt from "mqtt"
import { Gallery, Item } from "react-photoswipe-gallery"
import "photoswipe/dist/photoswipe.css"
import { ArrowUp, AudioLines, Bell, BellOff, Check, ChevronDown, Clock3, Contact, FileText, Headset, ImageIcon, Info, Loader2, MapPin, Menu, MessageCircle, Mic, Play, Plus, Search, Send, Share, ShieldCheck, Square, User, WifiOff, Wrench, X } from "lucide-react"
import { toast } from "sonner"

type Option = { id: string; label: string; description?: string; kind?: string }
type RetryPayload = { message: string; optionId?: string }
type Message = { id: number | string; sender: "contact" | "user"; sender_subtype?: "contact" | "operator" | "bot"; operator_name?: string | null; body: string | null; created_at?: string; timestamp?: string; message_type?: string | null; media_url?: string | null; media_name?: string | null; interactive_options?: Option[] | null; delivery_status?: "sending" | "failed"; retry_payload?: RetryPayload }
type WebchatSettings = { enabled: boolean; available: boolean; title: string; subtitle: string; logo_url: string; offline_message: string }
type PendingMedia = { id: string; file: File; previewUrl: string; type: "image" | "video" }
type LocationDraft = { latitude: number; longitude: number; name: string; address: string }
type LocationSearchResult = LocationDraft & { id: string }
type DeviceContact = { name?: string[]; tel?: string[] }
type ContactPicker = { getProperties: () => Promise<string[]>; select: (properties: string[], options?: { multiple?: boolean }) => Promise<DeviceContact[]> }

const MAX_ATTACHMENTS_PER_SEND = 5
const MAX_FILE_BYTES = { image: 10 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 16 * 1024 * 1024, document: 25 * 1024 * 1024 }
const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"]
const humanFileSize = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`
const getAttachmentKind = (file: File): "image" | "video" | "audio" | "document" | null => {
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) return "image"
  if (["video/mp4", "video/quicktime", "video/webm"].includes(file.type)) return "video"
  if (["audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm"].includes(file.type)) return "audio"
  const extension = file.name.split(".").pop()?.toLowerCase()
  return extension && DOCUMENT_EXTENSIONS.includes(extension) ? "document" : null
}

const SESSION_KEY = "hu.webchat.resume_token"
const publicAssetUrl = (path: string) => path.startsWith("http") ? path : `${import.meta.env.VITE_APP_URL}${path}`

function WebchatMessagesLoader() {
  const placeholders = [
    { side: "left", width: "w-[220px] sm:w-[260px]", lines: ["w-40", "w-28"] },
    { side: "right", width: "w-[250px] sm:w-[330px]", lines: ["w-52", "w-36"] },
    { side: "left", width: "w-[200px] sm:w-[240px]", lines: ["w-32", "w-20"] },
  ]

  return <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-5 py-5 sm:py-7">
    <div className="mx-auto mb-auto mt-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#003f73]/50" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#003f73]" /></span>
      Cargando conversación
    </div>
    {placeholders.map((item, index) => <div key={index} className={`flex items-start gap-3 ${item.side === "right" ? "justify-end" : "justify-start"}`}>
      {item.side === "left" ? <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[#2b5f90]/25" /> : null}
      <div className={`rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ${item.width}`}>
        {item.lines.map((line, lineIndex) => <div key={lineIndex} className={`h-3 animate-pulse rounded-full bg-slate-300/80 ${line}${lineIndex ? " mt-2" : ""}`} />)}
        <div className="mt-3 h-2 w-12 animate-pulse rounded-full bg-slate-300/60" />
      </div>
      {item.side === "right" ? <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[#003f73]/25" /> : null}
    </div>)}
  </div>
}

function WebchatLocationMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const pinRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!mapRef.current) return

    let cancelled = false
    let map: any = null
    const win = window as Window & { L?: any; __leafletLoading?: Promise<any> }

    const loadLeaflet = () => {
      if (win.L) return Promise.resolve(win.L)
      if (win.__leafletLoading) return win.__leafletLoading
      win.__leafletLoading = new Promise((resolve, reject) => {
        if (!document.querySelector('link[data-leaflet="true"]')) {
          const stylesheet = document.createElement("link")
          stylesheet.rel = "stylesheet"
          stylesheet.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          stylesheet.dataset.leaflet = "true"
          document.head.appendChild(stylesheet)
        }
        const script = document.createElement("script")
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        script.async = true
        script.onload = () => win.L ? resolve(win.L) : reject(new Error("Leaflet no disponible"))
        script.onerror = () => reject(new Error("No se pudo cargar Leaflet"))
        document.head.appendChild(script)
      })
      return win.__leafletLoading
    }

    loadLeaflet().then((L) => {
      if (cancelled || !mapRef.current) return
      map = L.map(mapRef.current, { attributionControl: false, zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, zoomAnimation: false, fadeAnimation: false }).setView([latitude, longitude], 15)
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map)
      const updatePin = () => {
        if (!pinRef.current) return
        const point = map.latLngToContainerPoint(L.latLng(latitude, longitude))
        pinRef.current.style.left = `${point.x}px`
        pinRef.current.style.top = `${point.y}px`
      }
      map.on("move zoom resize viewreset", updatePin)
      updatePin()
      window.setTimeout(() => { map?.invalidateSize?.(); updatePin() }, 80)
    }).catch(() => undefined)

    return () => {
      cancelled = true
      map?.remove?.()
      map = null
    }
  }, [latitude, longitude])

  return <div className="relative isolate h-36 w-full overflow-hidden rounded-xl bg-slate-200"><div ref={mapRef} className="pointer-events-none h-full w-full" /><span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-black/10" /><span ref={pinRef} className="pointer-events-none absolute z-[910] grid h-9 w-9 -translate-x-1/2 -translate-y-full place-items-center rounded-full bg-[#003f73] text-white shadow-lg ring-4 ring-white"><MapPin className="h-4 w-4 fill-current" /></span></div>
}

function WebchatLocationPicker({ value, onChange }: { value: LocationDraft | null; onChange: (location: LocationDraft) => void }) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const mapInstanceRef = useRef<any>(null)
  const pinRef = useRef<HTMLSpanElement | null>(null)
  const selectedPositionRef = useRef<{ latitude: number; longitude: number } | null>(null)

  const updatePinPosition = () => {
    const map = mapInstanceRef.current
    const L = (window as Window & { L?: any }).L
    const position = selectedPositionRef.current
    if (!map || !L || !pinRef.current || !position) return
    const point = map.latLngToContainerPoint(L.latLng(position.latitude, position.longitude))
    pinRef.current.style.left = `${point.x}px`
    pinRef.current.style.top = `${point.y}px`
    pinRef.current.style.opacity = "1"
  }

  const movePin = (latitude: number, longitude: number, zoom = 16) => {
    const map = mapInstanceRef.current
    if (!map) return
    selectedPositionRef.current = { latitude, longitude }
    map.flyTo([latitude, longitude], Math.max(map.getZoom(), zoom), { duration: 0.3 })
    updatePinPosition()
  }

  useEffect(() => {
    if (!mapRef.current) return
    let cancelled = false
    const win = window as Window & { L?: any; __leafletLoading?: Promise<any> }
    const loadLeaflet = () => {
      if (win.L) return Promise.resolve(win.L)
      if (win.__leafletLoading) return win.__leafletLoading
      win.__leafletLoading = new Promise((resolve, reject) => {
        if (!document.querySelector('link[data-leaflet="true"]')) {
          const stylesheet = document.createElement("link")
          stylesheet.rel = "stylesheet"
          stylesheet.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          stylesheet.dataset.leaflet = "true"
          document.head.appendChild(stylesheet)
        }
        const script = document.createElement("script")
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        script.async = true
        script.onload = () => win.L ? resolve(win.L) : reject(new Error("Leaflet no disponible"))
        script.onerror = () => reject(new Error("No se pudo cargar Leaflet"))
        document.head.appendChild(script)
      })
      return win.__leafletLoading
    }

    loadLeaflet().then((L) => {
      if (cancelled || !mapRef.current) return
      const initial = value ?? { latitude: -32.889459, longitude: -68.845839 }
      const map = L.map(mapRef.current, { zoomControl: false }).setView([initial.latitude, initial.longitude], value ? 16 : 12)
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map)
      L.control.zoom({ position: "bottomright" }).addTo(map)
      map.on("click", (event: any) => onChange({ latitude: Number(event.latlng.lat.toFixed(6)), longitude: Number(event.latlng.lng.toFixed(6)), name: "Ubicación seleccionada", address: "" }))
      map.on("move zoom resize viewreset", updatePinPosition)
      mapInstanceRef.current = map
      if (value) movePin(value.latitude, value.longitude)
      window.setTimeout(() => map.invalidateSize(), 100)
    }).catch(() => undefined)

    return () => {
      cancelled = true
      mapInstanceRef.current?.remove?.()
      mapInstanceRef.current = null
      selectedPositionRef.current = null
    }
  }, [])

  useEffect(() => {
    if (value) movePin(value.latitude, value.longitude)
  }, [value?.latitude, value?.longitude])

  return <div className="relative h-72 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-inner sm:h-[390px]"><div ref={mapRef} className="h-full w-full" /><span ref={pinRef} className="pointer-events-none absolute z-[910] grid h-11 w-11 -translate-x-1/2 -translate-y-full place-items-center rounded-full bg-[#003f73] text-white opacity-0 shadow-lg ring-4 ring-white"><MapPin className="h-5 w-5 fill-current" /></span><span className="pointer-events-none absolute left-3 top-3 rounded-xl bg-white/95 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm">Tocá el mapa para elegir una ubicación</span></div>
}

function WebchatModal({ open, children, className = "", cardClassName = "" }: { open: boolean; children: ReactNode; className?: string; cardClassName?: string }) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    setClosing(true)
    const timer = window.setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [open, mounted])

  if (!mounted) return null
  return <div className={`webchat-modal-backdrop absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-[1px]${closing ? " webchat-modal-backdrop--closing" : ""} ${className}`}><div className={`webchat-modal-card${closing ? " webchat-modal-card--closing" : ""} ${cardClassName}`}>{children}</div></div>
}

function WebchatGalleryImage({ src, alt }: { src: string; alt: string }) {
  const [loading, setLoading] = useState(true)
  return <div className="relative flex h-full w-full items-center justify-center bg-slate-950"><img src={src} alt={alt} onLoad={() => setLoading(false)} onError={() => setLoading(false)} className="h-auto w-auto max-h-[82vh] max-w-[96vw] object-contain" />{loading ? <span className="absolute inset-0 grid place-items-center bg-slate-950/70 text-white"><Loader2 className="h-9 w-9 animate-spin" /><span className="sr-only">Cargando imagen</span></span> : null}</div>
}

function WebchatGalleryVideo({ src }: { src: string }) {
  const [loading, setLoading] = useState(true)
  return <div className="relative flex h-full w-full items-center justify-center bg-slate-950"><video src={src} controls autoPlay playsInline onLoadedData={() => setLoading(false)} onError={() => setLoading(false)} className="h-auto w-auto max-h-[82vh] max-w-[96vw] object-contain" />{loading ? <span className="absolute inset-0 grid place-items-center bg-slate-950/70 text-white"><Loader2 className="h-9 w-9 animate-spin" /><span className="sr-only">Cargando video</span></span> : null}</div>
}

function WebchatBottomSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const [sheetHeight, setSheetHeight] = useState(70)
  const dragStartRef = useRef<number | null>(null)
  const dragStartHeightRef = useRef(70)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      setDragOffset(0)
      setSheetHeight(70)
      return
    }
    if (!mounted) return
    setClosing(true)
    const timer = window.setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, 190)
    return () => window.clearTimeout(timer)
  }, [open, mounted])

  if (!mounted) return null
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (closing) return
    dragStartRef.current = event.clientY
    dragStartHeightRef.current = sheetHeight
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return
    const distance = event.clientY - dragStartRef.current
    if (distance > 0) {
      setDragOffset(distance)
      return
    }

    setDragOffset(0)
    const viewportHeight = Math.max(window.innerHeight, 1)
    const nextHeight = dragStartHeightRef.current + (-distance / viewportHeight) * 100
    setSheetHeight(Math.min(92, Math.max(58, nextHeight)))
  }
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    const distance = event.clientY - dragStartRef.current
    dragStartRef.current = null
    setDragOffset(0)
    if (distance > 90) onClose()
    else setSheetHeight((current) => current >= 81 ? 92 : 70)
  }

  return <div onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} className={`webchat-modal-backdrop absolute inset-0 z-30 flex items-end bg-black/45 backdrop-blur-[1px]${closing ? " webchat-modal-backdrop--closing" : ""}`}><div role="dialog" aria-modal="true" aria-label="Información de la conversación" style={{ height: `${sheetHeight}dvh`, transform: dragOffset ? `translateY(${dragOffset}px)` : undefined }} className={`webchat-bottom-sheet w-full overflow-y-auto rounded-t-[28px] bg-white shadow-2xl${closing ? " webchat-bottom-sheet--closing" : ""}`}><div onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} className="flex h-8 cursor-grab touch-none items-center justify-center active:cursor-grabbing"><span className="h-1.5 w-11 rounded-full bg-slate-200" /></div>{children}</div></div>
}

export default function Webchat({ webchat }: { webchat: WebchatSettings }) {
  const [token, setToken] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [profileRequired, setProfileRequired] = useState(true)
  const [name, setName] = useState("")
  const [draft, setDraft] = useState("")
  const [failedOutgoing, setFailedOutgoing] = useState<RetryPayload | null>(null)
  const [enteringMessageId, setEnteringMessageId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [mqttStatus, setMqttStatus] = useState<"connecting" | "connected" | "reconnecting" | "offline" | "error">("connecting")
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [operatorName, setOperatorName] = useState("")
  const [botEnabled, setBotEnabled] = useState(true)
  const [chatStatus, setChatStatus] = useState<"open" | "closed">("open")
  const [closedBy, setClosedBy] = useState<string | null>(null)
  const [closedByName, setClosedByName] = useState<string | null>(null)
  const [channelAvailability, setChannelAvailability] = useState(() => ({ enabled: webchat.enabled, available: webchat.available }))
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() => typeof window === "undefined" || !("Notification" in window) ? "unsupported" : Notification.permission)
  const [isIos, setIsIos] = useState(false)
  const [showIosInstallHelp, setShowIosInstallHelp] = useState(false)
  const [isClosingIosInstallHelp, setIsClosingIosInstallHelp] = useState(false)
  const [infoSheetOpen, setInfoSheetOpen] = useState(false)
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({})
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [fileAccept, setFileAccept] = useState("")
  const [contactModalOpen, setContactModalOpen] = useState(false)
  const [contactName, setContactName] = useState("")
  const [contactPhone, setContactPhone] = useState("")
  const [selectingDeviceContact, setSelectingDeviceContact] = useState(false)
  const [deviceContactPickerAvailable, setDeviceContactPickerAvailable] = useState(false)
  const [locationModalOpen, setLocationModalOpen] = useState(false)
  const [locationDraft, setLocationDraft] = useState<LocationDraft | null>(null)
  const [locationQuery, setLocationQuery] = useState("")
  const [locationResults, setLocationResults] = useState<LocationSearchResult[]>([])
  const [locationSearching, setLocationSearching] = useState(false)
  const [locationDetecting, setLocationDetecting] = useState(false)
  const [mediaDimensions, setMediaDimensions] = useState<Record<string, { width: number; height: number }>>({})
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([])
  const [recordingAudio, setRecordingAudio] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const scrollToInitialMessagesRef = useRef(false)
  const scrollToNewMessageRef = useRef(false)
  const notifiedMessageIdsRef = useRef(new Set<string>())
  const optionSelectionLockRef = useRef(new Set<string>())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentMenuRef = useRef<HTMLDivElement | null>(null)
  const mediaRecorderRef = useRef<any | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const discardAudioRecordingRef = useRef(false)
  const startingAudioRecordingRef = useRef(false)

  const api = async (path: string, data: Record<string, unknown>) => {
    const response = await fetch(`${import.meta.env.VITE_APP_URL}/api/webchat/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(json.message || "No se pudo completar la operación.")
    return json
  }

  const acknowledgeIncomingMessages = (incoming: Message[], resumeToken = token) => {
    const messageIds = incoming.filter((message) => message.sender === "user" && typeof message.id === "number").map((message) => message.id as number)
    if (!resumeToken || !messageIds.length) return

    void api("delivery", { resume_token: resumeToken, message_ids: messageIds })
      .then(() => document.visibilityState === "visible" ? api("read", { resume_token: resumeToken, message_ids: messageIds }) : null)
      .catch(() => undefined)
  }

  const formatRecordingTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
  }

  const loadOpusMediaRecorder = async () => {
    const recorderWindow = window as Window & { OpusMediaRecorder?: any; __opusMediaRecorderLoading?: Promise<any> }
    if (recorderWindow.OpusMediaRecorder) return recorderWindow.OpusMediaRecorder
    if (recorderWindow.__opusMediaRecorderLoading) return recorderWindow.__opusMediaRecorderLoading

    recorderWindow.__opusMediaRecorderLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script")
      script.src = "https://cdn.jsdelivr.net/npm/opus-media-recorder@0.8.0/OpusMediaRecorder.umd.js"
      script.async = true
      script.onload = () => recorderWindow.OpusMediaRecorder ? resolve(recorderWindow.OpusMediaRecorder) : reject(new Error("No se pudo preparar la grabación de audio."))
      script.onerror = () => reject(new Error("No se pudo preparar la grabación de audio."))
      document.head.appendChild(script)
    })

    return recorderWindow.__opusMediaRecorderLoading
  }

  const createCdnWorker = (url: string) => {
    const blobUrl = URL.createObjectURL(new Blob([`importScripts("${url}")`], { type: "application/javascript" }))
    const worker = new Worker(blobUrl)
    URL.revokeObjectURL(blobUrl)
    return worker
  }

  useEffect(() => () => {
    discardAudioRecordingRef.current = true
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current)
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  const openIosInstallHelp = () => {
    setIsClosingIosInstallHelp(false)
    setShowIosInstallHelp(true)
  }

  const closeIosInstallHelp = () => {
    setIsClosingIosInstallHelp(true)
    window.setTimeout(() => {
      setShowIosInstallHelp(false)
      setIsClosingIosInstallHelp(false)
    }, 180)
  }

  const notifyIncomingMessage = (message: Message) => {
    if (message.sender === "contact" || typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return
    const messageId = String(message.id)
    if (notifiedMessageIdsRef.current.has(messageId)) return
    notifiedMessageIdsRef.current.add(messageId)
    const sender = message.sender_subtype === "operator" ? message.operator_name || "Un operador" : webchat.title
    const body = message.message_type === "image" ? "Te envió una imagen" : message.message_type === "video" ? "Te envió un video" : message.message_type === "audio" ? "Te envió un audio" : message.message_type === "document" ? "Te envió un documento" : message.message_type === "location" ? "Te envió una ubicación" : message.message_type === "contacts" ? "Te envió un contacto" : message.body || "Tenés un mensaje nuevo"
    new Notification(sender, { body, icon: webchat.logo_url ? publicAssetUrl(webchat.logo_url) : `${import.meta.env.VITE_APP_URL}/images/hu_icon_new.png` })
  }

  const enableNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.info("Notificaciones no disponibles", {
        description: `En iPhone, agregá ${webchat.title} a la pantalla de inicio y abrilo desde su ícono.`,
        action: isIos ? <button type="button" onClick={openIosInstallHelp} aria-label="Ver cómo agregar a pantalla de inicio" className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#003f73]/20 bg-white/70 px-3 text-xs font-semibold text-[#003f73] transition hover:bg-white"><Share className="h-4 w-4" />Agregar</button> : undefined,
      })
      return
    }
    if (Notification.permission === "denied") {
      toast.info("Notificaciones bloqueadas", { description: "Habilitalas desde la configuración de notificaciones del navegador o del webchat." })
      return
    }
    try {
      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)
    } catch {
      setNotificationPermission("denied")
    }
  }

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "default") return
    Notification.requestPermission().then(setNotificationPermission).catch(() => setNotificationPermission("denied"))
  }, [])

  useEffect(() => {
    setIsIos(/iPad|iPhone|iPod/.test(navigator.userAgent))
  }, [])

  useEffect(() => {
    const contactPicker = (navigator as Navigator & { contacts?: ContactPicker }).contacts
    setDeviceContactPickerAvailable(window.isSecureContext && Boolean(contactPicker))
  }, [])

  useEffect(() => {
    const faviconUrl = webchat.logo_url ? publicAssetUrl(webchat.logo_url) : `${import.meta.env.VITE_APP_URL}/images/hu_icon_new.png`
    const favicon = document.createElement("link")
    favicon.rel = "icon"
    favicon.type = "image/png"
    favicon.href = faviconUrl
    favicon.dataset.webchatFavicon = "true"
    document.head.appendChild(favicon)

    return () => favicon.remove()
  }, [webchat.logo_url])

  const append = (message: Message) => {
    setEnteringMessageId(String(message.id))
    setMessages((current) => {
      if (current.some((item) => String(item.id) === String(message.id))) return current
      const pendingMessageIndex = message.sender === "contact"
        ? current.findIndex((item) => item.sender === "contact" && item.delivery_status === "sending" && item.body === message.body && item.message_type === message.message_type)
        : -1
      if (pendingMessageIndex >= 0) {
        return current.map((item, index) => index === pendingMessageIndex ? message : item)
      }
      notifyIncomingMessage(message)
      scrollToNewMessageRef.current = true
      return [...current, message]
    })
  }

  const syncChatAssignee = (chat: { bot_enabled?: boolean; operator_name?: string | null; status?: string; closed_by?: string | null; closed_by_name?: string | null }) => {
    const name = chat.operator_name?.trim() ?? ""
    setOperatorName(name)
    setBotEnabled(chat.bot_enabled !== false)
    const nextStatus = chat.status === "closed" ? "closed" : "open"
    setChatStatus((current) => {
      if (current !== nextStatus) scrollToNewMessageRef.current = true
      return nextStatus
    })
    setClosedBy(chat.closed_by ?? null)
    setClosedByName(chat.closed_by_name ?? null)
  }

  const loadSession = async (resumeToken: string) => {
    const data = await api("session", { resume_token: resumeToken })
    if (data.requires_profile) { setProfileRequired(true); return }
    syncChatAssignee(data.chat)
    setToken(data.resume_token)
    setProfileRequired(false)
    scrollToInitialMessagesRef.current = true
    setMessages(data.chat.messages ?? [])
    acknowledgeIncomingMessages(data.chat.messages ?? [], data.resume_token)
  }

  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY) ?? ""
    loadSession(saved).catch(() => setProfileRequired(true)).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let refreshing = false
    const refreshChannelStatus = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const data = await api("status", {})
        if (typeof data.webchat?.enabled === "boolean" && typeof data.webchat?.available === "boolean") {
          setChannelAvailability({ enabled: data.webchat.enabled, available: data.webchat.available })
        }
      } catch {
        // La configuración mostrada al cargar sigue disponible si falla la actualización.
      } finally {
        refreshing = false
      }
    }
    void refreshChannelStatus()
    const interval = window.setInterval(() => void refreshChannelStatus(), 2000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!token) return
    const markVisibleMessagesAsRead = () => {
      if (document.visibilityState === "visible") acknowledgeIncomingMessages(messages)
    }
    document.addEventListener("visibilitychange", markVisibleMessagesAsRead)
    markVisibleMessagesAsRead()
    return () => document.removeEventListener("visibilitychange", markVisibleMessagesAsRead)
  }, [token, messages])

  useEffect(() => {
    if (!token) return
    const host = import.meta.env.VITE_MOSQUITTO_HOST
    if (!host) {
      setMqttStatus("error")
      return
    }
    setMqttStatus("connecting")
    const client = mqtt.connect({
      protocol: "ws",
      host,
      port: 9001,
      clean: true,
      reconnectPeriod: 2000,
      clientId: `webchat_${token.slice(0, 12)}_${Math.random().toString(16).slice(2)}`,
    })
    client.on("connect", () => {
      setMqttStatus("connected")
      client.subscribe(`webchat/${token}`)
    })
    client.on("reconnect", () => setMqttStatus("reconnecting"))
    client.on("offline", () => setMqttStatus("offline"))
    client.on("error", () => setMqttStatus("error"))
    client.on("message", (_topic, payload) => {
      try {
        const data = JSON.parse(payload.toString())
        append({
          id: data.message_id ?? data.id,
          sender: data.sender === "user" ? "user" : "contact",
          sender_subtype: data.sender_subtype ?? (data.sender === "contact" ? "contact" : "operator"),
          operator_name: data.operator_name ?? null,
          body: data.body ?? null,
          timestamp: data.timestamp,
          message_type: data.message_type ?? "text",
          media_url: data.media_url ?? null,
          media_name: data.media_name ?? null,
          interactive_options: Array.isArray(data.interactive_options) ? data.interactive_options : null,
        })
        if (data.sender === "user") acknowledgeIncomingMessages([{ id: data.message_id ?? data.id, sender: "user", body: data.body ?? null }])
        if (data.sender_subtype === "operator" && data.operator_name) {
          setOperatorName(data.operator_name)
        }
      } catch {
        // El respaldo por consulta recuperará los mensajes en el próximo ciclo.
      }
    })
    return () => {
      client.end(true)
    }
  }, [token])

  useEffect(() => {
    if (loading || profileRequired || !scrollToInitialMessagesRef.current) return

    requestAnimationFrame(() => requestAnimationFrame(() => {
      const container = messagesContainerRef.current
      if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
      scrollToInitialMessagesRef.current = false
      setShowScrollToBottom(false)
    }))
  }, [loading, messages.length, profileRequired])

  useEffect(() => {
    if (!scrollToNewMessageRef.current) return

    requestAnimationFrame(() => {
      const container = messagesContainerRef.current
      if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
      scrollToNewMessageRef.current = false
      setShowScrollToBottom(false)
    })
  }, [messages.length, chatStatus])

  useEffect(() => {
    if (!attachmentMenuOpen) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!attachmentMenuRef.current?.contains(event.target as Node)) setAttachmentMenuOpen(false)
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer)
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer)
  }, [attachmentMenuOpen])

  const updateScrollToBottomVisibility = () => {
    const container = messagesContainerRef.current
    if (!container) return
    setShowScrollToBottom(container.scrollHeight - container.scrollTop - container.clientHeight > 220)
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }

  const scrollToNewComposerMessage = () => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.setTimeout(scrollToBottom, 80)))
  }

  const goToMessage = (messageId: number) => {
    setInfoSheetOpen(false)
    window.setTimeout(() => {
      const message = messagesContainerRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
      message?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, 240)
  }

  const formatMessageTime = (message: Message) => {
    const timestamp = message.timestamp ?? message.created_at
    if (!timestamp) return ""
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return ""
    return date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })
  }

  const getMessageMediaUrl = (message: Message) => message.media_url ? publicAssetUrl(message.media_url) : ""
  const isRichMessage = (message: Message) => ["image", "video", "audio", "document", "contacts", "location"].includes(message.message_type ?? "") || message.bot_node_type === "contact"
  const galleryPreviews = messages.flatMap((message) => message.media_url && ["image", "video"].includes(message.message_type ?? "") ? [{ type: message.message_type as "image" | "video", url: getMessageMediaUrl(message) }] : [])

  const addMediaThumbnails = (photoswipe: any) => {
    const strip = document.createElement("div")
    Object.assign(strip.style, { position: "absolute", bottom: "112px", left: "50%", transform: "translateX(-50%)", display: "flex", maxWidth: "calc(100% - 32px)", gap: "8px", overflowX: "auto", scrollBehavior: "smooth", padding: "6px", borderRadius: "12px", background: "rgba(0, 0, 0, 0.48)", zIndex: "10" })
    const render = () => {
      const previews: HTMLButtonElement[] = []
      strip.replaceChildren(...galleryPreviews.map((media, index) => {
        const button = document.createElement("button")
        button.type = "button"
        button.setAttribute("aria-label", `Ver medio ${index + 1}`)
        Object.assign(button.style, { width: "52px", height: "40px", flex: "0 0 auto", overflow: "hidden", borderRadius: "8px", border: index === photoswipe.currIndex ? "2px solid #ffffff" : "1px solid rgba(255,255,255,.45)", background: "#0f172a", padding: "0", cursor: "pointer" })
        if (media.type === "image") {
          const image = document.createElement("img")
          image.src = media.url
          image.alt = ""
          Object.assign(image.style, { width: "100%", height: "100%", objectFit: "cover" })
          button.appendChild(image)
        } else {
          const video = document.createElement("video")
          video.src = media.url
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
      window.requestAnimationFrame(() => {
        previews[photoswipe.currIndex]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
      })
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

  const saveContact = (name: string, phone: string, organization = "", title = "") => {
    const escapeVCard = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n")
    const parts = name.trim().split(/\s+/)
    const firstName = parts.shift() || "Contacto"
    const lastName = parts.join(" ")
    const vCard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `N:${escapeVCard(lastName)};${escapeVCard(firstName)};;;`,
      `FN:${escapeVCard(name || "Contacto")}`,
      phone ? `TEL;TYPE=CELL:${escapeVCard(phone)}` : "",
      organization ? `ORG:${escapeVCard(organization)}` : "",
      title ? `TITLE:${escapeVCard(title)}` : "",
      "END:VCARD",
    ].filter(Boolean).join("\r\n")
    const url = URL.createObjectURL(new Blob([vCard], { type: "text/vcard;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `${(name || "contacto").replace(/[^a-z0-9áéíóúñ]/gi, "-").replace(/-+/g, "-")}.vcf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const renderMessageContent = (message: Message) => {
    const type = message.message_type ?? "text"
    const mediaUrl = getMessageMediaUrl(message)
    const body = message.body ?? ""
    const caption = ["[Imagen]", "[Video]", "[Audio]", "[Documento]"].includes(body) ? "" : body

    if (type === "image" && mediaUrl) {
      const dimensions = mediaDimensions[message.id] ?? { width: 1600, height: 1200 }
      const label = message.media_name || caption || "Imagen enviada"
      return <><Item original={mediaUrl} thumbnail={mediaUrl} width={dimensions.width} height={dimensions.height} alt={label} caption={label} content={<WebchatGalleryImage src={mediaUrl} alt={label} />}>{({ ref, open }) => <button ref={ref} type="button" onClick={open} className="block w-full overflow-hidden rounded-xl bg-slate-100"><img src={mediaUrl} onLoad={(event) => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setMediaDimensions((current) => current[message.id]?.width === image.naturalWidth && current[message.id]?.height === image.naturalHeight ? current : { ...current, [message.id]: { width: image.naturalWidth, height: image.naturalHeight } }) }} alt={label} className="block max-h-80 w-full object-contain" /></button>}</Item>{caption ? <p className="px-2 pt-2 whitespace-pre-wrap">{caption}</p> : null}</>
    }
    if (type === "video" && mediaUrl) {
      const label = message.media_name || "Video enviado"
      return <><Item original={mediaUrl} width="2400" height="1350" alt={label} caption={label} content={<WebchatGalleryVideo src={mediaUrl} />}>{({ ref, open }) => <button ref={ref} type="button" onClick={open} className="group relative block w-full overflow-hidden rounded-xl bg-black"><video src={mediaUrl} muted playsInline preload="metadata" className="block max-h-80 w-full" /><span className="absolute inset-0 grid place-items-center bg-black/15 text-white transition group-hover:bg-black/30"><span className="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-[#003f73] shadow-lg"><Play className="ml-0.5 h-5 w-5 fill-current" /></span></span></button>}</Item>{caption ? <p className="px-2 pt-2 whitespace-pre-wrap">{caption}</p> : null}</>
    }
    if (type === "audio" && mediaUrl) return <div className="flex items-center gap-3 rounded-xl bg-slate-100 px-3 py-3 text-[#003f73]"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white shadow-sm"><AudioLines className="h-5 w-5" /></span><audio src={mediaUrl} controls className="min-w-0 flex-1" /></div>

    if (type === "document" && mediaUrl) return <><a href={mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl bg-slate-100 px-3 py-3 text-slate-800 transition hover:bg-slate-200"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white text-[#003f73] shadow-sm"><FileText className="h-6 w-6" /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{message.media_name || "Documento"}</span><span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Abrir documento</span></span></a>{caption ? <p className="px-2 pt-2 whitespace-pre-wrap">{caption}</p> : null}</>

    if (type === "contacts" || message.bot_node_type === "contact") {
      let data: any = {}
      try { data = JSON.parse(body) } catch { /* El mensaje puede provenir de una integración externa. */ }
      const contact = data.contacts?.[0] ?? data
      const name = data.display_name ?? contact.name?.formatted_name ?? [contact.name?.first_name, contact.name?.last_name].filter(Boolean).join(" ") ?? "Contacto"
      const phone = data.phone ?? contact.phones?.[0]?.phone ?? contact.phones?.[0]?.wa_id ?? ""
      const organization = contact.org?.company ?? data.organization ?? ""
      const title = contact.org?.title ?? data.title ?? ""
      return <button type="button" onClick={() => saveContact(name, phone, organization, title)} className="flex w-full items-center gap-3 rounded-xl bg-slate-100 px-3 py-3 text-left text-slate-800 transition hover:bg-slate-200"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-[#003f73] shadow-sm"><Contact className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{name}</span>{phone ? <span className="mt-0.5 block truncate text-xs text-slate-600">{phone}</span> : null}{organization || title ? <span className="mt-0.5 block truncate text-[11px] text-slate-500">{[title, organization].filter(Boolean).join(" · ")}</span> : null}</span></button>
    }

    if (type === "location") {
      let location: any = {}
      try { location = JSON.parse(body) } catch { /* El mensaje puede provenir de una integración externa. */ }
      const latitude = Number(location.latitude)
      const longitude = Number(location.longitude)
      const validLocation = Number.isFinite(latitude) && Number.isFinite(longitude)
      const label = location.name || location.address || "Ubicación"
      const mapsUrl = validLocation ? `https://www.google.com/maps?q=${latitude},${longitude}` : ""
      const content = <>{validLocation ? <WebchatLocationMap latitude={latitude} longitude={longitude} /> : <div className="grid h-36 place-items-center bg-slate-200 text-[#003f73]"><MapPin className="h-8 w-8" /></div>}<div className="flex items-start gap-3 px-3 py-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-[#003f73] shadow-sm"><MapPin className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{label}</span>{location.address && location.address !== label ? <span className="mt-0.5 block text-xs leading-5 text-slate-600">{location.address}</span> : null}{validLocation ? <span className="mt-1 block text-[11px] text-slate-500">{latitude.toFixed(6)}, {longitude.toFixed(6)}</span> : null}</span></div></>
      return mapsUrl ? <a href={mapsUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-slate-100 text-slate-800 transition hover:bg-slate-200">{content}</a> : <div className="overflow-hidden rounded-xl bg-slate-100 text-slate-800">{content}</div>
    }

    return <p className="whitespace-pre-wrap">{body}</p>
  }

  useEffect(() => {
    if (!token) return

    let refreshing = false
    const refreshMessages = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const data = await api("session", { resume_token: token })
        if (!data.requires_profile) {
          syncChatAssignee(data.chat)
          setMessages((current) => {
            const nextMessages = data.chat.messages ?? []
            const incomingMessages = nextMessages.filter((message: Message) => !current.some((item) => String(item.id) === String(message.id)))
            incomingMessages.forEach(notifyIncomingMessage)
            if (incomingMessages.length) scrollToNewMessageRef.current = true
            return nextMessages
          })
          acknowledgeIncomingMessages(nextMessages)
        }
      } catch {
        // MQTT remains the primary channel; the next refresh will retry.
      } finally {
        refreshing = false
      }
    }

    const interval = window.setInterval(() => void refreshMessages(), 2000)
    return () => window.clearInterval(interval)
  }, [token])

  const start = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    setSending(true)
    try {
      const data = await api("start", { name })
      localStorage.setItem(SESSION_KEY, data.resume_token)
      syncChatAssignee(data.chat)
      setToken(data.resume_token)
      setProfileRequired(false)
      scrollToInitialMessagesRef.current = true
      setMessages(data.chat.messages ?? [])
      acknowledgeIncomingMessages(data.chat.messages ?? [], data.resume_token)
    } catch (exception) { setError(exception instanceof Error ? exception.message : "No se pudo iniciar el chat.") } finally { setSending(false) }
  }

  const restartConversation = async () => {
    setError("")
    setSending(true)
    try {
      const data = await api("restart", { resume_token: token })
      syncChatAssignee(data.chat)
      setMessages(data.chat.messages ?? [])
      acknowledgeIncomingMessages(data.chat.messages ?? [])
      scrollToNewMessageRef.current = true
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "No se pudo reiniciar la conversación.")
    } finally {
      setSending(false)
    }
  }

  const send = async (message: string, optionId?: string) => {
    if ((!message.trim() && !optionId) || sending) return false
    setAttachmentMenuOpen(false)
    setError("")
    setFailedOutgoing(null)
    setSending(true)
    const retryPayload = { message, optionId }

    try {
      const data = await api("send", { resume_token: token, message, option_id: optionId })
      append(data.message)
      setDraft("")
      scrollToNewComposerMessage()
      return true
    } catch (exception) {
      const failureMessage = exception instanceof Error ? exception.message : "No se pudo enviar el mensaje."
      setError(failureMessage)
      setFailedOutgoing(retryPayload)
      return false
    } finally { setSending(false) }
  }

  const retryFailedOutgoing = () => {
    if (!failedOutgoing) return
    void send(failedOutgoing.message, failedOutgoing.optionId)
  }

  const validateAttachments = (files: File[], pendingCount = 0) => {
    if (files.length + pendingCount > MAX_ATTACHMENTS_PER_SEND) {
      return `Podés adjuntar hasta ${MAX_ATTACHMENTS_PER_SEND} archivos por envío.`
    }
    for (const file of files) {
      const kind = getAttachmentKind(file)
      if (!kind) return `“${file.name}” no tiene un formato compatible. Podés enviar imágenes, videos, documentos u audios compatibles.`
      if (file.size > MAX_FILE_BYTES[kind]) return `“${file.name}” pesa ${humanFileSize(file.size)} y supera el máximo de ${humanFileSize(MAX_FILE_BYTES[kind])} para este tipo de archivo.`
    }
    return null
  }

  const sendMedia = async (files: File[], caption = "") => {
    if (!files.length || sending) return false
    const validationError = validateAttachments(files)
    if (validationError) {
      setError(validationError)
      return false
    }
    setAttachmentMenuOpen(false)
    setError("")
    setSending(true)
    try {
      for (const file of files) {
        const mediaKind = getAttachmentKind(file)
        if (!mediaKind) throw new Error(`“${file.name}” no tiene un formato compatible.`)
        const formData = new FormData()
        formData.append("resume_token", token)
        formData.append("file", file)
        formData.append("media_kind", mediaKind)
        if (caption && file === files[0]) formData.append("caption", caption)
        const response = await fetch(`${import.meta.env.VITE_APP_URL}/api/webchat/send-media`, { method: "POST", body: formData })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || "No se pudo enviar el archivo.")
        append(data.message)
      }
      return true
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "No se pudo enviar el archivo.")
      return false
    } finally { setSending(false) }
  }

  const stopAudioRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder?.state === "recording") recorder.stop()
  }

  const startAudioRecording = async () => {
    if (sending || botEnabled || recordingAudio || startingAudioRecordingRef.current) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Para grabar un audio abrí el chat mediante una conexión segura (HTTPS).")
      return
    }

    startingAudioRecordingRef.current = true
    setError("")
    discardAudioRecordingRef.current = false

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      audioChunksRef.current = []

      const preferredMimeTypes = ["audio/ogg;codecs=opus", "audio/ogg"]
      const nativeMimeType = typeof MediaRecorder !== "undefined"
        ? preferredMimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType))
        : undefined
      const selectedMimeType = nativeMimeType ?? "audio/ogg"
      let recorder: any

      if (nativeMimeType) {
        recorder = new MediaRecorder(stream, { mimeType: nativeMimeType })
      } else {
        const OpusMediaRecorder = await loadOpusMediaRecorder()
        recorder = new OpusMediaRecorder(stream, { mimeType: selectedMimeType }, {
          encoderWorkerFactory: () => createCdnWorker("https://cdn.jsdelivr.net/npm/opus-media-recorder@0.8.0/encoderWorker.umd.js"),
          OggOpusEncoderWasmPath: "https://cdn.jsdelivr.net/npm/opus-media-recorder@0.8.0/OggOpusEncoder.wasm",
          WebMOpusEncoderWasmPath: "https://cdn.jsdelivr.net/npm/opus-media-recorder@0.8.0/WebMOpusEncoder.wasm",
        })
      }

      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data?.size) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current)
          recordingIntervalRef.current = null
        }
        setRecordingAudio(false)
        mediaRecorderRef.current = null
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null

        if (discardAudioRecordingRef.current) return

        const actualMimeType = recorder.mimeType || selectedMimeType
        if (!actualMimeType.startsWith("audio/ogg")) {
          setError(`El formato de audio ${actualMimeType} no es compatible.`)
          return
        }

        const blob = new Blob(audioChunksRef.current, { type: actualMimeType })
        if (!blob.size) {
          setError("No se pudo capturar el audio.")
          return
        }

        const file = new File([blob], `audio_${Date.now()}.ogg`, { type: "audio/ogg" })
        await sendMedia([file])
      }
      recorder.onerror = () => {
        setError("Ocurrió un error durante la grabación.")
      }
      recorder.start()
      setRecordingSeconds(0)
      setRecordingAudio(true)
      recordingIntervalRef.current = setInterval(() => setRecordingSeconds((current) => current + 1), 1000)
    } catch (exception) {
      const name = exception instanceof DOMException ? exception.name : ""
      setError(name === "NotAllowedError" ? "Necesitamos tu permiso para usar el micrófono." : "No se pudo iniciar la grabación. Verificá los permisos del micrófono.")
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    } finally {
      startingAudioRecordingRef.current = false
    }
  }

  const queueMedia = (files: File[]) => {
    const validationError = validateAttachments(files, pendingMedia.length)
    if (validationError) {
      setError(validationError)
      return
    }
    if (files.length) setAttachmentMenuOpen(false)
    const pending = files.filter((file) => {
      const kind = getAttachmentKind(file)
      return kind === "image" || kind === "video"
    })
    const immediate = files.filter((file) => !pending.includes(file))
    if (pending.length) setPendingMedia((current) => [...current, ...pending.map((file) => ({ id: `${file.name}-${file.lastModified}-${Date.now()}-${Math.random().toString(36).slice(2)}`, file, previewUrl: URL.createObjectURL(file), type: getAttachmentKind(file) === "video" ? "video" : "image" }))])
    if (immediate.length) void sendMedia(immediate)
  }

  const removePendingMedia = (id: string) => setPendingMedia((current) => {
    const item = current.find((media) => media.id === id)
    if (item) URL.revokeObjectURL(item.previewUrl)
    return current.filter((media) => media.id !== id)
  })

  const sendComposer = async () => {
    if (sending) return
    if (pendingMedia.length) {
      const sent = await sendMedia(pendingMedia.map((media) => media.file), draft.trim())
      if (sent) {
        pendingMedia.forEach((media) => URL.revokeObjectURL(media.previewUrl))
        setPendingMedia([])
        setDraft("")
      }
      return
    }
    await send(draft)
  }

  const pendingOptionsMessage = messages.map((message, index) => ({ message, index })).reverse().find(({ message, index }) => {
    if (!message.interactive_options?.length) return false
    return !messages.slice(index + 1).some((candidate) => candidate.sender === "contact" && !candidate.delivery_status && message.interactive_options?.some((option) => option.label === candidate.body))
  })?.message
  const manualInputLocked = Boolean(pendingOptionsMessage)
  const showAudioControl = !sending && !manualInputLocked && (recordingAudio || (!botEnabled && !draft.trim() && pendingMedia.length === 0))

  useEffect(() => {
    if (manualInputLocked) setAttachmentMenuOpen(false)
  }, [manualInputLocked])

  useEffect(() => {
    if (error) setAttachmentMenuOpen(false)
  }, [error])

  useEffect(() => {
    if (!error) return
    toast.error("No se pudo completar la acción", {
      description: error,
      action: failedOutgoing ? { label: "Reintentar", onClick: retryFailedOutgoing } : undefined,
    })
    setError("")
  }, [error, failedOutgoing])

  const pickFiles = (accept: string) => {
    setFileAccept(accept)
    window.setTimeout(() => fileInputRef.current?.click(), 0)
  }

  const openLocationModal = () => {
    setError("")
    setLocationQuery("")
    setLocationResults([])
    setLocationDraft(null)
    setLocationModalOpen(true)
  }

  const searchLocation = async () => {
    const query = locationQuery.trim()
    if (query.length < 3) {
      setError("Escribí al menos 3 caracteres para buscar una ubicación.")
      return
    }
    setError("")
    setLocationSearching(true)
    try {
      const response = await fetch(`${import.meta.env.VITE_APP_URL}/api/webchat/location/search?q=${encodeURIComponent(query)}&limit=6`)
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || "No se pudo buscar la ubicación.")
      const results = Array.isArray(payload.data) ? payload.data : []
      setLocationResults(results)
      if (!results.length) setError("No encontramos ubicaciones para esa búsqueda.")
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "No se pudo buscar la ubicación.")
    } finally {
      setLocationSearching(false)
    }
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError("Tu dispositivo no permite compartir la ubicación actual.")
      return
    }
    if (!window.isSecureContext) {
      setError("Para compartir tu ubicación actual, necesitamos que se acepte el permiso.")
      return
    }
    setError("")
    setLocationDetecting(true)
    navigator.geolocation.getCurrentPosition((position) => {
      setLocationDraft({ latitude: Number(position.coords.latitude.toFixed(6)), longitude: Number(position.coords.longitude.toFixed(6)), name: "Ubicación actual", address: "" })
      setLocationDetecting(false)
    }, (locationError) => {
      setLocationDetecting(false)
      if (locationError.code === locationError.PERMISSION_DENIED) {
        setError("Necesitamos tu permiso para compartir la ubicación actual.")
      } else if (locationError.code === locationError.TIMEOUT) {
        setError("No pudimos obtener tu ubicación actual a tiempo. Volvé a intentarlo.")
      } else {
        setError("No pudimos determinar tu ubicación actual. Revisá que el GPS esté activado.")
      }
    }, { enableHighAccuracy: true, timeout: 15000 })
  }

  const sendLocation = async () => {
    if (!locationDraft || sending) {
      if (!locationDraft) setError("Elegí una ubicación en el mapa, buscala o usá tu ubicación actual.")
      return
    }
    setError("")
    setSending(true)
    try {
      const data = await api("send-location", { resume_token: token, ...locationDraft })
      append(data.message)
      setLocationModalOpen(false)
      setLocationDraft(null)
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "No se pudo enviar la ubicación.")
    } finally { setSending(false) }
  }

  const sendContact = async () => {
    if (!contactName.trim() || !contactPhone.trim() || sending) return
    setError("")
    setSending(true)
    try {
      const data = await api("send-contact", { resume_token: token, name: contactName.trim(), phone: contactPhone.trim() })
      append(data.message)
      setContactModalOpen(false)
      setContactName("")
      setContactPhone("")
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "No se pudo enviar el contacto.")
    } finally { setSending(false) }
  }

  const selectDeviceContact = async () => {
    const contactPicker = (navigator as Navigator & { contacts?: ContactPicker }).contacts
    if (!window.isSecureContext || !contactPicker) {
      setError("Tu navegador no permite elegir contactos desde esta página. Podés completar los datos manualmente.")
      return
    }

    setError("")
    setSelectingDeviceContact(true)
    try {
      const supportedProperties = await contactPicker.getProperties()
      const properties = ["name", "tel"].filter((property) => supportedProperties.includes(property))
      if (!properties.length) throw new Error("Tu navegador no permite compartir nombre ni teléfono desde los contactos.")
      const [contact] = await contactPicker.select(properties, { multiple: false })
      if (!contact) return
      setContactName(contact.name?.find(Boolean) ?? "")
      setContactPhone(contact.tel?.find(Boolean) ?? "")
      if (!contact.name?.find(Boolean) || !contact.tel?.find(Boolean)) {
        setError("El contacto elegido no tiene nombre o teléfono. Completá el dato faltante.")
      }
    } catch (exception) {
      if (exception instanceof DOMException && exception.name === "AbortError") return
      setError(exception instanceof Error ? exception.message : "No se pudo seleccionar el contacto.")
    } finally { setSelectingDeviceContact(false) }
  }

  const selectOption = async (messageId: string | number, option: Option) => {
    const messageKey = String(messageId)
    if (selectedOptions[messageKey] || optionSelectionLockRef.current.has(messageKey)) return

    optionSelectionLockRef.current.add(messageKey)
    setSelectedOptions((current) => ({ ...current, [messageKey]: option.id }))
    const sent = await send(option.label, option.id)

    if (!sent) optionSelectionLockRef.current.delete(messageKey)
  }

  const hasMqttConnectionIssue = Boolean(token) && ["reconnecting", "offline", "error"].includes(mqttStatus)
  const channelStatus = hasMqttConnectionIssue
    ? { label: "Sin conexión", dot: "bg-red-300" }
    : !channelAvailability.enabled
      ? { label: "En mantenimiento", dot: "bg-amber-300" }
      : !channelAvailability.available
        ? { label: "Fuera de horario", dot: "bg-slate-300" }
        : { label: "En línea", dot: "bg-[#a9d7bd]" }
  const conversationUnavailable = !channelAvailability.enabled || !channelAvailability.available
  const isOperatorHandling = !conversationUnavailable && !botEnabled
  const isWaitingForOperator = isOperatorHandling && !operatorName
  const headerName = isOperatorHandling ? operatorName || "Buscando un operador" : webchat.title
  const attentionTitle = conversationUnavailable ? "Canal temporalmente no disponible" : isWaitingForOperator ? "Buscando un operador" : isOperatorHandling ? `Atiende ${operatorName}` : "Asistente virtual activo"
  const attentionDescription = conversationUnavailable ? "La conversación se retomará cuando el canal vuelva a estar disponible." : isWaitingForOperator ? "Te avisaremos cuando una persona tome la conversación." : isOperatorHandling ? "Podés continuar escribiendo por este mismo chat." : "Podés consultar o seguir las opciones disponibles en la conversación."
  const sharedMedia = messages.filter((message) => ["image", "video", "audio", "document"].includes(message.message_type ?? "text")).slice(-12).reverse()

  return (
    <main className="h-[100dvh] overflow-hidden bg-[#f4f7fa] p-0 font-sans text-slate-800 sm:p-5 lg:p-7">
      <section className="relative mx-auto flex h-full w-full max-w-[1060px] flex-col overflow-hidden bg-white shadow-[0_20px_50px_rgba(21,49,79,0.12)] sm:rounded-[24px] sm:border sm:border-slate-200">
        <header className="relative shrink-0 overflow-hidden bg-[#003f73] px-5 py-4 text-white sm:px-7 sm:py-5">
          <div className="pointer-events-none absolute -right-12 -top-24 h-56 w-56 rounded-full border-[28px] border-white/[0.06]" />
          <div className="pointer-events-none absolute -right-5 -top-16 h-40 w-40 rounded-full border-[18px] border-white/[0.06]" />
          <div className="relative flex items-center gap-3">
            <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full shadow-sm ${isOperatorHandling ? "bg-[#e8f0f6] text-[#003f73]" : "bg-white p-1.5"}`}>{isWaitingForOperator ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Buscando un operador" /> : isOperatorHandling ? <Headset className="h-5 w-5" aria-label="Operador" /> : <img src={webchat.logo_url ? publicAssetUrl(webchat.logo_url) : `${import.meta.env.VITE_APP_URL}/images/hu_icon_new.png`} alt="Hospital Universitario" className="h-full w-full object-contain" />}</div>
            <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">{webchat.subtitle}</p><h1 className="mt-0.5 text-base font-bold tracking-tight sm:text-lg">{headerName}</h1><p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/80"><span className={`h-1.5 w-1.5 rounded-full ${channelStatus.dot}`} />{channelStatus.label}</p></div>
            <div className="ml-auto flex shrink-0 items-center gap-2"><button type="button" onClick={() => setInfoSheetOpen(true)} title="Información de la conversación" aria-label="Información de la conversación" className="grid h-9 w-9 place-items-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20"><Info className="h-4 w-4" /></button><button type="button" onClick={enableNotifications} title={notificationPermission === "granted" ? "Notificaciones activadas" : notificationPermission === "denied" ? "Notificaciones bloqueadas. Habilitalas desde la configuración del navegador." : "Activar notificaciones"} aria-label={notificationPermission === "granted" ? "Notificaciones activadas" : "Activar notificaciones"} className="grid h-9 w-9 place-items-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20">{notificationPermission === "granted" ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}</button></div>
          </div>
        </header>

        {hasMqttConnectionIssue ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 px-5 text-center backdrop-blur-[1px]">
            <div className="max-w-sm rounded-lg border border-white/20 bg-black/55 px-5 py-4 text-white shadow-xl">
              <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10"><WifiOff className="h-5 w-5" /></span>
              <p className="mt-3 text-sm font-semibold">Se interrumpió la conexión</p>
              <p className="mt-1 text-xs leading-5 text-white/85">Estamos intentando restablecerla para actualizar el chat.</p>
            </div>
          </div>
        ) : null}

        <WebchatBottomSheet open={infoSheetOpen} onClose={() => setInfoSheetOpen(false)}><div className="flex items-start justify-between gap-4 px-5 pb-4 pt-4"><div><p className="text-lg font-bold tracking-tight text-slate-800">Información de la conversación</p><p className="mt-1 text-sm text-slate-500">Todo lo importante de tu atención en un solo lugar.</p></div><button type="button" onClick={() => setInfoSheetOpen(false)} aria-label="Cerrar información" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100"><X className="h-4 w-4" /></button></div><div className="border-t border-slate-100 px-5 py-5"><div className="flex items-center gap-3 rounded-2xl bg-[#e8f0f6] p-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white p-2 text-[#003f73] shadow-sm">{isOperatorHandling ? <Headset className="h-6 w-6" /> : <img src={webchat.logo_url ? publicAssetUrl(webchat.logo_url) : `${import.meta.env.VITE_APP_URL}/images/hu_icon_new.png`} alt="" className="h-full w-full object-contain" />}</span><span className="min-w-0"><span className="block text-sm font-bold text-slate-800">{attentionTitle}</span><span className="mt-0.5 block text-xs leading-5 text-slate-600">{attentionDescription}</span></span></div><div className="mt-5 space-y-3"><div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f0f6] text-[#003f73]"><MessageCircle className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-800">Estado del canal</span><span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><span className={`h-2 w-2 rounded-full ${channelStatus.dot}`} />{channelStatus.label}</span></span></div><p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">{messages.length ? `Esta conversación tiene ${messages.length} mensaje${messages.length === 1 ? "" : "s"}.` : "Todavía no hay mensajes en esta conversación."}</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f0f6] text-[#003f73]"><Bell className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-800">Notificaciones</span><span className="mt-1 block text-xs leading-5 text-slate-500">{notificationPermission === "granted" ? "Te avisaremos cuando recibas una respuesta con el chat cerrado." : "Activá los avisos para enterarte cuando llegue una respuesta."}</span></span></div>{notificationPermission !== "granted" ? <button type="button" onClick={() => void enableNotifications()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#003f73]/20 bg-[#e8f0f6] px-3 py-2.5 text-sm font-semibold text-[#003f73] transition hover:bg-[#dcebf3]"><Bell className="h-4 w-4" />Activar notificaciones</button> : <div className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-emerald-700"><Check className="h-4 w-4" />Notificaciones activadas</div>}</div><div className="flex items-start gap-3"><span></span></div></div><div className="mt-5"><div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-bold text-slate-800">Archivos compartidos</p><p className="mt-0.5 text-xs text-slate-500">Fotos, videos, audios y documentos de esta conversación.</p></div><span className="rounded-full bg-[#e8f0f6] px-2.5 py-1 text-xs font-bold text-[#003f73]">{sharedMedia.length}</span></div>{sharedMedia.length ? <div className="grid grid-cols-3 gap-2">{sharedMedia.map((media) => { const mediaUrl = getMessageMediaUrl(media); const label = media.media_name || (media.message_type === "audio" ? "Audio" : media.message_type === "document" ? "Documento" : media.message_type === "video" ? "Video" : "Imagen"); return <button key={`shared-media-${media.id}`} type="button" onClick={() => goToMessage(media.id)} aria-label={`Ir al mensaje: ${label}`} className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-left transition hover:-translate-y-0.5 hover:border-[#003f73]/45 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#003f73]/35">{media.message_type === "image" && mediaUrl ? <img src={mediaUrl} alt={label} className="h-full w-full object-cover" /> : media.message_type === "video" && mediaUrl ? <><video src={mediaUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/20 text-white"><Play className="h-5 w-5 fill-current drop-shadow" /></span></> : <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center text-[#003f73]">{media.message_type === "audio" ? <AudioLines className="h-6 w-6" /> : <FileText className="h-6 w-6" />}<span className="line-clamp-2 text-[10px] font-semibold leading-3">{label}</span></div>}<span className="absolute bottom-1 right-1 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-medium text-white">{media.message_type === "image" ? "Foto" : media.message_type === "video" ? "Video" : media.message_type === "audio" ? "Audio" : "Doc"}</span></button> })}</div> : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-xs leading-5 text-slate-500">Los archivos que se compartan aparecerán acá.</div>}</div><button type="button" onClick={() => setInfoSheetOpen(false)} className="mt-5 w-full rounded-xl bg-[#003f73] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#003461]">Volver a la conversación</button></div></WebchatBottomSheet>

        {showIosInstallHelp ? <div className={`webchat-modal-backdrop absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-5 backdrop-blur-[1px]${isClosingIosInstallHelp ? " webchat-modal-backdrop--closing" : ""}`}><div className={`webchat-modal-card w-full max-w-sm rounded-2xl bg-white p-5 text-slate-800 shadow-xl${isClosingIosInstallHelp ? " webchat-modal-card--closing" : ""}`}><div className="flex items-start justify-between gap-4"><div><p className="text-base font-bold">Agregá {webchat.title} a tu iPhone</p><p className="mt-1 text-sm leading-5 text-slate-500">Así podés abrir el chat como una app y habilitar sus notificaciones.</p></div><button type="button" onClick={closeIosInstallHelp} aria-label="Cerrar" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"><X className="h-4 w-4" /></button></div><ol className="mt-5 space-y-3 text-sm text-slate-600"><li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e8f0f6] text-xs font-bold text-[#003f73]">1</span><span>Tocá el botón de <strong className="font-semibold text-slate-800">menú</strong> <Menu className="inline h-3.5 w-3.5 text-[#003f73]" /> de la barra inferior.</span></li><li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e8f0f6] text-xs font-bold text-[#003f73]">2</span><span>Elegí <strong className="font-semibold text-slate-800">Compartir</strong> <Share className="inline h-3.5 w-3.5 text-[#003f73]" />.</span></li><li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e8f0f6] text-xs font-bold text-[#003f73]">3</span><span>Elegí <strong className="font-semibold text-slate-800">Ver más</strong> <ChevronDown className="inline h-3.5 w-3.5 text-[#003f73]" />.</span></li><li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e8f0f6] text-xs font-bold text-[#003f73]">4</span><span>Tocá <strong className="font-semibold text-slate-800">Agregar a Inicio</strong>.</span></li><li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e8f0f6] text-xs font-bold text-[#003f73]">5</span><span>Abrí {webchat.title} desde el ícono creado y activá la campana.</span></li></ol><button type="button" onClick={closeIosInstallHelp} className="mt-5 w-full rounded-xl bg-[#003f73] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#003461]">Entendido</button></div></div> : null}

        <WebchatModal open={contactModalOpen} className="p-5" cardClassName="w-full max-w-sm"><form onSubmit={(event) => { event.preventDefault(); void sendContact() }} className="w-full rounded-2xl bg-white p-5 text-slate-800 shadow-xl"><div className="flex items-start justify-between gap-4"><div><p className="text-base font-bold">Compartir contacto</p><p className="mt-1 text-sm leading-5 text-slate-500">Completá los datos de la persona.</p></div><button type="button" onClick={() => setContactModalOpen(false)} aria-label="Cerrar" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"><X className="h-4 w-4" /></button></div>{deviceContactPickerAvailable ? <button type="button" onClick={() => void selectDeviceContact()} disabled={selectingDeviceContact} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-[#003f73]/20 bg-[#e8f0f6] px-3 py-2.5 text-sm font-semibold text-[#003f73] transition hover:bg-[#dcebf3] disabled:opacity-60">{selectingDeviceContact ? <Loader2 className="h-4 w-4 animate-spin" /> : <Contact className="h-4 w-4" />}Seleccionar de mis contactos</button> : null}<label className={`${deviceContactPickerAvailable ? "mt-4" : "mt-5"} block text-xs font-bold text-slate-700`}>Nombre<input required value={contactName} onChange={(event) => setContactName(event.target.value)} className="mt-1.5 w-full rounded-xl border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-[#003f73] focus:ring-[#003f73]" placeholder="Nombre y apellido" /></label><label className="mt-4 block text-xs font-bold text-slate-700">Teléfono<input required value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} inputMode="tel" className="mt-1.5 w-full rounded-xl border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-[#003f73] focus:ring-[#003f73]" placeholder="Ej. +54 9 261 000 0000" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setContactModalOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancelar</button><button disabled={sending} className="rounded-xl bg-[#003f73] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#003461] disabled:opacity-60">{sending ? "Enviando..." : "Enviar contacto"}</button></div></form></WebchatModal>

        <WebchatModal open={locationModalOpen} className="p-3 sm:p-5" cardClassName="flex max-h-full w-full max-w-5xl"><form onSubmit={(event) => { event.preventDefault(); void sendLocation() }} className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white text-slate-800 shadow-xl"><div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4"><div><p className="text-base font-bold">Compartir ubicación</p><p className="mt-1 text-sm leading-5 text-slate-500">Buscá un lugar, elegilo en el mapa o usá tu ubicación actual.</p></div><button type="button" onClick={() => setLocationModalOpen(false)} aria-label="Cerrar" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"><X className="h-4 w-4" /></button></div><div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[320px_1fr]"><div className="border-b border-slate-200 bg-slate-50 p-4 md:border-b-0 md:border-r md:p-5"><label className="text-xs font-bold text-slate-700">Buscar ubicación</label><div className="mt-1.5 flex gap-2"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchLocation() } }} placeholder="Ej. Plaza Independencia" className="w-full rounded-xl border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#003f73] focus:ring-[#003f73]" /></div><button type="button" onClick={() => void searchLocation()} disabled={locationSearching} className="rounded-xl bg-[#003f73] px-3 text-sm font-bold text-white transition hover:bg-[#003461] disabled:opacity-60">{locationSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}</button></div><button type="button" onClick={useCurrentLocation} disabled={locationDetecting} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[#003f73]/20 bg-white px-3 py-2.5 text-sm font-semibold text-[#003f73] transition hover:bg-[#e8f0f6] disabled:opacity-60"><MapPin className="h-4 w-4" />{locationDetecting ? "Obteniendo ubicación..." : "Usar mi ubicación actual"}</button>{locationResults.length ? <div className="mt-3 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5">{locationResults.map((result) => <button key={result.id} type="button" onClick={() => setLocationDraft(result)} className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-slate-100 ${locationDraft?.latitude === result.latitude && locationDraft?.longitude === result.longitude ? "bg-[#e8f0f6]" : ""}`}><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#003f73]" /><span className="min-w-0"><span className="block truncate text-xs font-bold text-slate-800">{result.name}</span><span className="block line-clamp-2 text-[11px] leading-4 text-slate-500">{result.address}</span></span></button>)}</div> : null}</div><div className="p-4 md:p-5"><WebchatLocationPicker value={locationDraft} onChange={setLocationDraft} /><div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-[#003f73] shadow-sm"><MapPin className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-800">{locationDraft?.name || "Elegí una ubicación"}</span><span className="block truncate text-xs text-slate-500">{locationDraft ? locationDraft.address || `${locationDraft.latitude.toFixed(6)}, ${locationDraft.longitude.toFixed(6)}` : "Tocá el mapa o buscá una dirección."}</span></span></div></div></div><div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3"><button type="button" onClick={() => setLocationModalOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancelar</button><button disabled={sending || !locationDraft} className="inline-flex items-center gap-2 rounded-xl bg-[#003f73] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#003461] disabled:opacity-60">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}Enviar ubicación</button></div></form></WebchatModal>

        {loading ? (
          <div className="min-h-0 flex-1 overflow-y-auto bg-[#f5f8fb] px-4 sm:px-8"><WebchatMessagesLoader /></div>
        ) : !channelAvailability.enabled ? (
          <div className="m-auto w-full max-w-lg px-5 text-center sm:px-8">
            <div className="relative overflow-hidden rounded-3xl border border-[#003f73]/15 bg-white px-6 py-9 shadow-[0_18px_45px_rgba(21,49,79,0.1)] sm:px-10">
              <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[#003f73]/[0.05]" />
              <div className="pointer-events-none absolute -bottom-20 -left-16 h-40 w-40 rounded-full border-[20px] border-[#003f73]/[0.04]" />
              <div className="relative"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#003f73] text-white shadow-lg shadow-[#003f73]/20"><Wrench className="h-7 w-7" /></div><p className="mt-6 text-[10px] font-bold uppercase tracking-[0.2em] text-[#003f73]">Mantenimiento programado</p><h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-800">Estamos mejorando este canal</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">Estamos realizando tareas de mantenimiento. Volvé a intentarlo en unos minutos.</p><div className="mx-auto mt-6 h-px w-16 bg-[#003f73]/15" /><p className="mt-4 text-xs text-slate-400">Gracias por tu paciencia.</p></div>
            </div>
          </div>
        ) : !channelAvailability.available ? (
          <div className="m-auto w-full max-w-lg px-5 text-center sm:px-8">
            <div className="rounded-3xl border border-slate-200 bg-white px-6 py-9 shadow-[0_18px_45px_rgba(21,49,79,0.08)] sm:px-10">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#e8f0f6] text-[#003f73]"><Clock3 className="h-7 w-7" /></div><p className="mt-6 text-[10px] font-bold uppercase tracking-[0.2em] text-[#003f73]">Horario de atención</p><h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-800">Ahora no estamos disponibles</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">{webchat.offline_message}</p><div className="mt-7 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500"><MessageCircle className="mr-1.5 inline h-3.5 w-3.5 text-[#003f73]" /> Podés volver a escribirnos durante el horario de atención.</div>
            </div>
          </div>
        ) : profileRequired ? (
          <div className="m-auto w-full max-w-xl px-5 py-7 sm:px-8"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#e8f0f6] text-[#003f73]"><MessageCircle className="h-5 w-5" /></div><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#003f73]">Atención en línea</p><h2 className="mt-1 text-xl font-bold tracking-tight text-slate-800">¿Cómo te llamás?</h2><p className="mt-1 text-sm leading-6 text-slate-500">Ingresá tu nombre y apellido para iniciar la conversación.</p></div></div>
            <form onSubmit={start} className="mt-6 space-y-4">
              <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">Nombre y apellido</span><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ingresá tu nombre y apellido" className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#003f73] focus:ring-[#003f73]" /></label>
              <button disabled={sending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#003f73] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#003f73]/20 transition hover:bg-[#003461] disabled:opacity-60">{sending ? "Iniciando..." : <>Comenzar conversación <ArrowUp className="h-4 w-4 rotate-90" /></>}</button>
            </form>
          </div></div>
        ) : messages.length === 0 ? (
          <div className="m-auto w-full max-w-lg px-5 text-center sm:px-8">
            <div className="rounded-3xl border border-slate-200 bg-white px-6 py-9 shadow-[0_18px_45px_rgba(21,49,79,0.08)] sm:px-10">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#e8f0f6] text-[#003f73]"><MessageCircle className="h-7 w-7" /></div>
              <h2 className="mt-6 text-2xl font-bold tracking-tight text-slate-800">Todavía no hay mensajes</h2>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">Cuando la conversación comience, los mensajes aparecerán en este espacio.</p>
            </div>
          </div>
        ) : <>
          <div className="relative min-h-0 flex-1">
            <div ref={messagesContainerRef} onScroll={updateScrollToBottomVisibility} className="h-full overflow-y-auto bg-[#f5f8fb] px-4 py-5 sm:px-8 sm:py-7"><div className="mx-auto max-w-3xl space-y-4">
              <Gallery withCaption onOpen={addMediaThumbnails} options={{ bgOpacity: 0.94, closeOnVerticalDrag: true, imageClickAction: "zoom", doubleTapAction: "zoom", secondaryZoomLevel: 2 }}><div className="flex items-center gap-3 py-1"><span className="h-px flex-1 bg-slate-200" /><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Hoy</span><span className="h-px flex-1 bg-slate-200" /></div>
                {messages.map((message, index) => {
                  const isOwnMessage = message.sender === "contact"
                  const isBotMessage = message.sender_subtype === "bot"
                  const time = formatMessageTime(message)
                  const richMessage = isRichMessage(message)
                  const responseToOptions = message.interactive_options?.length
                    ? messages.slice(index + 1).find((candidate) => candidate.sender === "contact" && message.interactive_options?.some((option) => option.label === candidate.body))
                    : undefined
                  const selectedOptionId = selectedOptions[String(message.id)] ?? message.interactive_options?.find((option) => option.label === responseToOptions?.body)?.id

                  return <div key={`${message.id}-${index}`} data-message-id={message.id} className={`flex items-start gap-2.5 ${isOwnMessage ? "justify-end" : "justify-start"} ${String(message.id) === enteringMessageId ? `webchat-message-enter ${isOwnMessage ? "webchat-message-enter--own" : "webchat-message-enter--incoming"}` : ""}`}>
                    {!isOwnMessage ? <div title={isBotMessage ? "Asistente virtual" : message.operator_name || "Operador"} className={`self-end grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border shadow-sm ${isBotMessage ? "border-[#003f73]/15 bg-white p-1" : "border-[#2b5f90]/20 bg-[#e8f0f6] text-[#003f73]"}`}>
                      {isBotMessage ? <img src={webchat.logo_url ? publicAssetUrl(webchat.logo_url) : `${import.meta.env.VITE_APP_URL}/images/hu_icon_new.png`} alt="Asistente virtual" className="h-full w-full object-contain" /> : <Headset className="h-4 w-4" />}
                    </div> : null}
                    <div className={`max-w-[88%] rounded-2xl text-sm leading-6 sm:max-w-[76%] ${richMessage ? "overflow-hidden p-1.5" : "px-4 py-3"} ${isOwnMessage ? "rounded-br-md bg-[#003f73] text-white shadow-sm" : "rounded-bl-md bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"}`}>
                      {renderMessageContent(message)}
                      {!isOwnMessage && message.interactive_options?.length ? <div className="mt-3 space-y-2">{message.interactive_options.map((option) => {
                        const isSelected = selectedOptionId === option.id
                        const isLocked = Boolean(selectedOptionId)
                        return <button key={option.id} type="button" onClick={() => selectOption(message.id, option)} disabled={isLocked || sending} aria-pressed={isSelected} className={`block w-full rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition ${isSelected ? "border-[#003f73] bg-[#003f73] text-white shadow-sm" : "border-[#003f73]/20 bg-[#edf4f8] text-[#003f73] hover:bg-[#dcebf3]"} ${isLocked && !isSelected ? "cursor-not-allowed opacity-45" : ""}`}>{isSelected ? <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5" />{option.label}</span> : option.label}{option.description ? <span className={`mt-0.5 block font-normal leading-5 ${isSelected ? "text-white/80" : "text-slate-500"}`}>{option.description}</span> : null}</button>
                      })}</div> : null}
                      {time ? <p className={`mt-1.5 text-right text-[10px] leading-none ${isOwnMessage ? "text-white/65" : "text-slate-400"}`}>{time}</p> : null}
                    </div>
                  </div>
                })}
                {chatStatus === "closed" ? <div className="flex items-center gap-3 py-3 text-center"><span className="h-px flex-1 bg-slate-200" /><span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-[#003f73]" />{closedBy === "operator" ? `${closedByName || "El operador"} finalizó la atención` : "Atención finalizada"}</span><span className="h-px flex-1 bg-slate-200" /></div> : null}
              </Gallery><div ref={messagesEndRef} aria-hidden="true" className="h-px" />
            </div></div>
            {showScrollToBottom ? <button type="button" onClick={scrollToBottom} title="Ir al final" aria-label="Ir al final" className="absolute bottom-4 left-1/2 grid h-10 w-10 -translate-x-1/2 place-items-center rounded-full bg-[#003f73] text-white shadow-lg transition hover:bg-[#003461]"><ChevronDown className="h-5 w-5" /></button> : null}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void sendComposer() }} className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-8 sm:py-4"><div className="mx-auto max-w-3xl">
            {chatStatus === "closed" ? <div><button type="button" onClick={() => void restartConversation()} disabled={sending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#003f73] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#003f73]/20 transition hover:bg-[#003461] disabled:opacity-60">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}Nueva conversación</button></div> : <>
            {manualInputLocked ? <p className="mb-2 text-center text-xs font-medium text-[#003f73]">Elegí una de las opciones del mensaje para continuar.</p> : null}
            {pendingMedia.length ? <div className="mb-2 flex gap-2 overflow-x-auto pb-1">{pendingMedia.map((media) => <div key={media.id} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"><button type="button" onClick={() => removePendingMedia(media.id)} aria-label={`Quitar ${media.file.name}`} className="absolute right-1 top-1 z-10 grid h-5 w-5 place-items-center rounded-full bg-slate-900/70 text-white"><X className="h-3 w-3" /></button>{media.type === "image" ? <img src={media.previewUrl} alt={media.file.name} className="h-full w-full object-cover" /> : <><video src={media.previewUrl} muted preload="metadata" className="h-full w-full object-cover" /><span className="absolute inset-0 grid place-items-center text-white drop-shadow"><Play className="h-5 w-5 fill-current" /></span></>}</div>)}</div> : null}
            <input ref={fileInputRef} type="file" multiple accept={fileAccept} className="hidden" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; queueMedia(files) }} />
            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1 shadow-sm focus-within:border-[#003f73]/50 focus-within:ring-2 focus-within:ring-[#003f73]/10"><div ref={attachmentMenuRef} className="relative shrink-0"><button type="button" onClick={() => setAttachmentMenuOpen((open) => !open)} disabled={sending || recordingAudio || manualInputLocked} aria-label="Adjuntar" title="Adjuntar" style={attachmentMenuOpen ? { backgroundColor: "#003f73", borderColor: "#003f73", color: "#ffffff" } : undefined} className={`grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-[#003f73] transition hover:bg-white disabled:opacity-50 ${attachmentMenuOpen ? "rotate-45" : ""}`}><Plus className="h-5 w-5" /></button>{attachmentMenuOpen ? <div className="absolute bottom-14 left-0 z-20 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"><button type="button" onClick={() => pickFiles("image/*,video/*")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"><span className="grid h-9 w-9 place-items-center rounded-full bg-fuchsia-100 text-fuchsia-700"><ImageIcon className="h-4 w-4" /></span>Fotos y videos</button><button type="button" onClick={() => pickFiles(".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf,text/plain")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"><span className="grid h-9 w-9 place-items-center rounded-full bg-indigo-100 text-indigo-700"><FileText className="h-4 w-4" /></span>Documento</button><button type="button" onClick={openLocationModal} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"><span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-100 text-emerald-700"><MapPin className="h-4 w-4" /></span>Ubicación</button><button type="button" onClick={() => { setError(""); setContactModalOpen(true) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"><span className="grid h-9 w-9 place-items-center rounded-full bg-sky-100 text-sky-700"><User className="h-4 w-4" /></span>Contacto</button></div> : null}</div>{recordingAudio ? <div className="flex min-h-10 flex-1 items-center gap-2 px-3 text-sm font-semibold text-red-600"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />Grabando audio <span className="ml-auto font-mono text-xs tabular-nums text-red-500">{formatRecordingTime(recordingSeconds)}</span></div> : <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendComposer() } }} rows={1} disabled={manualInputLocked} placeholder={manualInputLocked ? "Escribí un mensaje..." : "Escribí un mensaje..."} className="max-h-28 min-h-10 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none outline-none placeholder:text-slate-400 focus:border-0 focus:ring-0" />}{showAudioControl ? <button type="button" onClick={() => recordingAudio ? stopAudioRecording() : void startAudioRecording()} disabled={sending} aria-label={recordingAudio ? "Detener grabación" : "Grabar audio"} title={recordingAudio ? "Detener grabación" : "Grabar audio"} className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-md transition disabled:opacity-50 ${recordingAudio ? "bg-red-600 shadow-red-600/20 hover:bg-red-700" : "bg-[#003f73] shadow-[#003f73]/20 hover:bg-[#003461]"}`}>{recordingAudio ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-4 w-4" />}</button> : <button type="submit" aria-label={sending ? "Enviando mensaje" : "Enviar mensaje"} disabled={sending || manualInputLocked || (!draft.trim() && !pendingMedia.length)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#003f73] text-white shadow-md shadow-[#003f73]/20 transition hover:bg-[#003461] disabled:opacity-50">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>}</div>
            </>}
          </div></form>
        </>}
      </section>
    </main>
  )
}
