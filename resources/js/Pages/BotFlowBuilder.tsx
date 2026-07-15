"use client"

import { createPortal } from "react-dom"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { usePage } from "@inertiajs/react"
import { toast } from "sonner"
import { Plus, RefreshCcw, Zap, Loader2, Trash2, RotateCcw, CircleDot, CircleHelp, ArrowLeft, PanelLeft, Settings2, X, ArrowDown, InfoIcon, FileText, AudioLines, ImageIcon, Video } from "lucide-react"
import {
  applyNodeChanges,
  ReactFlow,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Connection,
  type Edge,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Button } from "shadcn/components/ui/button"
import { Input } from "shadcn/components/ui/input"
import { Textarea } from "shadcn/components/ui/textarea"
import { Checkbox } from "shadcn/components/ui/checkbox"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "shadcn/components/ui/select"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "shadcn/components/ui/card"
import { cn } from "shadcn/lib/utils"
import { Badge } from "shadcn/components/ui/badge"

type NodeType = "text" | "buttons" | "list" | "input" | "handoff" | "person_lookup" | "image" | "document" | "video" | "audio"

interface BotFlow {
  id: number
  name: string
  description?: string | null
  start_node_id?: number | null
  is_active: boolean
  is_default?: boolean
  deleted_at?: string | null
}

interface BotNode {
  id: number
  flow_id: number
  key: string | null
  type: NodeType
  body: string | null
  settings: any
  next_node_id: number | null
  deleted_at?: string | null
}

interface TrashedNodeSummary {
  id: number
  flow_id: number
  flow_name?: string | null
  key: string | null
  type: NodeType
  deleted_at?: string | null
}

interface TemplateVariableOption {
  key: string
  label: string
  kind: "builtin" | "flow"
}

interface CanvasNodeData extends Record<string, unknown> {
  label: string
  preview: string
  imagePreviewUrl?: string | null
  videoPreviewUrl?: string | null
  audioPreviewUrl?: string | null
  documentPreviewUrl?: string | null
  mediaDisplayName?: string | null
  type: NodeType
  typeLabel: string
  isStart: boolean
  isSelected: boolean
  isReadOnly: boolean
  canDelete: boolean
  canSource: boolean
  canToggleAutoAdvance: boolean
  autoAdvanceEnabled: boolean
  sourceHandles: Array<{
    id: string
    label: string
    tone?: BranchTone
    hasConnection?: boolean
  }>
  onSelect: () => void
  onDelete: () => void
  onToggleAutoAdvance: () => void
  onRemoveConnection: (handleId: string) => void
  deleting: boolean
}

const branchToneCycle = ["info", "success", "warning", "danger"] as const
type BranchTone = "default" | "info" | "success" | "warning" | "danger"

const getIndexedBranchTone = (index: number): BranchTone => branchToneCycle[index % branchToneCycle.length]

function HoverTooltip({
  label,
  children,
  position = "bottom",
  align = "center",
}: {
  label: string
  children: React.ReactNode
  position?: "top" | "bottom"
  align?: "left" | "center" | "right"
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const updateTooltipPosition = () => {
    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const top = position === "top" ? rect.top - 8 : rect.bottom + 8
    const left =
      align === "left"
        ? rect.left
        : align === "right"
          ? rect.right
          : rect.left + rect.width / 2

    setCoords({ top, left })
  }

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => {
        updateTooltipPosition()
        setOpen(true)
      }}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {mounted && open && coords
        ? createPortal(
          <div
            className={cn(
              "pointer-events-none fixed z-[10000]",
              position === "top" ? "-translate-y-full" : "",
              align === "left"
                ? ""
                : align === "right"
                  ? "-translate-x-full"
                  : "-translate-x-1/2",
            )}
            style={{ top: coords.top, left: coords.left }}
          >
            <div className="whitespace-nowrap rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-lg">
              {label}
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}

const CanvasBotNode = memo(function CanvasBotNode({ data }: NodeProps<FlowNode<CanvasNodeData, "botNode">>) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  const getHandleToneClass = (tone?: BranchTone) => {
    switch (tone) {
      case "info":
        return "!bg-sky-500"
      case "success":
        return "!bg-emerald-500"
      case "warning":
        return "!bg-amber-500"
      case "danger":
        return "!bg-red-500"
      default:
        return "!bg-[#013765]"
    }
  }

  return (
    <div
      className={cn(
        "relative min-w-[320px] max-w-[320px] rounded-2xl border bg-white px-3.5 py-3.5 shadow-[0_10px_30px_rgba(15,23,42,0.08)] transition-all",
        data.isStart
          ? "border-emerald-400 shadow-[0_0_0_2px_rgba(52,211,153,0.18),0_10px_30px_rgba(15,23,42,0.08)]"
          : isAlephooNodeType(data.type)
            ? "border-amber-400 bg-gradient-to-b from-amber-50/80 to-white shadow-[0_0_0_2px_rgba(251,191,36,0.18),0_10px_30px_rgba(15,23,42,0.08)]"
            : data.isSelected
              ? "border-[#013765] ring-2 ring-[#013765]/15"
              : "border-slate-200",
      )}
    >
      {data.isStart ? (
        <div className="pointer-events-none absolute inset-x-5 top-0 h-1 rounded-b-full bg-emerald-400" />
      ) : null}
      {!data.isStart && isAlephooNodeType(data.type) ? (
        <>
          <div className="pointer-events-none absolute inset-x-5 top-0 h-1.5 rounded-b-full bg-amber-400" />
        </>
      ) : null}

      <Handle
        type="target"
        position={Position.Top}
        className="!h-8 !w-8 !bg-[#013765]/10 rounded-full"
        onMouseEnter={() => setHoveredItem("target")}
        onMouseLeave={() => setHoveredItem((current) => (current === "target" ? null : current))}
      >
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-[#013765] shadow-lg" />
      </Handle>

      {hoveredItem === "target" ? (
        <div className="pointer-events-none absolute left-1/2 top-0 z-30 -translate-x-1/2 -translate-y-[calc(100%+0.5rem)]">
          <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-lg">
            Entrada del nodo
          </div>
        </div>
      ) : null}

      <div
        role="button"
        tabIndex={0}
        onClick={data.onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            data.onSelect()
          }
        }}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{data.label}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {data.typeLabel}
              </span>
              {isAlephooNodeType(data.type) ? (
                <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  Impacta en Alephoo
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {data.canToggleAutoAdvance ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  data.onToggleAutoAdvance()
                }}
                onMouseEnter={() => setHoveredItem("auto-advance")}
                onMouseLeave={() => setHoveredItem((current) => (current === "auto-advance" ? null : current))}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-xl border transition-colors",
                  data.autoAdvanceEnabled
                    ? "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                    : "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100",
                )}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            ) : null}

            {data.canDelete ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  data.onDelete()
                }}
                onMouseEnter={() => setHoveredItem("delete")}
                onMouseLeave={() => setHoveredItem((current) => (current === "delete" ? null : current))}
                className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600 transition-colors hover:bg-red-100"
              >
                {data.deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            ) : null}
          </div>
        </div>

        {hoveredItem === "auto-advance" ? (
          <div className="pointer-events-none absolute right-12 top-10 z-30">
            <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-lg">
              {data.autoAdvanceEnabled ? "Desactivar autodisparo de la salida" : "Activar autodisparo de la salida"}
            </div>
          </div>
        ) : null}

        {data.canDelete && hoveredItem === "delete" ? (
          <div className="pointer-events-none absolute right-1 top-10 z-30">
            <div className="rounded-xl border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-600 shadow-lg">
              Eliminar nodo
            </div>
          </div>
        ) : null}

        {data.type === "image" ? (
          <div className="mt-3 overflow-hidden rounded-xl bg-slate-50 text-[11px] leading-relaxed text-slate-600">
            {data.imagePreviewUrl ? (
              <img
                src={data.imagePreviewUrl}
                alt={data.label}
                className="h-32 w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex items-center gap-3 bg-slate-100 px-3 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#013765] shadow-sm">
                  <ImageIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-800">
                    Imagen sin configurar
                  </p>
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Imagen
                  </p>
                </div>
              </div>
            )}
            {data.preview ? (
              <div className="border-t border-slate-200 bg-slate-100 px-3 py-2 text-slate-700">
                {data.preview}
              </div>
            ) : null}
          </div>
        ) : data.type === "video" ? (
          <div className="mt-3 overflow-hidden rounded-xl bg-slate-50 text-[11px] leading-relaxed text-slate-600">
            {data.videoPreviewUrl ? (
              <video
                src={data.videoPreviewUrl}
                controls
                preload="metadata"
                className="h-32 w-full bg-black object-cover"
              />
            ) : (
              <div className="flex items-center gap-3 bg-slate-100 px-3 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#013765] shadow-sm">
                  <Video className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-800">
                    Video sin configurar
                  </p>
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Video
                  </p>
                </div>
              </div>
            )}
            {data.preview ? (
              <div className="border-t border-slate-200 bg-slate-100 px-3 py-2 text-slate-700">
                {data.preview}
              </div>
            ) : null}
          </div>
        ) : data.type === "audio" ? (
          <div className="mt-3 overflow-hidden rounded-xl bg-slate-50 text-[11px] leading-relaxed text-slate-600">
            <div className="flex items-center gap-3 bg-slate-100 px-3 py-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#013765] shadow-sm">
                <AudioLines className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-800">
                  {data.mediaDisplayName || "Audio sin configurar"}
                </p>
                {data.audioPreviewUrl ? (
                  <audio src={data.audioPreviewUrl} controls className="mt-1 w-full" />
                ) : (
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Audio
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : data.type === "document" ? (
          <div className="mt-3 overflow-hidden rounded-xl bg-slate-50 text-[11px] leading-relaxed text-slate-600">
            <a
              href={data.documentPreviewUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.stopPropagation()
                if (!data.documentPreviewUrl) {
                  e.preventDefault()
                }
              }}
              className={cn(
                "flex items-center gap-3 bg-slate-100 px-3 py-3 text-left transition-colors",
                data.documentPreviewUrl ? "hover:bg-slate-200" : "cursor-default",
              )}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#013765] shadow-sm">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-800">
                  {data.mediaDisplayName || "Documento sin configurar"}
                </p>
                <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  Documento
                </p>
              </div>
            </a>
            {data.preview ? (
              <div className="border-t border-slate-200 bg-slate-100 px-3 py-2 text-slate-700">
                {data.preview}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
            {data.preview || "Sin mensaje configurado."}
          </div>
        )}

        {data.sourceHandles.length > 1 ? (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {data.sourceHandles.map((handle) => (
              <span
                key={handle.id}
                className={cn(
                  "inline-flex min-w-0 items-center justify-center whitespace-nowrap rounded-full border px-2 py-0.5 text-center text-[10px] font-medium",
                  handle.tone === "info"
                    ? "border-sky-200 bg-sky-50 text-sky-700"
                    : handle.tone === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : handle.tone === "warning"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : handle.tone === "danger"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-slate-200 bg-slate-100 text-slate-600",
                )}
              >
                {handle.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {data.canSource
        ? data.sourceHandles.map((handle, index) => {
          const left =
            data.sourceHandles.length === 1
              ? "50%"
              : `${((index + 1) / (data.sourceHandles.length + 1)) * 100}%`

          return (
            <Handle
              key={handle.id}
              id={handle.id}
              type="source"
              position={Position.Bottom}
              className={cn(
                "!h-8 !w-8 !bg-[#013765]/10 rounded-full"
              )}
              style={{ left }}
              onMouseEnter={() => setHoveredItem(handle.id)}
              onMouseLeave={() => setHoveredItem((current) => (current === handle.id ? null : current))}
            >
              <span
                className={cn(
                  "pointer-events-none absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-lg",
                  getHandleToneClass(handle.tone),
                )}
              />
            </Handle>
          )
        })
        : null}

      {data.canSource
        ? data.sourceHandles.map((handle, index) => {
          if (hoveredItem !== handle.id) return null

          const left =
            data.sourceHandles.length === 1
              ? "50%"
              : `${((index + 1) / (data.sourceHandles.length + 1)) * 100}%`

          return (
            <div
              key={`${handle.id}-tooltip`}
              className="pointer-events-none absolute bottom-0 z-30 -translate-x-1/2 translate-y-[calc(100%+0.5rem)]"
              style={{ left }}
            >
              <div
                className={cn(
                  "rounded-xl border bg-white px-2.5 py-1 text-[11px] font-medium shadow-lg",
                  handle.tone === "info"
                    ? "border-sky-200 text-sky-700"
                    : handle.tone === "success"
                      ? "border-emerald-200 text-emerald-700"
                      : handle.tone === "warning"
                        ? "border-amber-200 text-amber-700"
                        : handle.tone === "danger"
                          ? "border-red-200 text-red-700"
                          : "border-slate-200 text-slate-700",
                )}
              >
                Salida: {handle.label}
              </div>
            </div>
          )
        })
        : null}

      {data.canSource
        ? data.sourceHandles.map((handle, index) => {
          if (hoveredItem !== handle.id || !handle.hasConnection) return null
          if (data.isReadOnly) return null

          const left =
            data.sourceHandles.length === 1
              ? "50%"
              : `${((index + 1) / (data.sourceHandles.length + 1)) * 100}%`

          return (
            <button
              key={`${handle.id}-remove`}
              type="button"
              className="absolute bottom-2 z-30 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-red-200 bg-white text-red-500 shadow-md transition-colors hover:bg-red-50 hover:text-red-600"
              style={{ left }}
              onClick={(e) => {
                e.stopPropagation()
                data.onRemoveConnection(handle.id)
              }}
              onMouseEnter={() => setHoveredItem(handle.id)}
            >
              <X className="h-3 w-3" />
            </button>
          )
        })
        : null}

    </div>
  )
})

const API_BASE = (import.meta.env.VITE_APP_URL || "").replace(/\/$/, "")

const MAX_BUTTONS = 3 // WhatsApp/Meta permite hasta 3 botones reply
const MAX_LIST_ROWS = 10
const NODE_KEY_MAX = 80
const TEXT_MESSAGE_MAX = 4096
const INTERACTIVE_MESSAGE_MAX = 1024
const INPUT_VARIABLE_MAX = 80
const REGEX_MAX = 255
const ERROR_MESSAGE_MAX = 4096
const MEDIA_SOURCE_MAX = 2048
const MEDIA_FILENAME_MAX = 240
const BUTTON_ID_MAX = 256
const BUTTON_TITLE_MAX = 20
const LIST_BUTTON_TEXT_MAX = 20
const LIST_SECTION_TITLE_MAX = 24
const LIST_ROW_ID_MAX = 200
const LIST_ROW_TITLE_MAX = 24
const LIST_ROW_DESCRIPTION_MAX = 72

const getNodeBodyMaxLength = (type: NodeType) =>
  type === "buttons" || type === "list" || type === "image" || type === "video" || type === "document"
    ? INTERACTIVE_MESSAGE_MAX
    : TEXT_MESSAGE_MAX

const getNodeTypeLabel = (type: NodeType) => {
  switch (type) {
    case "text":
      return "Texto"
    case "buttons":
      return "Botones"
    case "list":
      return "Lista"
    case "input":
      return "Capturar dato"
    case "person_lookup":
      return "Buscar datos personales"
    case "image":
      return "Imagen"
    case "document":
      return "Documento"
    case "video":
      return "Video"
    case "audio":
      return "Audio"
    case "handoff":
      return "Desactivar bot y pasar a operador"
    default:
      return type
  }
}

const nodeTypeOptions: NodeType[] = [
  "text",
  "image",
  "document",
  "video",
  "audio",
  "buttons",
  "list",
  "input",
  "person_lookup",
  "handoff",
]

function NodeTypeSelectItem({ type }: { type: NodeType }) {
  if (type === "person_lookup") {
    return (
      <SelectItem value={type}>
        <div className="flex w-full items-center justify-between gap-2">
          <span>Buscar datos personales por DNI</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            Alephoo
          </span>
        </div>
      </SelectItem>
    )
  }

  return <SelectItem value={type}>{getNodeTypeLabel(type)}</SelectItem>
}

const isAlephooNodeType = (type: NodeType) => {
  return type === "person_lookup"
}

const isMediaNodeType = (type: NodeType) => {
  return type === "image" || type === "document" || type === "video" || type === "audio"
}

const serializeNodeSnapshot = (node: BotNode | null) => {
  if (!node) return ""

  return JSON.stringify({
    ...node,
    settings: node.settings ?? {},
  })
}

export default function BotFlowBuilder({ readOnly = false }: { readOnly?: boolean }) {
  const { props } = usePage() as any
  const isReadOnly = Boolean(readOnly || !props?.auth?.permissions?.can_manage_flows)
  const [flows, setFlows] = useState<BotFlow[]>([])
  const [selectedFlowId, setSelectedFlowId] = useState<number | null>(null)

  const [nodes, setNodes] = useState<BotNode[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)

  const [loadingFlows, setLoadingFlows] = useState(false)
  const [loadingNodes, setLoadingNodes] = useState(false)
  const [savingNode, setSavingNode] = useState(false)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [creatingFlow, setCreatingFlow] = useState(false)
  const [creatingNode, setCreatingNode] = useState(false)
  const [savingFlow, setSavingFlow] = useState(false)
  const [deletingFlowId, setDeletingFlowId] = useState<number | null>(null)
  const [deletingNodeId, setDeletingNodeId] = useState<number | null>(null)
  const [restoringFlowId, setRestoringFlowId] = useState<number | null>(null)
  const [restoringNodeId, setRestoringNodeId] = useState<number | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [flowsDrawerOpen, setFlowsDrawerOpen] = useState(false)
  const [flowConfigOpen, setFlowConfigOpen] = useState(false)
  const [loadingTrash, setLoadingTrash] = useState(false)
  const [trashedFlows, setTrashedFlows] = useState<BotFlow[]>([])
  const [trashedNodes, setTrashedNodes] = useState<TrashedNodeSummary[]>([])
  const [trashSearch, setTrashSearch] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<
    | { type: "flow"; id: number; name: string }
    | { type: "node"; id: number; name: string }
    | null
  >(null)
  const [createModal, setCreateModal] = useState<"flow" | "node" | null>(null)
  const [regexHelpOpen, setRegexHelpOpen] = useState(false)
  const [messageHelpOpen, setMessageHelpOpen] = useState(false)
  const [templateVariableOpen, setTemplateVariableOpen] = useState(false)
  const [templateVariableQuery, setTemplateVariableQuery] = useState("")
  const [templateVariableSelectedIndex, setTemplateVariableSelectedIndex] = useState(0)
  const [templateVariableStart, setTemplateVariableStart] = useState<number | null>(null)
  const [templateVariablePosition, setTemplateVariablePosition] = useState({ top: 0, left: 0 })
  const [pendingNavigation, setPendingNavigation] = useState<
    | { type: "flow"; id: number }
    | { type: "node"; id: number }
    | { type: "close_node" }
    | null
  >(null)

  const [newFlowName, setNewFlowName] = useState("")
  const [newNodeKey, setNewNodeKey] = useState("")
  const [newNodeType, setNewNodeType] = useState<NodeType>("text")
  const [editFlowName, setEditFlowName] = useState("")
  const [editFlowStartNodeId, setEditFlowStartNodeId] = useState<number | null>(null)

  // Estado local editable del nodo
  const [editNode, setEditNode] = useState<BotNode | null>(null)
  const lastSavedNodeSnapshotRef = useRef("")
  const messageTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const mediaFileInputRef = useRef<HTMLInputElement | null>(null)
  const templateVariableOptionRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Flow seleccionado
  const selectedFlow = useMemo(
    () => flows.find((f) => f.id === selectedFlowId) ?? null,
    [flows, selectedFlowId],
  )

  const hasUnsavedChanges = useMemo(() => {
    return serializeNodeSnapshot(editNode) !== lastSavedNodeSnapshotRef.current
  }, [editNode])

  const hasUnsavedFlowChanges = useMemo(() => {
    return (
      editFlowName.trim() !== (selectedFlow?.name ?? "") ||
      editFlowStartNodeId !== (selectedFlow?.start_node_id ?? null)
    )
  }, [editFlowName, editFlowStartNodeId, selectedFlow?.name, selectedFlow?.start_node_id])

  const startNodeOptions = useMemo(() => {
    return nodes.map((n) => ({
      id: n.id,
      label: n.key || `node_${n.id}`,
    }))
  }, [nodes])

  const templateVariableOptions = useMemo<TemplateVariableOption[]>(() => {
    const builtins: TemplateVariableOption[] = [
      { key: "chat.id", label: "chat.id", kind: "builtin" },
      { key: "chat.status", label: "chat.status", kind: "builtin" },
      { key: "contact.name", label: "contact.name", kind: "builtin" },
      { key: "contact.whatsapp_id", label: "contact.whatsapp_id", kind: "builtin" },
      { key: "flow.id", label: "flow.id", kind: "builtin" },
      { key: "node.id", label: "node.id", kind: "builtin" },
      { key: "node.key", label: "node.key", kind: "builtin" },
    ]

    const personLookupVars: TemplateVariableOption[] = [
      { key: "persona_encontrada", label: "persona_encontrada", kind: "flow" },
      { key: "persona_lookup_status", label: "persona_lookup_status", kind: "flow" },
      { key: "persona_id", label: "persona_id", kind: "flow" },
      { key: "persona_nombres", label: "persona_nombres", kind: "flow" },
      { key: "persona_apellidos", label: "persona_apellidos", kind: "flow" },
      { key: "persona_documento", label: "persona_documento", kind: "flow" },
      { key: "persona_fecha_nacimiento", label: "persona_fecha_nacimiento", kind: "flow" },
      { key: "persona_genero", label: "persona_genero", kind: "flow" },
      { key: "persona_obra_social", label: "persona_obra_social", kind: "flow" },
      { key: "persona_obra_social_id", label: "persona_obra_social_id", kind: "flow" },
      { key: "persona_plan_id", label: "persona_plan_id", kind: "flow" },
      { key: "persona_email", label: "persona_email", kind: "flow" },
      { key: "persona_contacto_telefono", label: "persona_contacto_telefono", kind: "flow" },
      { key: "persona_contacto_telefono_2", label: "persona_contacto_telefono_2", kind: "flow" },
      { key: "persona_planes_activos", label: "persona_planes_activos", kind: "flow" },
    ]

    const flowVars = nodes
      .filter((node) => node.type === "input")
      .map((node) => String(node?.settings?.variable ?? "").trim())
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .map((value) => ({ key: value, label: value, kind: "flow" as const }))

    const mergedFlowVars = [...flowVars, ...personLookupVars].filter(
      (value, index, arr) => arr.findIndex((item) => item.key === value.key) === index,
    )

    return [...mergedFlowVars, ...builtins]
  }, [nodes])

  const filteredTemplateVariableOptions = useMemo(() => {
    const q = templateVariableQuery.trim().toLowerCase()
    if (!q) return templateVariableOptions
    return templateVariableOptions.filter((item) => item.key.toLowerCase().includes(q))
  }, [templateVariableOptions, templateVariableQuery])

  useEffect(() => {
    if (!templateVariableOpen) return
    const current = templateVariableOptionRefs.current[templateVariableSelectedIndex]
    current?.scrollIntoView({ block: "nearest" })
  }, [templateVariableOpen, templateVariableSelectedIndex])

  const inputVariableValidation = useMemo(() => {
    if (!editNode || editNode.type !== "input") {
      return {
        normalized: "",
        isEmpty: false,
        hasInvalidFormat: false,
        collidesWithBuiltin: false,
        alreadyExists: false,
        isAvailable: true,
      }
    }

    const normalized = String(editNode.settings?.variable ?? "").trim()
    const lower = normalized.toLowerCase()
    const builtins = new Set(
      templateVariableOptions
        .filter((item) => item.kind === "builtin")
        .map((item) => item.key.toLowerCase()),
    )
    const existingFlowVars = new Set(
      nodes
        .filter((node) => node.type === "input" && node.id !== editNode.id)
        .map((node) => String(node.settings?.variable ?? "").trim().toLowerCase())
        .filter(Boolean),
    )

    const isEmpty = normalized.length === 0
    const hasInvalidFormat = normalized.length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)
    const collidesWithBuiltin = normalized.length > 0 && builtins.has(lower)
    const alreadyExists = normalized.length > 0 && existingFlowVars.has(lower)
    const isAvailable = !isEmpty && !hasInvalidFormat && !collidesWithBuiltin && !alreadyExists


    return {
      normalized,
      isEmpty,
      hasInvalidFormat,
      collidesWithBuiltin,
      alreadyExists,
      isAvailable,
    }
  }, [editNode, nodes, templateVariableOptions])

  const canSaveNode = useMemo(() => {
    if (!editNode) return false
    if (editNode.type === "input") {
      const mode = editNode.settings?.response_mode ?? "text"
      const hasOptions =
        mode === "buttons"
          ? Array.isArray(editNode.settings?.buttons) && editNode.settings.buttons.length > 0
          : mode === "list"
            ? Array.isArray(editNode.settings?.rows) && editNode.settings.rows.length > 0
            : true

      return inputVariableValidation.isAvailable && hasOptions
    }
    if (isMediaNodeType(editNode.type)) {
      const source = String(editNode.settings?.source ?? "").trim()
      return source.length > 0
    }

    return true
  }, [editNode, inputVariableValidation.isAvailable])


  // Cargar flows al inicio
  useEffect(() => {
    const loadFlows = async () => {
      try {
        setLoadingFlows(true)
        const res = await fetch(`${API_BASE}/api/bot/flows`)
        if (!res.ok) {
          console.error("Error al cargar flows", await res.text())
          return
        }
        const data = await res.json()
        const list: BotFlow[] = data.flows ?? data
        setFlows(list)

        if (!selectedFlowId && list.length > 0) {
          const def = list.find((f) => f.is_default)
          setSelectedFlowId(def?.id ?? list[0].id)
        }
      } catch (err) {
        console.error("Error de red al cargar flows:", err)
      } finally {
        setLoadingFlows(false)
      }
    }

    loadFlows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cargar nodes cuando cambia el flow seleccionado
  useEffect(() => {
    if (!selectedFlowId) {
      setNodes([])
      setSelectedNodeId(null)
      setEditNode(null)
      return
    }

    const loadNodes = async () => {
      try {
        setLoadingNodes(true)
        const res = await fetch(`${API_BASE}/api/bot/flows/${selectedFlowId}/nodes`)
        if (!res.ok) {
          console.error("Error al cargar nodes", await res.text())
          return
        }
        const data = await res.json()
        const list: BotNode[] = data.nodes ?? data
        setNodes(list)
        setSelectedNodeId(null)
      } catch (err) {
        console.error("Error de red al cargar nodes:", err)
      } finally {
        setLoadingNodes(false)
      }
    }

    loadNodes()
  }, [selectedFlowId, flows])

  // Sincronizar editNode con selectedNodeId
  useEffect(() => {
    if (!selectedNodeId) {
      setEditNode(null)
      lastSavedNodeSnapshotRef.current = ""
      return
    }
    const n = nodes.find((x) => x.id === selectedNodeId) ?? null
    if (!n) {
      setEditNode(null)
      lastSavedNodeSnapshotRef.current = ""
      return
    }

    const normalizedNode = { ...n, settings: n.settings ?? {} }

    setEditNode((prev) => {
      if (!prev || prev.id !== normalizedNode.id) {
        lastSavedNodeSnapshotRef.current = serializeNodeSnapshot(normalizedNode)
        return normalizedNode
      }

      return prev
    })
  }, [selectedNodeId, nodes])

  useEffect(() => {
    setEditFlowName(selectedFlow?.name ?? "")
    setEditFlowStartNodeId(selectedFlow?.start_node_id ?? null)
  }, [selectedFlow?.id, selectedFlow?.name, selectedFlow?.start_node_id])

  useEffect(() => {
    setTemplateVariableOpen(false)
    setTemplateVariableQuery("")
    setTemplateVariableStart(null)
    setTemplateVariableSelectedIndex(0)
  }, [selectedNodeId, selectedFlowId])

  useEffect(() => {
    if (templateVariableSelectedIndex < filteredTemplateVariableOptions.length) return
    setTemplateVariableSelectedIndex(0)
  }, [filteredTemplateVariableOptions.length, templateVariableSelectedIndex])

  useEffect(() => {
    if (!trashOpen) return

    const loadTrash = async () => {
      try {
        setLoadingTrash(true)
        const res = await fetch(`${API_BASE}/api/bot/trash`)
        if (!res.ok) {
          console.error("Error al cargar papelera", await res.text())
          return
        }

        const data = await res.json()
        setTrashedFlows(data.flows ?? [])
        setTrashedNodes(data.nodes ?? [])
      } catch (err) {
        console.error("Error de red cargando papelera:", err)
      } finally {
        setLoadingTrash(false)
      }
    }

    loadTrash()
  }, [trashOpen])

  // Crear flujo nuevo
  const handleCreateFlow = async () => {
    if (isReadOnly) return
    const name = newFlowName.trim()
    if (!name) return

    setCreatingFlow(true)
    try {
      const res = await fetch(`${API_BASE}/api/bot/flows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        console.error("Error al crear flow", await res.text())
        return
      }
      const flow: BotFlow = await res.json()
      setFlows((prev) => [...prev, flow])
      setSelectedFlowId(flow.id)
      setNewFlowName("")
      setCreateModal(null)
    } catch (err) {
      console.error("Error de red al crear flow:", err)
    } finally {
      setCreatingFlow(false)
    }
  }

  const handleSaveFlow = async () => {
    if (isReadOnly) return
    if (!selectedFlow) return

    const name = editFlowName.trim()
    const startNodeId = editFlowStartNodeId ?? null
    const nameChanged = name !== (selectedFlow.name ?? "")
    const startNodeChanged = startNodeId !== (selectedFlow.start_node_id ?? null)
    if (!name || (!nameChanged && !startNodeChanged)) return

    setSavingFlow(true)
    try {
      let updatedFlow: BotFlow = selectedFlow

      if (nameChanged) {
        const res = await fetch(`${API_BASE}/api/bot/flows/${selectedFlow.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description: selectedFlow.description ?? null,
          }),
        })

        if (!res.ok) {
          console.error("Error al guardar flow", await res.text())
          return
        }

        const data = await res.json()
        updatedFlow = { ...updatedFlow, ...(data.flow ?? data) }
      }

      if (startNodeChanged) {
        const startNodeRes = await fetch(`${API_BASE}/api/bot/flows/${selectedFlow.id}/start-node`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start_node_id: startNodeId }),
        })

        if (!startNodeRes.ok) {
          console.error("Error seteando start node", await startNodeRes.text())
          return
        }

        const startNodeData = await startNodeRes.json()
        updatedFlow = { ...updatedFlow, ...(startNodeData.flow ?? startNodeData) }
      }

      setFlows((prev) => prev.map((flow) => (flow.id === updatedFlow.id ? { ...flow, ...updatedFlow } : flow)))
      setEditFlowName(updatedFlow.name)
      setEditFlowStartNodeId(updatedFlow.start_node_id ?? null)
      setFlowConfigOpen(false)
    } catch (err) {
      console.error("Error de red guardando flow:", err)
    } finally {
      setSavingFlow(false)
    }
  }


  const handleMakeDefault = async (flowId: number) => {
    if (isReadOnly) return
    try {
      const res = await fetch(`${API_BASE}/api/bot/flows/${flowId}/make-default`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      if (!res.ok) {
        console.error("Error al setear default", await res.text())
        return
      }

      // actualizar estado local: solo uno default
      setFlows((prev) => prev.map((f) => ({ ...f, is_default: f.id === flowId })))
    } catch (err) {
      console.error("Error de red seteando default:", err)
    }
  }

  const handleDeleteFlow = async (flowId: number) => {
    if (isReadOnly) return
    setDeletingFlowId(flowId)
    try {
      const res = await fetch(`${API_BASE}/api/bot/flows/${flowId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      })

      if (!res.ok) {
        console.error("Error al eliminar flow", await res.text())
        return
      }

      const data = await res.json()
      const replacementDefaultFlowId: number | null = data.replacement_default_flow_id ?? null
      const remainingFlows = flows
        .filter((item) => item.id !== flowId)
        .map((item) => ({
          ...item,
          is_default: replacementDefaultFlowId ? item.id === replacementDefaultFlowId : item.is_default,
        }))
      const nextFlowId =
        remainingFlows.find((item) => item.id === selectedFlowId)?.id ??
        remainingFlows.find((item) => item.is_default)?.id ??
        remainingFlows[0]?.id ??
        null

      setFlows(remainingFlows)

      if (selectedFlowId === flowId) {
        setSelectedFlowId(nextFlowId)
        setNodes([])
        setSelectedNodeId(null)
        setEditNode(null)
      }
    } catch (err) {
      console.error("Error de red eliminando flow:", err)
    } finally {
      setDeletingFlowId(null)
    }
  }

  const handleRestoreFlow = async (flowId: number) => {
    if (isReadOnly) return
    setRestoringFlowId(flowId)
    try {
      const res = await fetch(`${API_BASE}/api/bot/flows/${flowId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      if (!res.ok) {
        console.error("Error al restaurar flow", await res.text())
        return
      }

      const data = await res.json()
      const restoredFlow: BotFlow = data.flow ?? data

      setFlows((prev) => [...prev, restoredFlow].sort((a, b) => a.id - b.id))
      setTrashedFlows((prev) => prev.filter((flow) => flow.id !== flowId))
      setTrashedNodes((prev) => prev.filter((node) => node.flow_id !== flowId))

      if (!selectedFlowId) {
        setSelectedFlowId(restoredFlow.id)
      }
    } catch (err) {
      console.error("Error de red restaurando flow:", err)
    } finally {
      setRestoringFlowId(null)
    }
  }

  // Crear nodo nuevo
  const handleCreateNode = async () => {
    if (isReadOnly) return
    if (!selectedFlowId) return
    const key = newNodeKey.trim()
    if (!key) return

    setCreatingNode(true)
    try {
      const res = await fetch(`${API_BASE}/api/bot/flows/${selectedFlowId}/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          type: newNodeType,
          body: "",
          settings: {},
        }),
      })
      if (!res.ok) {
        console.error("Error al crear node", await res.text())
        return
      }
      const node: BotNode = await res.json()
      const flowRes = await fetch(`${API_BASE}/api/bot/flows`)
      const flowData = await flowRes.json()
      setFlows(flowData.flows ?? flowData)
      setNodes((prev) => [...prev, node])
      setSelectedNodeId(null)
      setEditNode(null)
      setNewNodeKey("")
      setNewNodeType("text")
      setCreateModal(null)
    } catch (err) {
      console.error("Error de red al crear node:", err)
    } finally {
      setCreatingNode(false)
    }
  }

  const handleCreateModalSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (createModal === "flow") {
      handleCreateFlow()
      return
    }

    if (createModal === "node") {
      handleCreateNode()
    }
  }

  // Guardar cambios del nodo
  const handleDeleteNode = async (nodeId: number) => {
    if (isReadOnly) return
    setDeletingNodeId(nodeId)
    try {
      const res = await fetch(`${API_BASE}/api/bot/nodes/${nodeId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      })
      if (!res.ok) {
        console.error("Error al eliminar node", await res.text())
        return
      }

      const data = await res.json()
      const replacementNodeId: number | null = data.replacement_node_id ?? null
      const updatedFlow: BotFlow | null = data.flow ?? null

      setFlows((prev) =>
        prev.map((flow) => (updatedFlow && flow.id === updatedFlow.id ? { ...flow, ...updatedFlow } : flow)),
      )
      setNodes((prev) =>
        prev
          .filter((item) => item.id !== nodeId)
          .map((item) => ({
            ...item,
            next_node_id: item.next_node_id === nodeId ? null : item.next_node_id,
            settings: clearDeletedNodeReferencesFromSettings(item.settings, nodeId),
          })),
      )

      if (selectedNodeId === nodeId) {
        setSelectedNodeId(replacementNodeId)
      }
    } catch (err) {
      console.error("Error de red eliminando node:", err)
    } finally {
      setDeletingNodeId(null)
    }
  }

  const handleRestoreNode = async (nodeId: number) => {
    if (isReadOnly) return
    setRestoringNodeId(nodeId)
    try {
      const res = await fetch(`${API_BASE}/api/bot/nodes/${nodeId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      if (!res.ok) {
        console.error("Error al restaurar node", await res.text())
        return
      }

      const data = await res.json()
      const restoredNode: BotNode = data.node ?? data
      const updatedFlow: BotFlow | null = data.flow ?? null

      setTrashedNodes((prev) => prev.filter((node) => node.id !== nodeId))
      setFlows((prev) =>
        prev.map((flow) => (updatedFlow && flow.id === updatedFlow.id ? { ...flow, ...updatedFlow } : flow)),
      )

      if (selectedFlowId === restoredNode.flow_id) {
        setNodes((prev) => [...prev, restoredNode].sort((a, b) => a.id - b.id))
      }
    } catch (err) {
      console.error("Error de red restaurando node:", err)
    } finally {
      setRestoringNodeId(null)
    }
  }

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return

    const pendingDelete = confirmDelete
    setConfirmDelete(null)

    if (pendingDelete.type === "flow") {
      await handleDeleteFlow(pendingDelete.id)
      return
    }

    await handleDeleteNode(pendingDelete.id)
  }

  const handleSaveNode = async () => {
    if (isReadOnly) return false
    if (!editNode) return
    if (!canSaveNode) return false

    const snapshot = {
      ...editNode,
      settings: editNode.settings ?? {},
    }

    setSavingNode(true)
    try {
      const res = await fetch(`${API_BASE}/api/bot/nodes/${snapshot.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      })
      if (!res.ok) {
        console.error("Error al guardar node", await res.text())
        return false
      }

      const updated: BotNode = await res.json()
      const normalizedUpdated = { ...updated, settings: updated.settings ?? {} }

      lastSavedNodeSnapshotRef.current = serializeNodeSnapshot(normalizedUpdated)
      setNodes((prev) => prev.map((n) => (n.id === updated.id ? normalizedUpdated : n)))
      setEditNode((prev) => (prev && prev.id === updated.id ? normalizedUpdated : prev))
      return true
    } catch (err) {
      console.error("Error de red al guardar node:", err)
      return false
    } finally {
      setSavingNode(false)
    }
  }

  const requestSelectFlow = (flowId: number) => {
    if (flowId === selectedFlowId) return

    if (selectedNodeId && hasUnsavedChanges) {
      setPendingNavigation({ type: "flow", id: flowId })
      return
    }

    setFlowsDrawerOpen(false)
    setSelectedFlowId(flowId)
  }

  const requestSelectNode = (nodeId: number) => {
    if (nodeId === selectedNodeId) return

    if (selectedNodeId && hasUnsavedChanges) {
      setPendingNavigation({ type: "node", id: nodeId })
      return
    }

    setSelectedNodeId(nodeId)
  }

  const requestCloseNodePanel = () => {
    if (!selectedNodeId) return

    if (hasUnsavedChanges) {
      setPendingNavigation({ type: "close_node" })
      return
    }

    setSelectedNodeId(null)
  }

  const syncEditNodeFromSavedState = (nodeId: number | null) => {
    if (!nodeId) {
      setEditNode(null)
      lastSavedNodeSnapshotRef.current = ""
      return
    }

    const savedNode = nodes.find((node) => node.id === nodeId) ?? null
    if (!savedNode) {
      setEditNode(null)
      lastSavedNodeSnapshotRef.current = ""
      return
    }

    const normalizedNode = { ...savedNode, settings: savedNode.settings ?? {} }
    lastSavedNodeSnapshotRef.current = serializeNodeSnapshot(normalizedNode)
    setEditNode(normalizedNode)
  }

  const handleDiscardPendingNavigation = () => {
    if (!pendingNavigation) return

    const nextNavigation = pendingNavigation
    setPendingNavigation(null)

    if (nextNavigation.type === "flow") {
      syncEditNodeFromSavedState(null)
      setSelectedFlowId(nextNavigation.id)
      return
    }

    if (nextNavigation.type === "close_node") {
      syncEditNodeFromSavedState(null)
      setSelectedNodeId(null)
      return
    }

    syncEditNodeFromSavedState(nextNavigation.id)
    setSelectedNodeId(nextNavigation.id)
  }

  // Helpers para settings según tipo
  const ensureSettings = <T,>(defaults: T): T => {
    return {
      ...defaults,
      ...(editNode?.settings ?? {}),
    } as T
  }

  const nextNodeOptions = useMemo(() => {
    return nodes
      .filter((n) => n.id !== editNode?.id)
      .map((n) => ({
        id: n.id,
        label: `${n.key}`,
      }))
  }, [nodes, editNode?.id])

  const nodesById = useMemo(() => {
    return new Map(nodes.map((n) => [n.id, n]))
  }, [nodes])

  const getNodeLabel = (nodeId: number | null | undefined) => {
    if (!nodeId) return null
    const next = nodesById.get(nodeId)
    return next?.key ?? (next ? `node_${next.id}` : `node_${nodeId}`)
  }

  const getMediaPreviewUrl = (node: BotNode) => {
    const source = String(node.settings?.source ?? "").trim()
    if (!source) return null

    return source.startsWith("http://") || source.startsWith("https://")
      ? source
      : `${API_BASE}${source.startsWith("/") ? "" : "/"}${source}`
  }

  const getMediaDisplayName = (node: BotNode) => {
    const source = String(node.settings?.source ?? "").trim()
    const filename = String(node.settings?.filename ?? "").trim()

    return filename || source.split("/").filter(Boolean).pop() || null
  }

  const getNodePreview = (node: BotNode) => {
    if (node.type === "audio") {
      return ""
    }

    if (node.type === "image" || node.type === "document" || node.type === "video") {
      return String(node.body ?? "").replace(/\s+/g, " ").trim().slice(0, 90)
    }

    if (isMediaNodeType(node.type)) {
      const source = String(node.settings?.source ?? "").trim()
      const filename = String(node.settings?.filename ?? "").trim()
      const caption = String(node.body ?? "").replace(/\s+/g, " ").trim()
      return [filename || source || "Media sin configurar", caption].filter(Boolean).join(" · ").slice(0, 90)
    }

    return (node.body ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90)
  }

  const getNodeBranches = (node: BotNode) => {
    const settings = node.settings ?? {}
    const branches: Array<{
      id: string
      label: string
      targetId: number | null
      targetLabel: string | null
      tone?: BranchTone
    }> = []

    if (
      (node.type === "buttons" || (node.type === "input" && settings.response_mode === "buttons")) &&
      Array.isArray(settings.buttons)
    ) {
      settings.buttons.forEach((button: any, index: number) => {
        const targetId = button?.next_node_id ? Number(button.next_node_id) : null
        branches.push({
          id: `button-${node.id}-${index}`,
          label: button?.title?.trim() || `Botón ${index + 1}`,
          targetId,
          targetLabel: getNodeLabel(targetId),
          tone: getIndexedBranchTone(index),
        })
      })
    } else if (
      (node.type === "list" || (node.type === "input" && settings.response_mode === "list")) &&
      Array.isArray(settings.rows)
    ) {
      settings.rows.forEach((row: any, index: number) => {
        const targetId = row?.next_node_id ? Number(row.next_node_id) : null
        branches.push({
          id: `row-${node.id}-${index}`,
          label: row?.title?.trim() || `Opción ${index + 1}`,
          targetId,
          targetLabel: getNodeLabel(targetId),
          tone: getIndexedBranchTone(index),
        })
      })
    } else if (node.type === "person_lookup") {
      const successTargetId = node.next_node_id ? Number(node.next_node_id) : null
      branches.push({
        id: `person-success-${node.id}`,
        label: "Encontrado",
        targetId: successTargetId,
        targetLabel: getNodeLabel(successTargetId),
        tone: "success",
      })

      const notFoundTargetId = settings.not_found_next_node_id ? Number(settings.not_found_next_node_id) : null
      branches.push({
        id: `person-not-found-${node.id}`,
        label: "No encontrado",
        targetId: notFoundTargetId,
        targetLabel: getNodeLabel(notFoundTargetId),
        tone: "warning",
      })

      const errorTargetId = settings.error_next_node_id ? Number(settings.error_next_node_id) : null
      branches.push({
        id: `person-error-${node.id}`,
        label: "Error",
        targetId: errorTargetId,
        targetLabel: getNodeLabel(errorTargetId),
        tone: "danger",
      })
    } else if (node.type === "text" || isMediaNodeType(node.type) || (node.type === "input" && settings.response_mode !== "buttons" && settings.response_mode !== "list")) {
      const targetId = node.next_node_id ? Number(node.next_node_id) : null
      branches.push({
        id: `next-${node.id}`,
        label: "Siguiente",
        targetId,
        targetLabel: getNodeLabel(targetId),
      })
    }

    return branches
  }

  const referencedNodeIds = useMemo(() => {
    const ids = new Set<number>()

    nodes.forEach((node) => {
      getNodeBranches(node).forEach((branch) => {
        if (branch.targetId) {
          ids.add(branch.targetId)
        }
      })
    })

    return ids
  }, [nodes])

  const treeRootIds = useMemo(() => {
    const roots: number[] = []

    if (selectedFlow?.start_node_id && nodesById.has(selectedFlow.start_node_id)) {
      roots.push(selectedFlow.start_node_id)
    }

    nodes.forEach((node) => {
      if (!referencedNodeIds.has(node.id) && !roots.includes(node.id)) {
        roots.push(node.id)
      }
    })

    if (roots.length === 0 && nodes[0]) {
      roots.push(nodes[0].id)
    }

    return roots
  }, [nodes, nodesById, referencedNodeIds, selectedFlow?.start_node_id])

  const persistNodePatch = async (nodeId: number, patch: Partial<BotNode>) => {
    const current = nodesById.get(nodeId)
    if (!current) return

    const payload = {
      ...current,
      ...patch,
      settings: {
        ...(current.settings ?? {}),
        ...((patch.settings as Record<string, unknown> | undefined) ?? {}),
      },
    }

    try {
      const res = await fetch(`${API_BASE}/api/bot/nodes/${nodeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        console.error("Error guardando cambios del canvas", await res.text())
        return
      }

      const updated: BotNode = await res.json()
      const normalizedUpdated = { ...updated, settings: updated.settings ?? {} }
      setNodes((prev) => prev.map((node) => (node.id === nodeId ? normalizedUpdated : node)))
      setEditNode((prev) => (prev && prev.id === nodeId ? normalizedUpdated : prev))
    } catch (err) {
      console.error("Error de red guardando cambios del canvas:", err)
    }
  }

  const handleToggleCanvasAutoAdvance = (nodeId: number) => {
    const node = nodesById.get(nodeId)
    if (!node) return
    if (node.type !== "text" && !isMediaNodeType(node.type)) return

    const nextValue = !Boolean(node.settings?.auto_advance)
    const nextSettings = {
      ...(node.settings ?? {}),
      auto_advance: nextValue,
    }

    setNodes((prev) =>
      prev.map((item) =>
        item.id === nodeId
          ? {
            ...item,
            settings: nextSettings,
          }
          : item,
      ),
    )

    setEditNode((prev) =>
      prev && prev.id === nodeId
        ? {
          ...prev,
          settings: nextSettings,
        }
        : prev,
    )

    void persistNodePatch(nodeId, {
      settings: nextSettings as any,
    })
  }

  const computedCanvasNodes = useMemo<FlowNode<CanvasNodeData>[]>(() => {
    return nodes.map((node, index) => {
      const position = node.settings?.canvas_position ?? {
        x: 120 + (index % 4) * 320,
        y: 80 + Math.floor(index / 4) * 180,
      }

      return {
        id: String(node.id),
        type: "botNode",
        position,
        draggable: !isReadOnly,
        data: {
          label: node.key || `node_${node.id}`,
          preview: getNodePreview(node),
          imagePreviewUrl: node.type === "image" ? getMediaPreviewUrl(node) : null,
          videoPreviewUrl: node.type === "video" ? getMediaPreviewUrl(node) : null,
          audioPreviewUrl: node.type === "audio" ? getMediaPreviewUrl(node) : null,
          documentPreviewUrl: node.type === "document" ? getMediaPreviewUrl(node) : null,
          mediaDisplayName: isMediaNodeType(node.type) ? getMediaDisplayName(node) : null,
          type: node.type,
          typeLabel: getNodeTypeLabel(node.type),
          isStart: selectedFlow?.start_node_id === node.id,
          isSelected: selectedNodeId === node.id,
          isReadOnly,
          canDelete: !isReadOnly,
          canSource:
            node.type === "text" ||
            isMediaNodeType(node.type) ||
            node.type === "input" ||
            node.type === "person_lookup" ||
            node.type === "buttons" ||
            node.type === "list",
          canToggleAutoAdvance: !isReadOnly && (node.type === "text" || isMediaNodeType(node.type)),
          autoAdvanceEnabled: Boolean(node.settings?.auto_advance),
          sourceHandles:
            node.type === "person_lookup"
              ? [
                {
                  id: "success",
                  label: "Encontrado",
                  tone: "success" as const,
                  hasConnection: Boolean(node.next_node_id),
                },
                {
                  id: "not_found",
                  label: "No encontrado",
                  tone: "warning" as const,
                  hasConnection: Boolean(node.settings?.not_found_next_node_id),
                },
                {
                  id: "error",
                  label: "Error",
                  tone: "danger" as const,
                  hasConnection: Boolean(node.settings?.error_next_node_id),
                },
              ]
              : node.type === "buttons" || (node.type === "input" && node.settings?.response_mode === "buttons")
                ? getNodeBranches(node).map((branch) => ({
                  id: branch.id,
                  label: branch.label,
                  tone: branch.tone ?? "default",
                  hasConnection: Boolean(branch.targetId),
                }))
                : node.type === "list" || (node.type === "input" && node.settings?.response_mode === "list")
                  ? getNodeBranches(node).map((branch) => ({
                    id: branch.id,
                    label: branch.label,
                    tone: branch.tone ?? "default",
                    hasConnection: Boolean(branch.targetId),
                  }))
                  : node.type === "text" || isMediaNodeType(node.type) || (node.type === "input" && node.settings?.response_mode !== "buttons" && node.settings?.response_mode !== "list")
                    ? [{ id: "next", label: "Siguiente", tone: "default" as const, hasConnection: Boolean(node.next_node_id) }]
                    : [],
          deleting: deletingNodeId === node.id,
          onSelect: () => requestSelectNode(node.id),
          onToggleAutoAdvance: () => handleToggleCanvasAutoAdvance(node.id),
          onRemoveConnection: (handleId) => handleCanvasDisconnect(node.id, handleId),
          onDelete: () =>
            !isReadOnly &&
            setConfirmDelete({
              type: "node",
              id: node.id,
              name: node.key || `node_${node.id}`,
            }),
        },
      }
    })
  }, [nodes, selectedFlow?.start_node_id, selectedNodeId, deletingNodeId, isReadOnly])

  const [flowCanvasNodes, setFlowCanvasNodes] = useState<FlowNode<CanvasNodeData>[]>([])

  useEffect(() => {
    setFlowCanvasNodes(computedCanvasNodes)
  }, [computedCanvasNodes])

  const flowCanvasEdges = useMemo<Edge[]>(() => {
    const edges: Edge[] = []

    nodes.forEach((node) => {
      getNodeBranches(node).forEach((branch) => {
        if (!branch.targetId) return

        edges.push({
          id: branch.id,
          source: String(node.id),
          target: String(branch.targetId),
          interactionWidth: 28,
          sourceHandle:
            node.type === "buttons" ||
              node.type === "list" ||
              (node.type === "input" && (node.settings?.response_mode === "buttons" || node.settings?.response_mode === "list"))
              ? branch.id
              : node.type === "person_lookup"
                ? branch.tone === "success"
                  ? "success"
                  : branch.tone === "warning"
                    ? "not_found"
                    : branch.tone === "danger"
                      ? "error"
                      : undefined
                : node.type === "text" || isMediaNodeType(node.type) || (node.type === "input" && node.settings?.response_mode !== "buttons" && node.settings?.response_mode !== "list")
                  ? "next"
                  : undefined,
          label: branch.label === "Siguiente" ? undefined : branch.label,
          type: "smoothstep",
          animated: branch.tone === "success" || branch.tone === "warning" || branch.tone === "danger",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color:
              branch.tone === "info"
                ? "#0ea5e9"
                : branch.tone === "success"
                  ? "#16a34a"
                  : branch.tone === "warning"
                    ? "#d97706"
                    : branch.tone === "danger"
                      ? "#dc2626"
                      : "#64748b",
          },
          style: {
            stroke:
              branch.tone === "info"
                ? "#0ea5e9"
                : branch.tone === "success"
                  ? "#16a34a"
                  : branch.tone === "warning"
                    ? "#d97706"
                    : branch.tone === "danger"
                      ? "#dc2626"
                      : "#64748b",
            strokeWidth: 2,
          },
          labelStyle: { fontSize: 10, fill: "#334155" },
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.95 },
        })
      })
    })

    return edges
  }, [nodes])

  const handleCanvasNodesChange = (changes: NodeChange<FlowNode<CanvasNodeData>>[]) => {
    if (isReadOnly) return
    setFlowCanvasNodes((current) => applyNodeChanges(changes, current))
  }

  const handleCanvasNodeDragStop = (_event: unknown, flowNode: FlowNode<CanvasNodeData>) => {
    if (isReadOnly) return
    const nodeId = Number(flowNode.id)
    if (!Number.isFinite(nodeId)) return

    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? {
            ...node,
            settings: {
              ...(node.settings ?? {}),
              canvas_position: flowNode.position,
            },
          }
          : node,
      ),
    )

    void persistNodePatch(nodeId, {
      settings: {
        ...(nodesById.get(nodeId)?.settings ?? {}),
        canvas_position: flowNode.position,
      } as any,
    })
  }

  const handleCanvasConnect = (connection: Connection) => {
    if (isReadOnly) return
    const sourceId = Number(connection.source)
    const targetId = Number(connection.target)
    if (!sourceId || !targetId) return

    const sourceNode = nodesById.get(sourceId)
    if (!sourceNode) return
    if (!(
      sourceNode.type === "text" ||
      isMediaNodeType(sourceNode.type) ||
      sourceNode.type === "input" ||
      sourceNode.type === "person_lookup" ||
      sourceNode.type === "buttons" ||
      sourceNode.type === "list"
    )) {
      return
    }

    const sourceHandle = connection.sourceHandle ?? "next"
    const settings = sourceNode.settings ?? {}

    const patch: Partial<BotNode> =
      sourceNode.type === "person_lookup"
        ? sourceHandle === "not_found"
          ? {
            settings: {
              ...settings,
              not_found_next_node_id: targetId,
            } as any,
          }
          : sourceHandle === "error"
            ? {
              settings: {
                ...settings,
                error_next_node_id: targetId,
              } as any,
            }
            : { next_node_id: targetId }
        : (sourceNode.type === "buttons" || (sourceNode.type === "input" && settings.response_mode === "buttons")) && Array.isArray(settings.buttons)
          ? {
            settings: {
              ...settings,
              buttons: settings.buttons.map((button: any, index: number) =>
                `button-${sourceNode.id}-${index}` === sourceHandle
                  ? { ...button, next_node_id: targetId }
                  : button,
              ),
            } as any,
          }
          : (sourceNode.type === "list" || (sourceNode.type === "input" && settings.response_mode === "list")) && Array.isArray(settings.rows)
            ? {
              settings: {
                ...settings,
                rows: settings.rows.map((row: any, index: number) =>
                  `row-${sourceNode.id}-${index}` === sourceHandle
                    ? { ...row, next_node_id: targetId }
                    : row,
                ),
              } as any,
            }
            : { next_node_id: targetId }

    setNodes((prev) =>
      prev.map((node) =>
        node.id === sourceId
          ? {
            ...node,
            ...(sourceNode.type === "person_lookup"
              ? sourceHandle === "not_found"
                ? {
                  settings: {
                    ...(node.settings ?? {}),
                    not_found_next_node_id: targetId,
                  },
                }
                : sourceHandle === "error"
                  ? {
                    settings: {
                      ...(node.settings ?? {}),
                      error_next_node_id: targetId,
                    },
                  }
                  : { next_node_id: targetId }
              : (sourceNode.type === "buttons" || (sourceNode.type === "input" && node.settings?.response_mode === "buttons")) && Array.isArray(node.settings?.buttons)
                ? {
                  settings: {
                    ...(node.settings ?? {}),
                    buttons: node.settings.buttons.map((button: any, index: number) =>
                      `button-${sourceNode.id}-${index}` === sourceHandle
                        ? { ...button, next_node_id: targetId }
                        : button,
                    ),
                  },
                }
                : (sourceNode.type === "list" || (sourceNode.type === "input" && node.settings?.response_mode === "list")) && Array.isArray(node.settings?.rows)
                  ? {
                    settings: {
                      ...(node.settings ?? {}),
                      rows: node.settings.rows.map((row: any, index: number) =>
                        `row-${sourceNode.id}-${index}` === sourceHandle
                          ? { ...row, next_node_id: targetId }
                          : row,
                      ),
                    },
                  }
                  : { next_node_id: targetId }),
          }
          : node,
      ),
    )

    void persistNodePatch(sourceId, patch)
  }

  const handleCanvasDisconnect = (sourceId: number, sourceHandle: string) => {
    if (isReadOnly) return
    const sourceNode = nodesById.get(sourceId)
    if (!sourceNode) return

    const settings = sourceNode.settings ?? {}

    const patch: Partial<BotNode> =
      sourceNode.type === "person_lookup"
        ? sourceHandle === "not_found"
          ? {
            settings: {
              ...settings,
              not_found_next_node_id: null,
            } as any,
          }
          : sourceHandle === "error"
            ? {
              settings: {
                ...settings,
                error_next_node_id: null,
              } as any,
            }
            : { next_node_id: null }
        : (sourceNode.type === "buttons" || (sourceNode.type === "input" && settings.response_mode === "buttons")) && Array.isArray(settings.buttons)
          ? {
            settings: {
              ...settings,
              buttons: settings.buttons.map((button: any, index: number) =>
                `button-${sourceNode.id}-${index}` === sourceHandle
                  ? { ...button, next_node_id: null }
                  : button,
              ),
            } as any,
          }
          : (sourceNode.type === "list" || (sourceNode.type === "input" && settings.response_mode === "list")) && Array.isArray(settings.rows)
            ? {
              settings: {
                ...settings,
                rows: settings.rows.map((row: any, index: number) =>
                  `row-${sourceNode.id}-${index}` === sourceHandle
                    ? { ...row, next_node_id: null }
                    : row,
                ),
              } as any,
            }
            : { next_node_id: null }

    setNodes((prev) =>
      prev.map((node) =>
        node.id === sourceId
          ? {
            ...node,
            ...(sourceNode.type === "person_lookup"
              ? sourceHandle === "not_found"
                ? {
                  settings: {
                    ...(node.settings ?? {}),
                    not_found_next_node_id: null,
                  },
                }
                : sourceHandle === "error"
                  ? {
                    settings: {
                      ...(node.settings ?? {}),
                      error_next_node_id: null,
                    },
                  }
                  : { next_node_id: null }
              : (sourceNode.type === "buttons" || (sourceNode.type === "input" && node.settings?.response_mode === "buttons")) && Array.isArray(node.settings?.buttons)
                ? {
                  settings: {
                    ...(node.settings ?? {}),
                    buttons: node.settings.buttons.map((button: any, index: number) =>
                      `button-${sourceNode.id}-${index}` === sourceHandle
                        ? { ...button, next_node_id: null }
                        : button,
                    ),
                  },
                }
                : (sourceNode.type === "list" || (sourceNode.type === "input" && node.settings?.response_mode === "list")) && Array.isArray(node.settings?.rows)
                  ? {
                    settings: {
                      ...(node.settings ?? {}),
                      rows: node.settings.rows.map((row: any, index: number) =>
                        `row-${sourceNode.id}-${index}` === sourceHandle
                          ? { ...row, next_node_id: null }
                          : row,
                      ),
                    },
                  }
                  : { next_node_id: null }),
          }
          : node,
      ),
    )

    void persistNodePatch(sourceId, patch)
  }

  const handleCanvasEdgeClick = (_event: unknown, edge: Edge) => {
    if (isReadOnly) return
    const sourceId = Number(edge.source)
    if (!sourceId) return
    handleCanvasDisconnect(sourceId, edge.sourceHandle ?? "next")
  }

  const canvasNodeTypes = useMemo(
    () => ({
      botNode: CanvasBotNode,
    }),
    [],
  )

  const startNodeLabel = useMemo(() => {
    if (!selectedFlow?.start_node_id) return "no definido"
    const n = nodes.find((x) => x.id === selectedFlow.start_node_id)
    return n?.key || (n ? `node_${n.id}` : `Cargando...`)
  }, [selectedFlow?.start_node_id, nodes])

  const clearDeletedNodeReferencesFromSettings = (settings: any, deletedNodeId: number) => {
    const nextSettings = settings && typeof settings === "object" ? { ...settings } : {}

    if (Array.isArray(nextSettings.buttons)) {
      nextSettings.buttons = nextSettings.buttons.map((button: any) => {
        if (!button || typeof button !== "object") return button
        return Number(button.next_node_id ?? 0) === deletedNodeId
          ? { ...button, next_node_id: null }
          : button
      })
    }

    if (Array.isArray(nextSettings.rows)) {
      nextSettings.rows = nextSettings.rows.map((row: any) => {
        if (!row || typeof row !== "object") return row
        return Number(row.next_node_id ?? 0) === deletedNodeId
          ? { ...row, next_node_id: null }
          : row
      })
    }

    return nextSettings
  }

  const getTextareaCaretPosition = (textarea: HTMLTextAreaElement, position: number) => {
    const div = document.createElement("div")
    const style = window.getComputedStyle(textarea)
    const properties = [
      "boxSizing",
      "width",
      "height",
      "overflowX",
      "overflowY",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "fontStyle",
      "fontVariant",
      "fontWeight",
      "fontStretch",
      "fontSize",
      "fontSizeAdjust",
      "lineHeight",
      "fontFamily",
      "textAlign",
      "textTransform",
      "textIndent",
      "textDecoration",
      "letterSpacing",
      "wordSpacing",
      "tabSize",
      "whiteSpace",
    ] as const

    div.style.position = "absolute"
    div.style.visibility = "hidden"
    div.style.whiteSpace = "pre-wrap"
    div.style.wordBreak = "break-word"

    properties.forEach((prop) => {
      div.style[prop] = style[prop]
    })

    div.textContent = textarea.value.slice(0, position)

    const span = document.createElement("span")
    span.textContent = textarea.value.slice(position) || "."
    div.appendChild(span)

    document.body.appendChild(div)

    const top = span.offsetTop - textarea.scrollTop + parseFloat(style.borderTopWidth || "0")
    const left = span.offsetLeft - textarea.scrollLeft + parseFloat(style.borderLeftWidth || "0")

    document.body.removeChild(div)

    return { top, left, lineHeight: parseFloat(style.lineHeight || "20") }
  }

  const updateTemplateVariableAutocomplete = (value: string, cursorPosition: number | null) => {
    if (cursorPosition === null || cursorPosition < 0) {
      setTemplateVariableOpen(false)
      setTemplateVariableQuery("")
      setTemplateVariableStart(null)
      setTemplateVariableSelectedIndex(0)
      return
    }

    const textBeforeCursor = value.slice(0, cursorPosition)
    const match = textBeforeCursor.match(/\{\{\s*([A-Za-z0-9._-]*)$/)

    if (!match || match.index === undefined) {
      setTemplateVariableOpen(false)
      setTemplateVariableQuery("")
      setTemplateVariableStart(null)
      setTemplateVariableSelectedIndex(0)
      return
    }

    const textarea = messageTextareaRef.current
    if (textarea) {
      const caret = getTextareaCaretPosition(textarea, cursorPosition)
      setTemplateVariablePosition({
        top: caret.top + caret.lineHeight + 8,
        left: Math.min(caret.left, Math.max(16, textarea.clientWidth - 260)),
      })
    }

    setTemplateVariableOpen(true)
    setTemplateVariableQuery(match[1] ?? "")
    setTemplateVariableStart(match.index)
    setTemplateVariableSelectedIndex(0)
  }

  const insertTemplateVariable = (variableKey: string) => {
    if (!editNode || templateVariableStart === null) return

    const textarea = messageTextareaRef.current
    const cursorPosition = textarea?.selectionStart ?? (editNode.body ?? "").length
    const currentValue = editNode.body ?? ""
    const replacement = `{{ ${variableKey} }}`
    const nextValue =
      currentValue.slice(0, templateVariableStart) +
      replacement +
      currentValue.slice(cursorPosition)

    setEditNode((prev) =>
      prev
        ? {
          ...prev,
          body: nextValue.slice(0, getNodeBodyMaxLength(prev.type)),
        }
        : prev,
    )

    setTemplateVariableOpen(false)
    setTemplateVariableQuery("")
    setTemplateVariableStart(null)
    setTemplateVariableSelectedIndex(0)

    setTimeout(() => {
      if (!textarea) return
      const nextCursor = templateVariableStart + replacement.length
      textarea.focus()
      textarea.setSelectionRange(nextCursor, nextCursor)
    }, 0)
  }

  const trashSearchNormalized = trashSearch.trim().toLowerCase()

  const filteredTrashedFlows = useMemo(() => {
    if (!trashSearchNormalized) return trashedFlows

    return trashedFlows.filter((flow) => {
      return [flow.name, flow.description, String(flow.id)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(trashSearchNormalized))
    })
  }, [trashedFlows, trashSearchNormalized])

  const filteredTrashedNodes = useMemo(() => {
    if (!trashSearchNormalized) return trashedNodes

    return trashedNodes.filter((node) => {
      return [node.key, node.flow_name, node.type, String(node.id), String(node.flow_id)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(trashSearchNormalized))
    })
  }, [trashedNodes, trashSearchNormalized])

  const removeDeletedNodeReferencesFromSettings = (settings: any, deletedNodeId: number) => {
    const nextSettings = settings && typeof settings === "object" ? { ...settings } : {}

    if (Array.isArray(nextSettings.buttons)) {
      nextSettings.buttons = nextSettings.buttons.map((button: any) =>
        Number(button?.next_node_id) === deletedNodeId
          ? { ...button, next_node_id: null }
          : button,
      )
    }

    if (Array.isArray(nextSettings.rows)) {
      nextSettings.rows = nextSettings.rows.map((row: any) =>
        Number(row?.next_node_id) === deletedNodeId
          ? { ...row, next_node_id: null }
          : row,
      )
    }

    if (Number(nextSettings.not_found_next_node_id) === deletedNodeId) {
      nextSettings.not_found_next_node_id = null
    }

    if (Number(nextSettings.error_next_node_id) === deletedNodeId) {
      nextSettings.error_next_node_id = null
    }

    return nextSettings
  }

  // Inputs de settings específicos
  const renderSettingsFields = () => {
    if (!editNode) return null

    const t = editNode.type

    if (t === "buttons") {
      const settings = ensureSettings<{ buttons: any[] }>({
        buttons: [],
      })
      const buttons = settings.buttons ?? []

      const updateButton = (index: number, field: string, value: any) => {
        const newButtons = buttons.map((b: any, i: number) =>
          i === index ? { ...b, [field]: value } : b,
        )
        setEditNode((prev) =>
          prev
            ? {
              ...prev,
              settings: { ...settings, buttons: newButtons },
            }
            : prev,
        )
      }

      const addButton = () => {
        if (buttons.length >= MAX_BUTTONS) return

        const newButtons = [
          ...buttons,
          { id: `opcion_${buttons.length + 1}`, title: "Opción", next_node_id: null },
        ]

        setEditNode((prev) =>
          prev ? { ...prev, settings: { ...settings, buttons: newButtons } } : prev,
        )
      }

      const removeButton = (index: number) => {
        const newButtons = buttons.filter((_: any, i: number) => i !== index)
        setEditNode((prev) =>
          prev ? { ...prev, settings: { ...settings, buttons: newButtons } } : prev,
        )
      }

      return (
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-medium text-sm">Botones</h4>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {buttons.length}/{MAX_BUTTONS}
              </span>
            </div>
            <Button
              variant="outline"
              className="h-9 w-full justify-center border-dashed border-[#013765]/40 bg-[#013765]/[0.03] text-[#013765] hover:bg-[#013765] hover:text-white"
              onClick={addButton}
              disabled={buttons.length >= MAX_BUTTONS}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Agregar botón
            </Button>

            {buttons.length >= MAX_BUTTONS && (
              <p className="text-[11px] text-muted-foreground">
                Límite alcanzado: máximo {MAX_BUTTONS} botones.
              </p>
            )}
          </div>

          <div className="space-y-3">
            {buttons.map((btn: any, index: number) => (
              <div
                key={index}
                className="border rounded-lg p-3 bg-muted/30 space-y-2"
              >
                <div className="flex gap-2">
                  <label className="flex-1 text-[11px] font-medium text-slate-600">
                    ID
                  </label>
                  <label className="flex-1 text-[11px] font-medium text-slate-600">
                    Texto de la opción
                  </label>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={btn.id ?? ""}
                    readOnly
                    placeholder="ID interno (ej: menu_horarios)"
                    maxLength={BUTTON_ID_MAX}
                    className="text-xs bg-slate-100 text-slate-500"
                  />
                  <Input
                    value={btn.title ?? ""}
                    onChange={(e) => updateButton(index, "title", e.target.value.slice(0, BUTTON_TITLE_MAX))}
                    maxLength={BUTTON_TITLE_MAX}
                    placeholder="Texto del botón"
                    className="text-xs"
                  />
                </div>
                <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>ID {(btn.id ?? "").length}/{BUTTON_ID_MAX}</span>
                  <span>Título {(btn.title ?? "").length}/{BUTTON_TITLE_MAX}</span>
                </div>

                <label className="block text-[11px] font-medium text-slate-600">
                  Siguiente nodo
                </label>
                <div className="flex gap-2 items-center">
                  <Select
                    value={btn.next_node_id ? String(btn.next_node_id) : "none"}
                    onValueChange={(val) =>
                      updateButton(index, "next_node_id", val === "none" ? null : Number(val))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Ir a..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Finalizar flujo</SelectItem>
                      {nextNodeOptions.map((opt) => (
                        <SelectItem key={opt.id} value={String(opt.id)}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-600 transition-colors hover:bg-red-100 hover:text-red-700"
                    onClick={() => removeButton(index)}
                    title="Eliminar botón"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {buttons.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay botones configurados. Agregá uno para empezar.
              </p>
            )}
          </div>
        </div>
      )
    }

    if (t === "list") {
      const settings = ensureSettings<{
        button_text: string
        section_title: string
        rows: any[]
      }>({
        button_text: "Ver opciones",
        section_title: "Opciones",
        rows: [],
      })
      const rows = settings.rows ?? []

      const updateRow = (index: number, field: string, value: any) => {
        const newRows = rows.map((r: any, i: number) =>
          i === index ? { ...r, [field]: value } : r,
        )
        setEditNode((prev) =>
          prev ? { ...prev, settings: { ...settings, rows: newRows } } : prev,
        )
      }

      const addRow = () => {
        if (rows.length >= MAX_LIST_ROWS) return

        const newRows = [
          ...rows,
          {
            id: `row_${rows.length + 1}`,
            title: "Opción lista",
            description: "",
            next_node_id: null,
          },
        ]

        setEditNode((prev) =>
          prev ? { ...prev, settings: { ...settings, rows: newRows } } : prev,
        )
      }

      const removeRow = (index: number) => {
        const newRows = rows.filter((_: any, i: number) => i !== index)
        setEditNode((prev) =>
          prev ? { ...prev, settings: { ...settings, rows: newRows } } : prev,
        )
      }

      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs mb-1 block text-muted-foreground">
                Texto del botón
              </label>
              <Input
                value={settings.button_text ?? ""}
                onChange={(e) =>
                  setEditNode((prev) =>
                    prev
                      ? {
                        ...prev,
                        settings: { ...settings, button_text: e.target.value.slice(0, LIST_BUTTON_TEXT_MAX) },
                      }
                      : prev,
                  )
                }
                maxLength={LIST_BUTTON_TEXT_MAX}
                className="text-xs"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {(settings.button_text ?? "").length}/{LIST_BUTTON_TEXT_MAX}
              </p>
            </div>

            <div>
              <label className="text-xs mb-1 block text-muted-foreground">
                Título de la sección
              </label>
              <Input
                value={settings.section_title ?? ""}
                onChange={(e) =>
                  setEditNode((prev) =>
                    prev
                      ? {
                        ...prev,
                        settings: { ...settings, section_title: e.target.value.slice(0, LIST_SECTION_TITLE_MAX) },
                      }
                      : prev,
                  )
                }
                maxLength={LIST_SECTION_TITLE_MAX}
                className="text-xs"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {(settings.section_title ?? "").length}/{LIST_SECTION_TITLE_MAX}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-medium text-sm">Opciones de la lista</h4>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {rows.length}/{MAX_LIST_ROWS}
              </span>
            </div>
            <Button
              variant="outline"
              className="h-9 w-full justify-center border-dashed border-[#013765]/40 bg-[#013765]/[0.03] text-[#013765] hover:bg-[#013765] hover:text-white"
              onClick={addRow}
              disabled={rows.length >= MAX_LIST_ROWS}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Agregar opción
            </Button>

            {rows.length >= MAX_LIST_ROWS && (
              <p className="text-[11px] text-muted-foreground">
                Límite alcanzado: máximo {MAX_LIST_ROWS} opciones en una lista.
              </p>
            )}
          </div>

          <div className="space-y-3">
            {rows.map((row: any, index: number) => (
              <div
                key={index}
                className="border rounded-lg p-3 bg-muted/30 space-y-2"
              >
                <div className="flex gap-2">
                  <label className="flex-1 text-[11px] font-medium text-slate-600">
                    ID
                  </label>
                  <label className="flex-1 text-[11px] font-medium text-slate-600">
                    Texto de la opción
                  </label>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={row.id ?? ""}
                    readOnly
                    placeholder="ID interno"
                    maxLength={LIST_ROW_ID_MAX}
                    className="text-xs bg-slate-100 text-slate-500"
                  />
                  <Input
                    value={row.title ?? ""}
                    onChange={(e) => updateRow(index, "title", e.target.value.slice(0, LIST_ROW_TITLE_MAX))}
                    maxLength={LIST_ROW_TITLE_MAX}
                    placeholder="Título visible"
                    className="text-xs"
                  />
                </div>
                <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>ID {(row.id ?? "").length}/{LIST_ROW_ID_MAX}</span>
                  <span>Título {(row.title ?? "").length}/{LIST_ROW_TITLE_MAX}</span>
                </div>

                <Input
                  value={row.description ?? ""}
                  onChange={(e) => updateRow(index, "description", e.target.value.slice(0, LIST_ROW_DESCRIPTION_MAX))}
                  placeholder="Descripción (opcional)"
                  maxLength={LIST_ROW_DESCRIPTION_MAX}
                  className="text-xs mt-1"
                />
                <p className="text-[10px] text-muted-foreground">
                  {(row.description ?? "").length}/{LIST_ROW_DESCRIPTION_MAX}
                </p>

                <label className="block text-[11px] font-medium text-slate-600">
                  Siguiente nodo
                </label>
                <div className="flex gap-2 items-center mt-1">
                  <Select
                    value={row.next_node_id ? String(row.next_node_id) : "none"}
                    onValueChange={(val) =>
                      updateRow(index, "next_node_id", val === "none" ? null : Number(val))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Ir a..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Finalizar flujo</SelectItem>
                      {nextNodeOptions.map((opt) => (
                        <SelectItem key={opt.id} value={String(opt.id)}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-600 transition-colors hover:bg-red-100 hover:text-red-700"
                    onClick={() => removeRow(index)}
                    title="Eliminar opción"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {rows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay opciones configuradas. Agregá una para empezar.
              </p>
            )}
          </div>
        </div>
      )
    }

    if (t === "input") {
      // Unificamos "Siguiente nodo" en la columna next_node_id (no en settings)
      const settings = ensureSettings<{
        variable: string
        validation_regex: string
        response_mode: "text" | "buttons" | "list"
        buttons: any[]
        button_text: string
        section_title: string
        rows: any[]
        error_message: string
      }>({
        variable: "",
        validation_regex: "",
        response_mode: "text",
        buttons: [],
        button_text: "Ver opciones",
        section_title: "Opciones",
        rows: [],
        error_message: "Valor inválido, por favor revisá el formato e intentá de nuevo.",
      })

      const update = (field: keyof typeof settings, value: string | any[]) => {
        setEditNode((prev) =>
          prev
            ? {
              ...prev,
              settings: {
                ...settings,
                [field]: value,
              },
            }
            : prev,
        )
      }

      const updateInputButton = (index: number, field: string, value: any) => {
        update(
          "buttons",
          (settings.buttons ?? []).map((button: any, i: number) =>
            i === index ? { ...button, [field]: value } : button,
          ),
        )
      }

      const addInputButton = () => {
        const buttons = settings.buttons ?? []
        if (buttons.length >= MAX_BUTTONS) return

        update("buttons", [
          ...buttons,
          { id: `opcion_${buttons.length + 1}`, title: "Opcion", next_node_id: null },
        ])
      }

      const removeInputButton = (index: number) => {
        update("buttons", (settings.buttons ?? []).filter((_: any, i: number) => i !== index))
      }

      const updateInputRow = (index: number, field: string, value: any) => {
        update(
          "rows",
          (settings.rows ?? []).map((row: any, i: number) =>
            i === index ? { ...row, [field]: value } : row,
          ),
        )
      }

      const addInputRow = () => {
        const rows = settings.rows ?? []
        if (rows.length >= MAX_LIST_ROWS) return

        update("rows", [
          ...rows,
          {
            id: `row_${rows.length + 1}`,
            title: "Opcion lista",
            description: "",
            next_node_id: null,
          },
        ])
      }

      const removeInputRow = (index: number) => {
        update("rows", (settings.rows ?? []).filter((_: any, i: number) => i !== index))
      }

      return (
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <label className="text-xs block text-muted-foreground">
                Nombre de la variable
              </label>
              <Input
                value={settings.variable ?? ""}
                onChange={(e) => update("variable", e.target.value.slice(0, INPUT_VARIABLE_MAX))}
                placeholder="Ej: dni, nro_historia, etc."
                maxLength={INPUT_VARIABLE_MAX}
                className="text-xs"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {(settings.variable ?? "").length}/{INPUT_VARIABLE_MAX}
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium",
                    inputVariableValidation.isAvailable
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700",
                  )}
                >
                  {inputVariableValidation.isAvailable ? "Disponible" : "No disponible"}
                </span>
                <p
                  className={cn(
                    "text-right text-[10px]",
                    inputVariableValidation.isAvailable ? "text-emerald-700" : "text-amber-700",
                  )}
                >
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs mb-1 block text-muted-foreground">
              Tipo de respuesta
            </label>
            <Select
              value={settings.response_mode ?? "text"}
              onValueChange={(value) => update("response_mode", value)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Tipo de respuesta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Texto libre</SelectItem>
                <SelectItem value="buttons">Botones</SelectItem>
                <SelectItem value="list">Lista</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {settings.response_mode === "buttons" ? (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium">Opciones como botones</h4>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {(settings.buttons ?? []).length}/{MAX_BUTTONS}
                </span>
              </div>
              <Button
                variant="outline"
                className="h-9 w-full justify-center border-dashed border-[#013765]/40 bg-white text-[#013765] hover:bg-[#013765] hover:text-white"
                onClick={addInputButton}
                disabled={(settings.buttons ?? []).length >= MAX_BUTTONS}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Agregar boton
              </Button>

              {(settings.buttons ?? []).map((button: any, index: number) => (
                <div key={index} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={button.id ?? ""} readOnly className="h-8 bg-slate-100 text-xs text-slate-500" />
                    <Input
                      value={button.title ?? ""}
                      onChange={(e) => updateInputButton(index, "title", e.target.value.slice(0, BUTTON_TITLE_MAX))}
                      maxLength={BUTTON_TITLE_MAX}
                      placeholder="Texto del boton"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={button.next_node_id ? String(button.next_node_id) : "none"}
                      onValueChange={(val) =>
                        updateInputButton(index, "next_node_id", val === "none" ? null : Number(val))
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Siguiente nodo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Finalizar flujo</SelectItem>
                        {nextNodeOptions.map((opt) => (
                          <SelectItem key={opt.id} value={String(opt.id)}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-600 transition-colors hover:bg-red-100 hover:text-red-700"
                      onClick={() => removeInputButton(index)}
                      title="Eliminar boton"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {settings.response_mode === "list" ? (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs mb-1 block text-muted-foreground">Texto del boton</label>
                  <Input
                    value={settings.button_text ?? ""}
                    onChange={(e) => update("button_text", e.target.value.slice(0, LIST_BUTTON_TEXT_MAX))}
                    maxLength={LIST_BUTTON_TEXT_MAX}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs mb-1 block text-muted-foreground">Titulo de seccion</label>
                  <Input
                    value={settings.section_title ?? ""}
                    onChange={(e) => update("section_title", e.target.value.slice(0, LIST_SECTION_TITLE_MAX))}
                    maxLength={LIST_SECTION_TITLE_MAX}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium">Opciones de lista</h4>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {(settings.rows ?? []).length}/{MAX_LIST_ROWS}
                </span>
              </div>
              <Button
                variant="outline"
                className="h-9 w-full justify-center border-dashed border-[#013765]/40 bg-white text-[#013765] hover:bg-[#013765] hover:text-white"
                onClick={addInputRow}
                disabled={(settings.rows ?? []).length >= MAX_LIST_ROWS}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Agregar opcion
              </Button>

              {(settings.rows ?? []).map((row: any, index: number) => (
                <div key={index} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={row.id ?? ""} readOnly className="h-8 bg-slate-100 text-xs text-slate-500" />
                    <Input
                      value={row.title ?? ""}
                      onChange={(e) => updateInputRow(index, "title", e.target.value.slice(0, LIST_ROW_TITLE_MAX))}
                      maxLength={LIST_ROW_TITLE_MAX}
                      placeholder="Texto de la opcion"
                      className="h-8 text-xs"
                    />
                  </div>
                  <Input
                    value={row.description ?? ""}
                    onChange={(e) => updateInputRow(index, "description", e.target.value.slice(0, LIST_ROW_DESCRIPTION_MAX))}
                    maxLength={LIST_ROW_DESCRIPTION_MAX}
                    placeholder="Descripcion opcional"
                    className="h-8 text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <Select
                      value={row.next_node_id ? String(row.next_node_id) : "none"}
                      onValueChange={(val) =>
                        updateInputRow(index, "next_node_id", val === "none" ? null : Number(val))
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Siguiente nodo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Finalizar flujo</SelectItem>
                        {nextNodeOptions.map((opt) => (
                          <SelectItem key={opt.id} value={String(opt.id)}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-600 transition-colors hover:bg-red-100 hover:text-red-700"
                      onClick={() => removeInputRow(index)}
                      title="Eliminar opcion"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div>
            <div className="mb-1 flex items-center gap-2"><label className="text-xs block text-muted-foreground">
              Regex de validación (opcional)
            </label>
              <button
                type="button"
                onClick={() => setRegexHelpOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-[#013765] transition-colors hover:bg-slate-50"
              >
                <CircleHelp className="h-3.5 w-3.5" />
                Ayuda sobre regex
              </button>
            </div>
            <Input
              value={settings.validation_regex ?? ""}
              onChange={(e) => update("validation_regex", e.target.value.slice(0, REGEX_MAX))}
              placeholder="Ej: ^[0-9]{7,9}$"
              maxLength={REGEX_MAX}
              className="text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {(settings.validation_regex ?? "").length}/{REGEX_MAX}
            </p>
          </div>

          <div>
            <label className="text-xs mb-1 block text-muted-foreground">
              Mensaje de error
            </label>
            <Textarea
              value={settings.error_message ?? ""}
              onChange={(e) => update("error_message", e.target.value.slice(0, ERROR_MESSAGE_MAX))}
              rows={2}
              maxLength={ERROR_MESSAGE_MAX}
              className="text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {(settings.error_message ?? "").length}/{ERROR_MESSAGE_MAX}
            </p>
          </div>
        </div>
      )
    }

    if (t === "person_lookup") {
      const settings = ensureSettings<{
        dni_variable: string
        not_found_message: string
        not_found_next_node_id: number | null
        error_message: string
        error_next_node_id: number | null
      }>({
        dni_variable: "dni",
        not_found_message: "No encontramos datos personales para el DNI ingresado.",
        not_found_next_node_id: null,
        error_message: "No pudimos consultar tus datos en este momento.",
        error_next_node_id: null,
      })

      const update = (field: keyof typeof settings, value: string | number | null) => {
        setEditNode((prev) =>
          prev
            ? {
              ...prev,
              settings: {
                ...settings,
                [field]: value,
              },
            }
            : prev,
        )
      }

      const availableFlowVariables = templateVariableOptions.filter(
        (item) =>
          item.kind === "flow" &&
          !item.key.startsWith("persona_"),
      )

      return (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Variable que contiene el DNI
            </label>
            <Select
              value={settings.dni_variable ?? ""}
              onValueChange={(value) => update("dni_variable", value)}
              disabled={availableFlowVariables.length === 0}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Seleccioná una variable" />
              </SelectTrigger>
              <SelectContent>
                {availableFlowVariables.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {availableFlowVariables.length > 0
                ? "Usá una variable capturada previamente en este flujo."
                : "Primero necesitás un nodo de captura de dato que guarde el DNI en una variable."}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            Este nodo consulta la API del hospital con el DNI guardado en esa variable, guarda los datos personales en variables como
            {" "}
            <span className="font-medium text-slate-700">{"{{ persona_nombres }}"}</span>
            {" "}
            y
            {" "}
            <span className="font-medium text-slate-700">{"{{ persona_apellidos }}"}</span>.
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Mensaje cuando no se encuentra la persona
            </label>
            <Textarea
              value={settings.not_found_message ?? ""}
              onChange={(e) => update("not_found_message", e.target.value.slice(0, TEXT_MESSAGE_MAX))}
              rows={2}
              maxLength={TEXT_MESSAGE_MAX}
              className="text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {(settings.not_found_message ?? "").length}/{TEXT_MESSAGE_MAX}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Siguiente nodo si no se encuentra
            </label>
            <Select
              value={settings.not_found_next_node_id ? String(settings.not_found_next_node_id) : "none"}
              onValueChange={(val) =>
                update("not_found_next_node_id", val === "none" ? null : Number(val))
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Finalizar flujo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Finalizar flujo</SelectItem>
                {nextNodeOptions.map((opt) => (
                  <SelectItem key={opt.id} value={String(opt.id)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Mensaje cuando hay error en la consulta
            </label>
            <Textarea
              value={settings.error_message ?? ""}
              onChange={(e) => update("error_message", e.target.value.slice(0, ERROR_MESSAGE_MAX))}
              rows={2}
              maxLength={ERROR_MESSAGE_MAX}
              className="text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {(settings.error_message ?? "").length}/{ERROR_MESSAGE_MAX}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Siguiente nodo si hay error
            </label>
            <Select
              value={settings.error_next_node_id ? String(settings.error_next_node_id) : "none"}
              onValueChange={(val) =>
                update("error_next_node_id", val === "none" ? null : Number(val))
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Finalizar flujo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Finalizar flujo</SelectItem>
                {nextNodeOptions.map((opt) => (
                  <SelectItem key={opt.id} value={String(opt.id)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )
    }

    if (isMediaNodeType(t)) {
      const settings = ensureSettings<{
        source_kind: "url" | "id"
        source: string
        filename: string
      }>({
        source_kind: "url",
        source: "",
        filename: "",
      })

      const mediaAccept =
        t === "image"
          ? "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          : t === "video"
            ? "video/mp4,video/3gpp,.mp4,.3gp"
            : t === "audio"
              ? "audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/amr,audio/opus,.ogg,.opus,.mp3,.m4a,.aac,.amr"
              : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
      const mediaFormatHint =
        t === "image"
          ? "Formatos aceptados por WhatsApp: JPG, PNG o WEBP. Tamaño máximo: 5 MB."
          : t === "video"
            ? "Formatos aceptados por WhatsApp: MP4 o 3GP. Tamaño máximo: 16 MB."
            : t === "audio"
              ? "Formatos aceptados por WhatsApp: AAC, M4A, MP3, AMR, OGG u OPUS. Tamaño máximo: 16 MB."
              : "Formatos aceptados por WhatsApp: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX o TXT. Tamaño máximo: 100 MB."
      const maxMediaBytes =
        t === "image"
          ? 5 * 1024 * 1024
          : t === "video" || t === "audio"
            ? 16 * 1024 * 1024
            : 100 * 1024 * 1024
      const maxMediaLabel =
        t === "image"
          ? "5 MB"
          : t === "video" || t === "audio"
            ? "16 MB"
            : "100 MB"

      const uploadLocalMedia = async (file: File | null) => {
        if (!file) return
        if (file.size > maxMediaBytes) {
          toast.error(`El archivo supera el limite de WhatsApp para este tipo. Máximo: ${maxMediaLabel}.`)
          return
        }
        setUploadingMedia(true)

        try {
          const formData = new FormData()
          formData.append("file", file)
          formData.append("media_kind", t)

          const res = await fetch(`${API_BASE}/api/bot/media`, {
            method: "POST",
            body: formData,
          })

          if (!res.ok) {
            let errorMessage = "No se pudo subir el archivo"
            const rawError = await res.text()
            try {
              const payload = rawError ? JSON.parse(rawError) : null
              errorMessage = String(payload?.message ?? errorMessage)
            } catch {
              if (rawError) errorMessage = rawError
            }
            toast.error(errorMessage)
            console.error("Error al subir media del bot", errorMessage)
            return
          }

          const data = await res.json()
          setEditNode((prev) =>
            prev
              ? {
                ...prev,
                settings: {
                  ...(prev.settings ?? {}),
                  source_kind: "url",
                  source: String(data.url ?? ""),
                  filename: t === "document" ? String(data.name ?? file.name) : (prev.settings?.filename ?? ""),
                },
              }
              : prev,
          )
        } catch (err) {
          console.error("Error de red subiendo media del bot:", err)
        } finally {
          setUploadingMedia(false)
        }
      }

      const mediaSource = String(settings.source ?? "").trim()
      const mediaName = String(settings.filename ?? "").trim()
      const displayName = mediaName || mediaSource.split("/").filter(Boolean).pop() || "Archivo cargado"
      const previewUrl = mediaSource.startsWith("http://") || mediaSource.startsWith("https://")
        ? mediaSource
        : mediaSource
          ? `${API_BASE}${mediaSource.startsWith("/") ? "" : "/"}${mediaSource}`
          : ""

      return (
        <div className="space-y-3">
          {mediaSource ? (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <div className="border-b border-slate-200 bg-white px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-800">{displayName}</p>
                  <p className="text-[10px] text-slate-500">{getNodeTypeLabel(t)} cargado</p>
                </div>
              </div>
              {t === "image" && previewUrl ? (
                <img src={previewUrl} alt={displayName} className="max-h-44 w-full object-contain bg-white" />
              ) : t === "video" && previewUrl ? (
                <video src={previewUrl} controls preload="metadata" className="max-h-44 w-full bg-black" />
              ) : t === "audio" && previewUrl ? (
                <div className="bg-white p-3">
                  <audio src={previewUrl} controls className="w-full" />
                </div>
              ) : t === "document" && previewUrl ? (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 bg-slate-100 px-3 py-3 text-left transition-colors hover:bg-slate-200"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#013765] shadow-sm">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-800">{displayName}</p>
                    <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                      Abrir documento
                    </p>
                  </div>
                </a>
              ) : null}
              <input
                ref={mediaFileInputRef}
                type="file"
                accept={mediaAccept}
                disabled={uploadingMedia}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0] ?? null
                  void uploadLocalMedia(file)
                  e.currentTarget.value = ""
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => mediaFileInputRef.current?.click()}
                disabled={uploadingMedia}
                className="flex w-full items-center justify-center border-t border-slate-200 bg-slate-100 px-3 py-2 text-xs font-medium text-[#013765] transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {uploadingMedia ? "Subiendo..." : "Reemplazar"}
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              Todavia no hay ningun archivo cargado para este nodo.
            </div>
          )}

          {!mediaSource ? (
            <div className="rounded-lg border border-dashed border-[#013765]/30 bg-white p-3">
              <input
                ref={mediaFileInputRef}
                type="file"
                accept={mediaAccept}
                disabled={uploadingMedia}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0] ?? null
                  void uploadLocalMedia(file)
                  e.currentTarget.value = ""
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => mediaFileInputRef.current?.click()}
                disabled={uploadingMedia}
                className="flex w-full items-center justify-center rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-medium text-[#013765] transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {uploadingMedia ? "Subiendo archivo..." : "Subir archivo"}
              </button>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Selecciona el archivo que enviara este nodo.
              </p>
              <p className="mt-1 text-[10px] font-medium text-slate-500">
                {mediaFormatHint}
              </p>
            </div>
          ) : (
            <p className="text-[10px] font-medium text-slate-500">
              {mediaFormatHint}
            </p>
          )}
        </div>
      )
    }

    // handoff no tiene settings extra
    return null
  }

  const isLinearType = (t: NodeType) => t === "text" || t === "input" || t === "person_lookup" || isMediaNodeType(t)

  const getBranchToneClass = (tone?: BranchTone) => {
    switch (tone) {
      case "info":
        return "border-sky-200 bg-sky-50 text-sky-700"
      case "success":
        return "border-emerald-200 bg-emerald-50 text-emerald-700"
      case "warning":
        return "border-amber-200 bg-amber-50 text-amber-700"
      case "danger":
        return "border-rose-200 bg-rose-50 text-rose-700"
      default:
        return "border-slate-200 bg-slate-50 text-slate-600"
    }
  }

  const renderTreeNode = (nodeId: number, path: number[] = []) => {
    const node = nodesById.get(nodeId)

    if (!node) {
      return (
        <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-center text-xs text-rose-700">
          Nodo no encontrado
        </div>
      )
    }

    const branches = getNodeBranches(node)
    const preview = getNodePreview(node)

    return (
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => requestSelectNode(node.id)}
          className={cn(
            "group flex w-[240px] max-w-[240px] flex-col gap-2 rounded-2xl border px-4 py-3 text-left shadow-sm transition-all",
            selectedNodeId === node.id
              ? "border-[#013765] bg-[#013765] text-white shadow-lg"
              : "border-slate-200 bg-white text-slate-900 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {node.key || `node_${node.id}`}
              </div>
              <div
                className={cn(
                  "mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                  selectedNodeId === node.id ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600",
                )}
              >
                {getNodeTypeLabel(node.type)}
              </div>
              {isAlephooNodeType(node.type) ? (
                <div
                  className={cn(
                    "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    selectedNodeId === node.id
                      ? "border-amber-300/40 bg-amber-400/10 text-amber-100"
                      : "border-amber-200 bg-amber-50 text-amber-700",
                  )}
                >
                  Alephoo
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {selectedFlow?.start_node_id === node.id ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    selectedNodeId === node.id ? "bg-emerald-400/20 text-emerald-100" : "bg-emerald-100 text-emerald-700",
                  )}
                >
                  Inicio
                </span>
              ) : null}
              {!isReadOnly ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmDelete({
                      type: "node",
                      id: node.id,
                      name: node.key || `node_${node.id}`,
                    })
                  }}
                  disabled={deletingNodeId === node.id}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
                    selectedNodeId === node.id
                      ? "border-white/20 bg-white/10 text-white hover:bg-white/15"
                      : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100",
                  )}
                  title="Eliminar nodo"
                >
                  {deletingNodeId === node.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : null}
            </div>
          </div>

          <div
            className={cn(
              "rounded-xl px-3 py-2 text-[11px] leading-relaxed",
              selectedNodeId === node.id ? "bg-white/10 text-white/85" : "bg-slate-50 text-slate-600",
            )}
          >
            {preview || "Sin mensaje configurado."}
          </div>

          <div className="flex items-center justify-between gap-2 text-[10px]">
            <span className={selectedNodeId === node.id ? "text-white/75" : "text-slate-500"}>
              ID #{node.id}
            </span>
            <span className={selectedNodeId === node.id ? "text-white/75" : "text-slate-500"}>
              {branches.filter((branch) => branch.targetId).length} conex.
            </span>
          </div>
        </button>

        {branches.length > 0 ? (
          <div className="flex flex-wrap items-start justify-center gap-5 pt-1">
            {branches.map((branch) => {
              const hasLoop = !!branch.targetId && path.includes(branch.targetId)

              return (
                <div key={branch.id} className="flex min-w-[170px] max-w-[220px] flex-col items-center gap-2">
                  <div className="h-4 w-px bg-slate-300" />
                  <button
                    type="button"
                    onClick={() => branch.targetId && requestSelectNode(branch.targetId)}
                    disabled={!branch.targetId}
                    className={cn(
                      "inline-flex max-w-full items-center justify-center rounded-full border px-3 py-1 text-center text-[10px] font-medium",
                      getBranchToneClass(branch.tone),
                      branch.targetId ? "cursor-pointer hover:brightness-95" : "cursor-default opacity-80",
                    )}
                  >
                    <span className="truncate">
                      {branch.label}
                      {branch.targetLabel ? ` -> ${branch.targetLabel}` : " -> fin"}
                    </span>
                  </button>

                  {branch.targetId ? (
                    hasLoop ? (
                      <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-center text-[11px] text-amber-700">
                        Referencia ya mostrada
                      </div>
                    ) : (
                      renderTreeNode(branch.targetId, [...path, node.id])
                    )
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-center text-[11px] text-slate-500">
                      Fin del camino
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-center text-[11px] text-slate-500">
            Nodo terminal
          </div>
        )}
      </div>
    )
  }

  // Render: layout general
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100">
      {/* Barra superior estilo panel de mensajes */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-3 bg-[#013765] text-white">
        <div className="flex items-center gap-2 justify-self-start">
          <Button
            variant="outline"
            className="h-8 w-8 shrink-0 border-white/20 bg-white/10 p-0 text-white hover:bg-white/20 hover:text-white"
            onClick={() => window.history.back()}
            title="Volver"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <HoverTooltip label="Ver flujos">
            <Button
              variant="outline"
              className="h-8 w-8 shrink-0 border-white/20 bg-white/10 p-0 text-white hover:bg-white/20 hover:text-white"
              onClick={() => setFlowsDrawerOpen(true)}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </HoverTooltip>

          <HoverTooltip label="Configurar flujo">
            <Button
              variant="outline"
              className="h-8 w-8 shrink-0 border-white/20 bg-white/10 p-0 text-white hover:bg-white/20 hover:text-white"
              onClick={() => setFlowConfigOpen(true)}
              disabled={!selectedFlow}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </HoverTooltip>
        </div>

        <div className="min-w-0 text-center">
          <h1 className="flex items-center justify-center gap-2 text-lg font-semibold">
            Constructor de flujo de bot
          </h1>

          {selectedFlow ? (
            <p className="mt-1 text-xs opacity-80">
              {isReadOnly ? "Supervisando flujo: " : "Editando flujo: "}
              <span className="font-semibold">{selectedFlow.name}</span>
            </p>
          ) : (
            <p className="mt-1 text-xs opacity-80">Selecciona un flujo o crea uno nuevo.</p>
          )}

        </div>

        {!isReadOnly ? (
          <div className="justify-self-end">
            <HoverTooltip label="Abrir papelera">
              <Button
                variant="outline"
                className="h-8 shrink-0 border-white/20 bg-white/10 px-3 text-white hover:bg-white/20 hover:text-white"
                onClick={() => setTrashOpen(true)}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                <span className="text-xs">Papelera</span>
              </Button>
            </HoverTooltip>
          </div>
        ) : null}
      </div>
      {flowsDrawerOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-slate-950/30"
          onClick={() => setFlowsDrawerOpen(false)}
          aria-label="Cerrar panel de flujos"
        />
      )}

      {/* Contenido */}
      <div className="relative flex flex-1 gap-4 overflow-hidden p-4 min-h-0">
        {/* Sidebar de Flows */}
        <div
          className={cn(
            "fixed bottom-4 left-4 top-[5.25rem] z-40 w-80 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-transform",
            flowsDrawerOpen ? "translate-x-0" : "-translate-x-[120%]",
            "flex",
          )}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="font-semibold text-sm text-[#013765]">Flujos del bot</h2>
            <div className="ml-auto flex items-center gap-1">
              <HoverTooltip label="Crear flujo">
                <Button
                  variant="outline"
                  className="h-7 w-7 border-slate-200 text-[#013765] hover:bg-slate-100"
                  onClick={() => setCreateModal("flow")}
                  disabled={isReadOnly}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </HoverTooltip>

              <HoverTooltip label="Actualizar flujos">
                <Button
                  variant="outline"
                  className="h-7 w-7 border-slate-200 text-[#013765] hover:bg-slate-100"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCcw className="h-3 w-3" />
                </Button>
              </HoverTooltip>
              <HoverTooltip label="Cerrar panel" align="right">
                <Button
                  variant="outline"
                  className="h-7 w-7 border-slate-200 text-[#013765] hover:bg-slate-100"
                  onClick={() => setFlowsDrawerOpen(false)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </HoverTooltip>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
            <div className="space-y-2 pr-1">
              {loadingFlows ? (
                <p className="text-xs text-muted-foreground">Cargando flujos...</p>
              ) : flows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay flujos creados aún.</p>
              ) : (
                flows.map((flow) => (
                  <div
                    key={flow.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => requestSelectFlow(flow.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        requestSelectFlow(flow.id)
                      }
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg text-xs border flex flex-col gap-2 transition-colors cursor-pointer select-none",
                      selectedFlowId === flow.id
                        ? "bg-[#013765] text-white border-[#013765]"
                        : "bg-white hover:bg-slate-100 border-slate-200",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="block font-medium leading-tight break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                          {flow.name}
                        </span>
                        {flow.description ? (
                          <span className={cn(
                            "mt-1 block truncate text-[10px]",
                            selectedFlowId === flow.id ? "text-white/75" : "text-slate-500",
                          )}>
                            {flow.description}
                          </span>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        {flow.is_default ? (
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">
                            Activo
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full border",
                              selectedFlowId === flow.id
                                ? "border-white/30 bg-white/10 text-white hover:bg-white/15"
                                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
                            )}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleMakeDefault(flow.id)
                            }}
                            disabled={isReadOnly}
                          >
                            Activar
                          </button>
                        )}

                        {!isReadOnly ? (
                          <button
                            type="button"
                            className={cn(
                              "inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                              selectedFlowId === flow.id
                                ? "border-white/30 bg-white/10 text-white hover:bg-white/15"
                                : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100",
                            )}
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmDelete({
                                type: "flow",
                                id: flow.id,
                                name: flow.name,
                              })
                            }}
                            disabled={deletingFlowId === flow.id}
                            title="Eliminar flujo"
                          >
                            {deletingFlowId === flow.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className={cn(
                      "flex items-center justify-between gap-2 text-[10px]",
                      selectedFlowId === flow.id ? "text-white/80" : "text-slate-500",
                    )}>
                      <span className="truncate">
                        {selectedFlowId === flow.id
                          ? `${nodes.length} nodos · Inicio: ${startNodeLabel}`
                          : `ID #${flow.id}`}
                      </span>
                      {selectedFlowId === flow.id ? (
                        <span className="rounded-full border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px]">
                          {isReadOnly ? "Supervisando" : "Editando"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Main: Nodes y editor */}
        <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
          <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
            {/* Árbol interactivo */}
            <div className="flex-1 min-h-0 border rounded-xl bg-white p-3 flex flex-col shadow-sm overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-medium text-sm text-[#013765]">Árbol del flujo</h3>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Tocá un nodo o una rama para editarla y recorrer el flujo.
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <HoverTooltip label="Agregar nodo" align="right">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 border-slate-200 text-[#013765] hover:bg-slate-100"
                      onClick={() => setCreateModal("node")}
                      disabled={isReadOnly || !selectedFlowId}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </HoverTooltip>
                  <HoverTooltip label="Actualizar nodos" align="right">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 border-slate-200 text-[#013765] hover:bg-slate-100"
                      onClick={() => {
                        if (selectedFlowId) {
                          setLoadingNodes(true)
                          fetch(`${API_BASE}/api/bot/flows/${selectedFlowId}/nodes`)
                            .then((res) => res.json())
                            .then((data) => {
                              const list: BotNode[] = data.nodes ?? data
                              setNodes(list)
                            })
                            .catch((err) => console.error("Error recargando nodes:", err))
                            .finally(() => setLoadingNodes(false))
                        }
                      }}
                    >
                      <RefreshCcw className="h-3 w-3" />
                    </Button>
                  </HoverTooltip>
                </div>
              </div>

              <div className="flex-1 overflow-auto min-h-0 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                {loadingNodes ? (
                  <p className="text-xs text-muted-foreground">Cargando nodos...</p>
                ) : nodes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No hay nodos para este flujo.</p>
                ) : (
                  <ReactFlow
                    nodes={flowCanvasNodes}
                    edges={flowCanvasEdges}
                    nodeTypes={canvasNodeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.2 }}
                    minZoom={0.2}
                    maxZoom={1.6}
                    connectionRadius={42}
                    connectOnClick
                    nodesDraggable={!isReadOnly}
                    nodesConnectable={!isReadOnly}
                    elementsSelectable
                    onNodesChange={handleCanvasNodesChange}
                    onConnect={handleCanvasConnect}
                    onEdgeClick={handleCanvasEdgeClick}
                    onNodeDragStop={handleCanvasNodeDragStop}
                    onPaneClick={requestCloseNodePanel}
                    proOptions={{ hideAttribution: true }}
                  >
                    <Background color="#cbd5e1" gap={18} />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                )}
              </div>
            </div>

            {/* Panel de edición */}
            <div className="contents">
              {flowConfigOpen && (
                <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/35 p-4">
                  <Card className="mt-8 w-full max-w-[30rem] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                    <CardHeader className="border-b border-slate-200 bg-white pb-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-sm text-[#013765]">Configuracion del flujo</CardTitle>
                          <CardDescription className="text-xs">
                            Renombra el flujo y defini desde que nodo comienza la conversacion.
                          </CardDescription>
                        </div>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 border-slate-200 text-slate-600 hover:bg-slate-100"
                          onClick={() => setFlowConfigOpen(false)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>

                    <CardContent className="bg-white pt-4">
                      {!selectedFlow ? (
                        <p className="text-xs text-muted-foreground">
                          Seleccioná un flujo en la lista de la izquierda para editar su configuración.
                        </p>
                      ) : (
                        <fieldset disabled={isReadOnly} className="space-y-4">
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="text-xs mb-1 block text-muted-foreground">
                                Nombre del flujo
                              </label>
                              <Input
                                value={editFlowName}
                                onChange={(e) => setEditFlowName(e.target.value)}
                                className="text-xs"
                                placeholder="Ej: Turnos consultorio"
                              />
                            </div>

                            <div>
                              <label className="text-xs mb-1 block text-muted-foreground">
                                Nodo inicial
                              </label>
                              <div className="relative">
                                <Select
                                  value={editFlowStartNodeId ? String(editFlowStartNodeId) : "none"}
                                  onValueChange={(val) => setEditFlowStartNodeId(val === "none" ? null : Number(val))}
                                  disabled={savingFlow || nodes.length === 0}
                                >
                                  <SelectTrigger className="h-8 text-xs pr-8">
                                    <SelectValue placeholder="Elegí nodo..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Sin nodo inicial</SelectItem>
                                    {startNodeOptions.map((opt) => (
                                      <SelectItem key={opt.id} value={String(opt.id)}>
                                        {opt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>

                                {savingFlow && (
                                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
                                  </div>
                                )}
                              </div>
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                Actualmente: {startNodeLabel}
                              </p>
                            </div>

                          </div>

                          <div className="mt-4 flex shrink-0 flex-col items-center gap-2 border-t border-slate-200 bg-white pt-4">
                            {isReadOnly ? (
                              <div className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
                                Este flujo esta en modo solo lectura para tu rol.
                              </div>
                            ) : null}
                            <Button
                              size="sm"
                              className="w-full text-xs bg-[#013765] hover:bg-[#024a8a] text-white"
                              onClick={handleSaveFlow}
                              disabled={isReadOnly || savingFlow || !hasUnsavedFlowChanges || !editFlowName.trim()}
                            >
                              {savingFlow ? "Guardando..." : "Guardar flujo"}
                            </Button>
                            {hasUnsavedFlowChanges && (
                              <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                                <CircleDot className="h-3.5 w-3.5" />
                                <span>{hasUnsavedFlowChanges ? "Cambios sin guardar" : "Todo guardado"}</span>
                              </div>
                            )}
                          </div>
                        </fieldset>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {editNode && (
                <div className="fixed inset-0 z-[75] flex items-start justify-end bg-slate-950/35 p-4">
                  <Card className="flex h-[calc(100vh-6rem)] w-full max-w-[32rem] flex-col overflow-hidden shadow-2xl">
                    <CardHeader className="pb-2 border-b border-slate-200 bg-slate-50 bg-white rounded-t-xl">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-sm text-[#013765]">
                            Editor de nodo seleccionado
                          </CardTitle>
                          <CardDescription className="text-xs">
                            Configura el contenido y el comportamiento de este paso del bot.
                          </CardDescription>
                        </div>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 border-slate-200 text-slate-600 hover:bg-slate-100"
                          onClick={requestCloseNodePanel}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>

                    <CardContent className="flex-1 flex flex-col overflow-hidden pt-4 bg-white rounded-b-xl">
                      {!editNode ? (
                        <p className="text-xs text-muted-foreground">
                          Selecciona un nodo en la lista de la izquierda para editarlo.
                        </p>
                      ) : (
                        <>
                          {isReadOnly ? (
                            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
                              Vista de supervisor: podes recorrer el flujo y leer su configuracion, pero no editarla.
                            </div>
                          ) : null}
                          <fieldset disabled={isReadOnly} className="flex-1 min-h-0 space-y-4 overflow-y-auto pr-1">
                            {/* Datos básicos */}
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs mb-1 block text-muted-foreground">
                                  key del nodo
                                </label>
                                <Input
                                  value={editNode.key ?? ""}
                                  onChange={(e) =>
                                    setEditNode((prev) =>
                                      prev ? { ...prev, key: e.target.value.slice(0, NODE_KEY_MAX) } : prev,
                                    )
                                  }
                                  maxLength={NODE_KEY_MAX}
                                  className="text-xs"
                                />
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  {(editNode.key ?? "").length}/{NODE_KEY_MAX}
                                </p>
                              </div>

                              <div>
                                <label className="text-xs mb-1 block text-muted-foreground">
                                  Tipo de nodo
                                </label>
                                <Select
                                  value={editNode.type}
                                  onValueChange={(val: NodeType) =>
                                    setEditNode((prev) => {
                                      if (!prev) return prev

                                      const linear = val === "text" || val === "input" || val === "person_lookup" || isMediaNodeType(val)
                                      const supportsAutoAdvance = val === "text" || isMediaNodeType(val)

                                      const cleanedSettings = (() => {
                                        const s = { ...(prev.settings ?? {}) }

                                        // auto-disparo solo aplica a nodos de texto
                                        if (!supportsAutoAdvance) {
                                          delete s.auto_advance
                                          delete s.auto_advance_delay_ms
                                          delete s.auto_advance_max_hops
                                        }

                                        // opcional: si querés, al pasar a buttons/list/handoff también podés limpiar otras cosas
                                        if (isMediaNodeType(val)) {
                                          const keepExistingMedia = prev.type === val
                                          return {
                                            ...(s.canvas_position ? { canvas_position: s.canvas_position } : {}),
                                            ...(s.auto_advance ? { auto_advance: s.auto_advance } : {}),
                                            ...(s.auto_advance_delay_ms ? { auto_advance_delay_ms: s.auto_advance_delay_ms } : {}),
                                            ...(s.auto_advance_max_hops ? { auto_advance_max_hops: s.auto_advance_max_hops } : {}),
                                            source_kind: keepExistingMedia ? (s.source_kind ?? "url") : "url",
                                            source: keepExistingMedia ? (s.source ?? "") : "",
                                            filename: keepExistingMedia ? (s.filename ?? "") : "",
                                          }
                                        }

                                        if (isMediaNodeType(prev.type)) {
                                          delete s.source_kind
                                          delete s.source
                                          delete s.filename
                                        }

                                        return s
                                      })()

                                      return {
                                        ...prev,
                                        type: val,
                                        // limpiar next_node_id si el nuevo tipo NO es lineal
                                        ...(linear ? {} : { next_node_id: null }),
                                        // aplicar settings limpiados
                                        settings: cleanedSettings,
                                      }
                                    })
                                  }

                                >
                                  <SelectTrigger className="h-9 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {nodeTypeOptions.map((type) => (
                                      <NodeTypeSelectItem key={type} type={type} />
                                    ))}
                                  </SelectContent>
                                </Select>
                                {isAlephooNodeType(editNode.type) ? (
                                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                                    Este nodo consulta Alephoo. Conviene editarlo con cuidado.
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            {/* Texto principal */}
                            <div className="relative">
                              <div className="mb-1 flex items-center gap-2">
                                <label className="text-xs block text-muted-foreground">
                                  Mensaje
                                </label>
                                <button
                                  type="button"
                                  onClick={() => setMessageHelpOpen(true)}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-[#013765] transition-colors hover:bg-slate-50"
                                >
                                  <CircleHelp className="h-3.5 w-3.5" />
                                  Ayuda sobre variables
                                </button>
                              </div>
                              <Textarea
                                ref={messageTextareaRef}
                                value={editNode.body ?? ""}
                                onChange={(e) => {
                                  const nextValue = e.target.value
                                  const cursorPosition = e.target.selectionStart
                                  setEditNode((prev) =>
                                    prev
                                      ? {
                                        ...prev,
                                        body: nextValue.slice(0, getNodeBodyMaxLength(prev.type)),
                                      }
                                      : prev,
                                  )
                                  updateTemplateVariableAutocomplete(nextValue, cursorPosition)
                                }}
                                onClick={(e) =>
                                  updateTemplateVariableAutocomplete(
                                    e.currentTarget.value,
                                    e.currentTarget.selectionStart,
                                  )
                                }
                                onKeyUp={(e) => {
                                  if (
                                    e.key === "ArrowDown" ||
                                    e.key === "ArrowUp" ||
                                    e.key === "Enter" ||
                                    e.key === "Tab" ||
                                    e.key === "Escape"
                                  ) {
                                    return
                                  }

                                  updateTemplateVariableAutocomplete(
                                    e.currentTarget.value,
                                    e.currentTarget.selectionStart,
                                  )
                                }}
                                onBlur={() => {
                                  setTimeout(() => setTemplateVariableOpen(false), 120)
                                }}
                                onKeyDown={(e) => {
                                  if (!templateVariableOpen || filteredTemplateVariableOptions.length === 0) return

                                  if (e.key === "ArrowDown") {
                                    e.preventDefault()
                                    setTemplateVariableSelectedIndex((prev) =>
                                      prev + 1 >= filteredTemplateVariableOptions.length ? 0 : prev + 1,
                                    )
                                  } else if (e.key === "ArrowUp") {
                                    e.preventDefault()
                                    setTemplateVariableSelectedIndex((prev) =>
                                      prev - 1 < 0 ? filteredTemplateVariableOptions.length - 1 : prev - 1,
                                    )
                                  } else if (e.key === "Enter" || e.key === "Tab") {
                                    e.preventDefault()
                                    const selected = filteredTemplateVariableOptions[templateVariableSelectedIndex]
                                    if (selected) insertTemplateVariable(selected.key)
                                  } else if (e.key === "Escape") {
                                    e.preventDefault()
                                    setTemplateVariableOpen(false)
                                  }
                                }}
                                rows={4}
                                maxLength={getNodeBodyMaxLength(editNode.type)}
                                className="text-xs"
                                placeholder="Texto que verá el paciente/usuario en este paso..."
                              />
                              {templateVariableOpen && filteredTemplateVariableOptions.length > 0 && (
                                <div
                                  className="absolute z-20 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
                                  style={{
                                    top: templateVariablePosition.top,
                                    left: templateVariablePosition.left,
                                  }}
                                >
                                  <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                                    Variables disponibles
                                  </div>
                                  <div className="max-h-56 overflow-y-auto py-1">
                                    {filteredTemplateVariableOptions.map((item, index) => (
                                      <button
                                        ref={(el) => {
                                          templateVariableOptionRefs.current[index] = el
                                        }}
                                        key={`${item.kind}-${item.key}`}
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => insertTemplateVariable(item.key)}
                                        className={cn(
                                          "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors",
                                          index === templateVariableSelectedIndex
                                            ? "bg-[#013765] text-white"
                                            : "text-slate-700 hover:bg-slate-50",
                                        )}
                                      >
                                        <span className="truncate font-medium">{item.label}</span>
                                        <span
                                          className={cn(
                                            "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                                            index === templateVariableSelectedIndex
                                              ? "bg-white/15 text-white"
                                              : item.kind === "flow"
                                                ? "bg-emerald-100 text-emerald-700"
                                                : "bg-slate-100 text-slate-600",
                                          )}
                                        >
                                          {item.kind === "flow" ? "flujo" : "sistema"}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                {(editNode.body ?? "").length}/{getNodeBodyMaxLength(editNode.type)}
                                {editNode.type === "buttons" || editNode.type === "list" || editNode.type === "image" || editNode.type === "video" || editNode.type === "document"
                                  ? " (mensaje interactivo)"
                                  : ""}
                              </p>
                              {editNode.type === "audio" ? (
                                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                                  WhatsApp no muestra texto en los mensajes de audio. El campo «Mensaje» se ignora para este tipo de archivo.
                                </p>
                              ) : null}
                            </div>

                            {/* Settings específicos según tipo */}
                            {renderSettingsFields()}

                            {/* Siguiente nodo lineal (solo para text + input) */}
                            {isLinearType(editNode.type) &&
                              !(editNode.type === "input" && ["buttons", "list"].includes(editNode.settings?.response_mode ?? "text")) && (
                                <div>
                                  <label className="text-xs mb-1 block text-muted-foreground">
                                    Siguiente nodo
                                  </label>

                                  <Select
                                    value={editNode.next_node_id ? String(editNode.next_node_id) : "none"}
                                    onValueChange={(val) =>
                                      setEditNode((prev) =>
                                        prev
                                          ? {
                                            ...prev,
                                            next_node_id: val === "none" ? null : Number(val),
                                          }
                                          : prev,
                                      )
                                    }
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue placeholder="Seleccionar siguiente nodo..." />
                                    </SelectTrigger>

                                    <SelectContent>
                                      <SelectItem value="none">Finalizar flujo</SelectItem>
                                      {nextNodeOptions.map((opt) => (
                                        <SelectItem key={opt.id} value={String(opt.id)}>
                                          {opt.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>

                                  <p className="text-[10px] text-muted-foreground mt-1">
                                    Para avanzar al próximo nodo (lineal).
                                  </p>
                                </div>
                              )}

                            {/* Auto-disparo */}
                            {(editNode.type === "text" || isMediaNodeType(editNode.type)) && (
                              <div className="border rounded-lg p-3 bg-muted/20 space-y-2">
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    checked={Boolean((editNode.settings ?? {}).auto_advance)}
                                    onCheckedChange={(checked) =>
                                      setEditNode((prev) =>
                                        prev
                                          ? {
                                            ...prev,
                                            settings: {
                                              ...(prev.settings ?? {}),
                                              auto_advance: Boolean(checked),
                                            },
                                          }
                                          : prev,
                                      )
                                    }
                                  />
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium">
                                      Auto-disparar siguiente mensaje
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      Si está activo, el bot enviará el próximo nodo automáticamente (sin esperar respuesta).
                                    </p>
                                  </div>
                                </div>

                                {/*
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs mb-1 block text-muted-foreground">
                                Delay (ms)
                              </label>
                              <Input
                                value={String((editNode.settings ?? {}).auto_advance_delay_ms ?? 0)}
                                onChange={(e) =>
                                  setEditNode((prev) =>
                                    prev
                                      ? {
                                        ...prev,
                                        settings: {
                                          ...(prev.settings ?? {}),
                                          auto_advance_delay_ms: Number(e.target.value || 0),
                                        },
                                      }
                                      : prev,
                                  )
                                }
                                className="text-xs"
                                placeholder="0"
                              />
                            </div>

                            <div>
                              <label className="text-xs mb-1 block text-muted-foreground">
                                Máx saltos (anti-loop)
                              </label>
                              <Input
                                value={String((editNode.settings ?? {}).auto_advance_max_hops ?? 5)}
                                onChange={(e) =>
                                  setEditNode((prev) =>
                                    prev
                                      ? {
                                        ...prev,
                                        settings: {
                                          ...(prev.settings ?? {}),
                                          auto_advance_max_hops: Number(e.target.value || 5),
                                        },
                                      }
                                      : prev,
                                  )
                                }
                                className="text-xs"
                                placeholder="5"
                              />
                            </div>
                          </div>
                          */}
                              </div>
                            )}

                          </fieldset>

                          {/* Botón guardar */}
                          <div className="mt-4 flex shrink-0 flex-col items-center gap-2 border-t border-slate-200 bg-white pt-4">
                            <Button
                              size="sm"
                              className="w-full text-xs bg-[#013765] hover:bg-[#024a8a] text-white"
                              onClick={async () => {
                                const saved = await handleSaveNode()
                                if (saved) {
                                  setSelectedNodeId(null)
                                }
                              }}
                              disabled={isReadOnly || savingNode || !hasUnsavedChanges || !canSaveNode}
                            >
                              {savingNode ? "Guardando..." : "Guardar nodo"}
                            </Button>

                            {hasUnsavedChanges && (
                              <div
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium border-amber-200 bg-amber-50 text-amber-700"
                                )}
                              >
                                <CircleDot className="h-3.5 w-3.5" />
                                <span>Cambios sin guardar</span>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Enviar a papelera</h3>
              <p className="mt-1 text-sm text-slate-600">
                {confirmDelete.type === "flow"
                  ? `El flujo "${confirmDelete.name}" y sus nodos se moverán a la papelera para poder restaurarlos más tarde.`
                  : `El nodo "${confirmDelete?.name}" se moverá a la papelera y podrá restaurarse desde allí.`}
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={
                  (confirmDelete.type === "flow" && deletingFlowId === confirmDelete.id) ||
                  (confirmDelete.type === "node" && deletingNodeId === confirmDelete.id)
                }
                className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {(confirmDelete.type === "flow" && deletingFlowId === confirmDelete.id) ||
                  (confirmDelete.type === "node" && deletingNodeId === confirmDelete.id) ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Moviendo...
                  </>
                ) : (
                  "Mover a papelera"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {createModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
          <form
            onSubmit={handleCreateModalSubmit}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">
                {createModal === "flow" ? "Crear nuevo flujo" : "Crear nuevo nodo"}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                {createModal === "flow"
                  ? "Ingresá el nombre del flujo que querés agregar al bot."
                  : "Ingresá la key del nuevo nodo para este flujo."}
              </p>
            </div>

            <div className="space-y-4 px-5 py-4">
              <label className="mb-1 block text-xs text-slate-500">
                {createModal === "flow" ? "Nombre del flujo" : "Key del nodo"}
              </label>
              <Input
                value={createModal === "flow" ? newFlowName : newNodeKey}
                onChange={(e) =>
                  createModal === "flow"
                    ? setNewFlowName(e.target.value)
                    : setNewNodeKey(e.target.value)
                }
                placeholder={
                  createModal === "flow"
                    ? "Ej: Turnos consultorio"
                    : "Ej: menu_principal"
                }
                className="h-9 text-sm"
              />
              {createModal === "node" ? (
                <div>
                  <label className="mb-1 block text-xs text-slate-500">
                    Tipo de nodo
                  </label>
                  <Select
                    value={newNodeType}
                    onValueChange={(value: NodeType) => setNewNodeType(value)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {nodeTypeOptions.map((type) => (
                        <NodeTypeSelectItem key={type} type={type} />
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {createModal === "node" && !selectedFlowId ? (
                <p className="mt-2 text-xs text-amber-600">
                  Seleccioná un flujo antes de crear nodos.
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setCreateModal(null)}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={
                  createModal === "flow"
                    ? creatingFlow || !newFlowName.trim()
                    : creatingNode || !newNodeKey.trim() || !selectedFlowId
                }
                className="inline-flex items-center rounded-lg bg-[#013765] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#024a8a] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {(createModal === "flow" && creatingFlow) || (createModal === "node" && creatingNode) ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creando...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    {createModal === "flow" ? "Crear flujo" : "Crear nodo"}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {regexHelpOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Ayuda con regex</h3>
              <p className="mt-1 text-sm text-slate-600">
                Este campo sirve para validar el formato del dato antes de continuar con el flujo.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4 text-sm text-slate-700">
              <div>
                <p className="font-medium text-slate-900">Que tenes que saber</p>
                <p className="mt-1">
                  No hace falta que sepas regex. Solo usalo si queres validar algo como un DNI, un email o un telefono.
                </p>
              </div>
              <div>
                <p className="font-medium text-slate-900">Ejemplos rapidos</p>
                <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[13px]">
                  <p><span className="font-semibold">DNI:</span> <code>{"^[0-9]{7,9}$"}</code></p>
                  <p><span className="font-semibold">Email:</span> <code>{"^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"}</code></p>
                  <p><span className="font-semibold">Celular:</span> <code>{"^\\+?[0-9]{10,15}$"}</code></p>
                </div>
              </div>
              <div>
                <p className="font-medium text-slate-900">Como generarlo con ChatGPT</p>
                <p className="mt-1">
                  Pedile a ChatGPT un regex para el dato que queres validar y luego copia el resultado aqui.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setRegexHelpOpen(false)}
                className="inline-flex items-center rounded-lg bg-[#013765] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#024a8a]"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {messageHelpOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Ayuda sobre variables en mensajes</h3>
              <p className="mt-1 text-sm text-slate-600">
                Podés mostrar datos guardados del chat dentro del texto del nodo.
              </p>
            </div>

            <div className="space-y-4 px-5 py-4 text-sm text-slate-700">
              <div>
                <p className="font-medium text-slate-900">Cómo se usan</p>
                <p className="mt-1">
                  Escribí la variable entre dobles llaves. Ejemplo: <code>{'{{ nombre }}'}</code>
                </p>
              </div>

              <div>
                <p className="font-medium text-slate-900">Ejemplos</p>
                <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[13px]">
                  <p><code>Hola {'{{ nombre }}'}</code></p>
                  <p><code>Tu DNI es {'{{ dni }}'}</code></p>
                  <p><code>Hola {'{{ nombre|paciente }}'}</code> usa <span className="font-medium">paciente</span> si la variable está vacía.</p>
                </div>
              </div>

              <div>
                <p className="font-medium text-slate-900">Variables disponibles</p>
                <p className="mt-1">
                  Podés usar variables guardadas por nodos de captura de datos y también algunas variables del sistema, como <code>{'{{ contact.name }}'}</code> o <code>{'{{ chat.id }}'}</code>.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setMessageHelpOpen(false)}
                className="inline-flex items-center rounded-lg bg-[#013765] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#024a8a]"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingNavigation && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Cambios sin guardar</h3>
              <p className="mt-1 text-sm text-slate-600">
                Tenes cambios sin guardar en este nodo. Si continuas, se perderan
                {pendingNavigation.type === "flow"
                  ? " al cambiar de flujo."
                  : pendingNavigation.type === "close_node"
                    ? " al cerrar el panel."
                    : " al cambiar de nodo."}
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setPendingNavigation(null)}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Seguir editando
              </button>
              <button
                type="button"
                onClick={handleDiscardPendingNavigation}
                className="inline-flex items-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600"
              >
                Salir sin guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {trashOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">Papelera de flujos</h3>
                <p className="mt-0.5 text-sm text-slate-600">
                  Restaurá flujos completos o nodos individuales. Los nodos sólo se pueden restaurar si su flujo ya está activo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTrashOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                ×
              </button>
            </div>

            <div className="border-b border-slate-200 bg-white px-5 py-3">
              <Input
                value={trashSearch}
                onChange={(e) => setTrashSearch(e.target.value)}
                placeholder="Buscar flujo, nodo o ID..."
                className="h-9 border-slate-300 bg-white text-sm"
              />
            </div>

            {loadingTrash ? (
              <div className="flex items-center justify-center px-6 py-10 text-sm text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cargando papelera...
              </div>
            ) : (
              <div className="grid max-h-[calc(85vh-92px)] gap-0 overflow-y-auto lg:grid-cols-2">
                <div className="space-y-3 border-b border-slate-200 px-6 py-5 lg:border-b-0 lg:border-r lg:border-slate-200">
                  <div>
                    <h3 className="text-sm font-semibold text-[#013765]">Flujos eliminados</h3>
                    <p className="text-xs text-slate-500">
                      Al restaurar un flujo también se recuperan sus nodos eliminados con él.
                    </p>
                  </div>

                  {filteredTrashedFlows.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500">
                      {trashSearchNormalized ? "No hay flujos que coincidan con la búsqueda." : "No hay flujos en la papelera."}
                    </p>
                  ) : (
                    filteredTrashedFlows.map((flow) => (
                      <div
                        key={flow.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{flow.name}</p>
                          <p className="text-[11px] text-slate-500">
                            ID #{flow.id}
                          </p>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 border-[#013765] text-[#013765] hover:bg-[#013765] hover:text-white"
                          onClick={() => handleRestoreFlow(flow.id)}
                          disabled={isReadOnly || restoringFlowId === flow.id}
                        >
                          {restoringFlowId === flow.id ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="mr-2 h-3.5 w-3.5" />
                          )}
                          Restaurar
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-3 px-6 py-5">
                  <div>
                    <h3 className="text-sm font-semibold text-[#013765]">Nodos eliminados</h3>
                    <p className="text-xs text-slate-500">
                      Si el flujo del nodo también está en papelera, restauralo primero.
                    </p>
                  </div>

                  {filteredTrashedNodes.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500">
                      {trashSearchNormalized ? "No hay nodos que coincidan con la búsqueda." : "No hay nodos en la papelera."}
                    </p>
                  ) : (
                    filteredTrashedNodes.map((node) => {
                      const flowIsTrashed = trashedFlows.some((flow) => flow.id === node.flow_id)

                      return (
                        <div
                          key={node.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {node.key || `node_${node.id}`}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Flujo: {node.flow_name || `#${node.flow_id}`} · Tipo: {node.type}
                            </p>
                          </div>

                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0 border-[#013765] text-[#013765] hover:bg-[#013765] hover:text-white"
                            onClick={() => handleRestoreNode(node.id)}
                            disabled={isReadOnly || restoringNodeId === node.id || flowIsTrashed}
                          >
                            {restoringNodeId === node.id ? (
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="mr-2 h-3.5 w-3.5" />
                            )}
                            Restaurar
                          </Button>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
