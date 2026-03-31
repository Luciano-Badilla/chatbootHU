"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, RefreshCcw, ChevronRight, Zap, Loader2, Trash2, RotateCcw, CircleDot, CircleHelp } from "lucide-react"
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

type NodeType = "text" | "buttons" | "list" | "input" | "handoff"

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

const API_BASE = (import.meta.env.VITE_APP_URL || "").replace(/\/$/, "")

const MAX_BUTTONS = 2 // si querés 3 (lo que permite WhatsApp), poné 3
const MAX_LIST_ROWS = 10

const serializeNodeSnapshot = (node: BotNode | null) => {
  if (!node) return ""

  return JSON.stringify({
    ...node,
    settings: node.settings ?? {},
  })
}

export default function BotFlowBuilder() {
  const [flows, setFlows] = useState<BotFlow[]>([])
  const [selectedFlowId, setSelectedFlowId] = useState<number | null>(null)

  const [nodes, setNodes] = useState<BotNode[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)

  const [loadingFlows, setLoadingFlows] = useState(false)
  const [loadingNodes, setLoadingNodes] = useState(false)
  const [savingNode, setSavingNode] = useState(false)
  const [creatingFlow, setCreatingFlow] = useState(false)
  const [creatingNode, setCreatingNode] = useState(false)
  const [savingStartNode, setSavingStartNode] = useState(false)
  const [savingFlow, setSavingFlow] = useState(false)
  const [deletingFlowId, setDeletingFlowId] = useState<number | null>(null)
  const [deletingNodeId, setDeletingNodeId] = useState<number | null>(null)
  const [restoringFlowId, setRestoringFlowId] = useState<number | null>(null)
  const [restoringNodeId, setRestoringNodeId] = useState<number | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
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
  const [pendingNavigation, setPendingNavigation] = useState<
    | { type: "flow"; id: number }
    | { type: "node"; id: number }
    | null
  >(null)

  const [newFlowName, setNewFlowName] = useState("")
  const [newNodeKey, setNewNodeKey] = useState("")
  const [editFlowName, setEditFlowName] = useState("")

  // Estado local editable del nodo
  const [editNode, setEditNode] = useState<BotNode | null>(null)
  const lastSavedNodeSnapshotRef = useRef("")

  // 🔹 Flow seleccionado
  const selectedFlow = useMemo(
    () => flows.find((f) => f.id === selectedFlowId) ?? null,
    [flows, selectedFlowId],
  )

  const hasUnsavedChanges = useMemo(() => {
    return serializeNodeSnapshot(editNode) !== lastSavedNodeSnapshotRef.current
  }, [editNode])

  const hasUnsavedFlowChanges = useMemo(() => {
    return editFlowName.trim() !== (selectedFlow?.name ?? "")
  }, [editFlowName, selectedFlow?.name])

  const startNodeOptions = useMemo(() => {
    return nodes.map((n) => ({
      id: n.id,
      label: n.key || `node_${n.id}`,
    }))
  }, [nodes])


  // 🔹 Cargar flows al inicio
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

  // 🔹 Cargar nodes cuando cambia el flow seleccionado
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

        if (list.length > 0) {
          const startId = selectedFlow?.start_node_id
          const startNode = (startId && list.find((n) => n.id === startId)) ?? list[0]
          setSelectedNodeId(startNode.id)
        } else {
          setSelectedNodeId(null)
        }
      } catch (err) {
        console.error("Error de red al cargar nodes:", err)
      } finally {
        setLoadingNodes(false)
      }
    }

    loadNodes()
  }, [selectedFlowId, flows])

  // 🔹 Sincronizar editNode con selectedNodeId
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
  }, [selectedFlow?.id, selectedFlow?.name])

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

  // 🔹 Crear flujo nuevo
  const handleCreateFlow = async () => {
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

  const handleSetStartNode = async (nodeId: number | null) => {
    if (!selectedFlowId) return

    setSavingStartNode(true)
    try {
      const res = await fetch(`${API_BASE}/api/bot/flows/${selectedFlowId}/start-node`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_node_id: nodeId }),
      })

      if (!res.ok) {
        console.error("Error seteando start node", await res.text())
        return
      }

      const data = await res.json()
      const updatedFlow: BotFlow = data.flow ?? data

      // ✅ actualizar flows local
      setFlows((prev) => prev.map((f) => (f.id === updatedFlow.id ? { ...f, ...updatedFlow } : f)))

      // opcional UX: si el usuario cambia start, seleccionamos ese nodo en el editor
      if (nodeId) {
        setSelectedNodeId(nodeId)
      }
    } catch (err) {
      console.error("Error de red seteando start node:", err)
    } finally {
      setSavingStartNode(false)
    }
  }

  const handleSaveFlow = async () => {
    if (!selectedFlow) return

    const name = editFlowName.trim()
    if (!name || name === selectedFlow.name) return

    setSavingFlow(true)
    try {
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
      const updatedFlow: BotFlow = data.flow ?? data

      setFlows((prev) => prev.map((flow) => (flow.id === updatedFlow.id ? { ...flow, ...updatedFlow } : flow)))
      setEditFlowName(updatedFlow.name)
    } catch (err) {
      console.error("Error de red guardando flow:", err)
    } finally {
      setSavingFlow(false)
    }
  }


  const handleMakeDefault = async (flowId: number) => {
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

  // 🔹 Crear nodo nuevo
  const handleCreateNode = async () => {
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
          type: "text",
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
      setSelectedNodeId(node.id)
      setNewNodeKey("")
      setCreateModal(null)
    } catch (err) {
      console.error("Error de red al crear node:", err)
    } finally {
      setCreatingNode(false)
    }
  }

  // 🔹 Guardar cambios del nodo
  const handleDeleteNode = async (nodeId: number) => {
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
    if (!editNode) return

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

    if (hasUnsavedChanges) {
      setPendingNavigation({ type: "flow", id: flowId })
      return
    }

    setSelectedFlowId(flowId)
  }

  const requestSelectNode = (nodeId: number) => {
    if (nodeId === selectedNodeId) return

    if (hasUnsavedChanges) {
      setPendingNavigation({ type: "node", id: nodeId })
      return
    }

    setSelectedNodeId(nodeId)
  }

  const handleDiscardPendingNavigation = () => {
    if (!pendingNavigation) return

    const nextNavigation = pendingNavigation
    setPendingNavigation(null)

    if (nextNavigation.type === "flow") {
      setSelectedFlowId(nextNavigation.id)
      return
    }

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

  const nodesWithNextKey = useMemo(() => {
    const getNodeLabel = (nodeId: number | null | undefined) => {
      if (!nodeId) return null
      const next = nodesById.get(nodeId)
      return next?.key ?? (next ? `node_${next.id}` : `node_${nodeId}`)
    }

    return nodes.map((node) => {
      const settings = node.settings ?? {}
      const linearNextLabel = getNodeLabel(node.next_node_id)
      const buttonTargets = Array.isArray(settings.buttons)
        ? settings.buttons
          .map((button: any) => getNodeLabel(Number(button?.next_node_id ?? 0)))
          .filter(Boolean)
        : []
      const listTargets = Array.isArray(settings.rows)
        ? settings.rows
          .map((row: any) => getNodeLabel(Number(row?.next_node_id ?? 0)))
          .filter(Boolean)
        : []

      const uniqueTargets = Array.from(new Set([linearNextLabel, ...buttonTargets, ...listTargets].filter(Boolean)))
      const nextSummary =
        uniqueTargets.length === 0
          ? null
          : uniqueTargets.length === 1
            ? uniqueTargets[0]
            : `${uniqueTargets[0]} +${uniqueTargets.length - 1}`

      const bodyPreview = (node.body ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 90)

      return {
        ...node,
        nextNodeKey: linearNextLabel,
        nextSummary,
        bodyPreview,
      }
    })
  }, [nodes, nodesById])

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

    return nextSettings
  }

  // 🔹 Inputs de settings específicos
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
                  <Input
                    value={btn.id ?? ""}
                    onChange={(e) => updateButton(index, "id", e.target.value)}
                    placeholder="ID interno (ej: menu_horarios)"
                    className="text-xs"
                  />
                  <Input
                    value={btn.title ?? ""}
                    onChange={(e) => updateButton(index, "title", e.target.value)}
                    placeholder="Texto del botón"
                    className="text-xs"
                  />
                </div>

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
                        settings: { ...settings, button_text: e.target.value },
                      }
                      : prev,
                  )
                }
                className="text-xs"
              />
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
                        settings: { ...settings, section_title: e.target.value },
                      }
                      : prev,
                  )
                }
                className="text-xs"
              />
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
                  <Input
                    value={row.id ?? ""}
                    onChange={(e) => updateRow(index, "id", e.target.value)}
                    placeholder="ID interno"
                    className="text-xs"
                  />
                  <Input
                    value={row.title ?? ""}
                    onChange={(e) => updateRow(index, "title", e.target.value)}
                    placeholder="Título visible"
                    className="text-xs"
                  />
                </div>

                <Input
                  value={row.description ?? ""}
                  onChange={(e) => updateRow(index, "description", e.target.value)}
                  placeholder="Descripción (opcional)"
                  className="text-xs mt-1"
                />

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
      // ✅ Unificamos "Siguiente nodo" en la columna next_node_id (no en settings)
      const settings = ensureSettings<{
        variable: string
        validation_regex: string
        error_message: string
      }>({
        variable: "",
        validation_regex: "",
        error_message: "Valor inválido, por favor revisá el formato e intentá de nuevo.",
      })

      const update = (field: keyof typeof settings, value: string) => {
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

      return (
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <label className="text-xs block text-muted-foreground">
              Nombre de la variable
            </label>
            <Input
              value={settings.variable ?? ""}
              onChange={(e) => update("variable", e.target.value)}
              placeholder="Ej: dni, nro_historia, etc."
              className="text-xs"
            />
          </div>
          </div>

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
              onChange={(e) => update("validation_regex", e.target.value)}
              placeholder="Ej: ^[0-9]{7,9}$"
              className="text-xs"
            />
          </div>

          <div>
            <label className="text-xs mb-1 block text-muted-foreground">
              Mensaje de error
            </label>
            <Textarea
              value={settings.error_message ?? ""}
              onChange={(e) => update("error_message", e.target.value)}
              rows={2}
              className="text-xs"
            />
          </div>
        </div>
      )
    }

    // handoff no tiene settings extra
    return null
  }

  const isLinearType = (t: NodeType) => t === "text" || t === "input"

  // 🔹 Render: layout general
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100">
      {/* Barra superior estilo panel de mensajes */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#013765] text-white">
        <div>
          <h1 className="font-semibold text-lg flex items-center gap-2">
            Constructor de flujo de bot
            <span className="text-xs font-normal opacity-80">(árbol de decisiones)</span>
          </h1>
          {selectedFlow ? (
            <p className="text-xs mt-1 opacity-80">
              Editando flujo: <span className="font-semibold">{selectedFlow.name}</span>
            </p>
          ) : (
            <p className="text-xs mt-1 opacity-80">Selecciona un flujo o crea uno nuevo.</p>
          )}
        </div>
        <div>
          <Button
            variant="outline"
            className="h-7 w-[6rem] px-5 border-slate-200 text-[#013765] bg-slate-100 hover:bg-slate-300"
            onClick={() => setTrashOpen(true)}
            title="Abrir papelera"
          >
            <Trash2 className="h-3 w-3" />
            <span>Papelera</span>
          </Button>
        </div>

      </div>

      {/* Contenido */}
      <div className="flex flex-1 gap-4 overflow-hidden p-4 min-h-0">
        {/* Sidebar de Flows */}
        <div className="w-64 min-h-0 flex flex-col border rounded-xl bg-white p-3 gap-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-[#013765]">Flujos del bot</h2>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                className="h-7 w-7 border-slate-200 text-[#013765] hover:bg-slate-100"
                onClick={() => setCreateModal("flow")}
                title="Crear flujo"
              >
                <Plus className="h-3 w-3" />
              </Button>

              <Button
                variant="outline"
                className="h-7 w-7 border-slate-200 text-[#013765] hover:bg-slate-100"
                onClick={() => window.location.reload()}
              >
                <RefreshCcw className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="space-y-2 flex-1 overflow-y-auto min-h-0 pr-1">
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
                      <span className="block truncate font-medium">{flow.name}</span>
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
                        >
                          Activar
                        </button>
                      )}

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
                    </div>
                  </div>

                  <div className={cn(
                    "flex items-center justify-between gap-2 text-[10px]",
                    selectedFlowId === flow.id ? "text-white/80" : "text-slate-500",
                  )}>
                    <span className="truncate">
                      {selectedFlowId === flow.id
                        ? `${nodes.length} nodos • Inicio: ${startNodeLabel}`
                        : `ID #${flow.id}`}
                    </span>
                    {selectedFlowId === flow.id ? (
                      <span className="rounded-full border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px]">
                        Editando
                      </span>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>

        </div>

        {/* Main: Nodes y editor */}
        <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
          <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
            {/* Lista de nodos */}
            <div className="w-80 min-h-0 border rounded-xl bg-white p-3 flex flex-col shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-sm text-[#013765]">Nodos del flujo</h3>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7 border-slate-200 text-[#013765] hover:bg-slate-100"
                    onClick={() => setCreateModal("node")}
                    disabled={!selectedFlowId}
                    title="Crear nodo"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
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
                </div>
              </div>

              <div className="space-y-2 flex-1 overflow-y-auto min-h-0 pr-1">
                {loadingNodes ? (
                  <p className="text-xs text-muted-foreground">Cargando nodos...</p>
                ) : nodes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No hay nodos para este flujo.</p>
                ) : (
                  nodesWithNextKey.map((node) => (
                    <div
                      key={node.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => requestSelectNode(node.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          requestSelectNode(node.id)
                        }
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg border text-xs flex flex-col gap-2 transition-colors",
                        selectedNodeId === node.id
                          ? "bg-[#013765] text-white border-[#013765]"
                          : "bg-white hover:bg-slate-100 border-slate-200",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">
                            {node.key || `node_${node.id}`}
                          </span>
                        </div>

                        <span className="text-[10px] uppercase tracking-wide shrink-0">
                          {node.type}
                        </span>
                      </div>

                      <div className={cn(
                        "rounded-md px-2 py-1.5 text-[10px]",
                        selectedNodeId === node.id ? "bg-white/10 text-white/85" : "bg-slate-50 text-slate-600",
                      )}>
                        {node.bodyPreview ? node.bodyPreview : "Sin mensaje configurado."}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        {node.nextSummary ? (
                          <div className="flex items-center text-[10px] opacity-80 min-w-0">
                            <ChevronRight className="h-3 w-3 mr-1 shrink-0" />
                            <span className="truncate">Siguiente: {node.nextSummary}</span>
                          </div>
                        ) : (
                          <span className="text-[10px] opacity-60">Sin siguiente nodo</span>
                        )}

                        <div className="flex items-center gap-2 shrink-0">
                          {selectedFlow?.start_node_id === node.id ? (
                            <span className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px]",
                              selectedNodeId === node.id
                                ? "bg-white/10 text-white"
                                : "bg-emerald-100 text-emerald-700",
                            )}>
                              Inicio
                            </span>
                          ) : null}

                          <button
                            type="button"
                            className={cn(
                              "inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                              selectedNodeId === node.id
                                ? "border-white/30 bg-white/10 text-white hover:bg-white/15"
                                : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100",
                            )}
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmDelete({
                                type: "node",
                                id: node.id,
                                name: node.key || `node_${node.id}`,
                              })
                            }}
                            disabled={deletingNodeId === node.id}
                            title="Eliminar nodo"
                          >
                            {deletingNodeId === node.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Panel de edición */}
            <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
              <Card className="shadow-sm">
                <CardHeader className="pb-2 border-b border-slate-200 bg-slate-50 bg-white rounded-t-xl">
                  <CardTitle className="text-sm text-[#013765]">Configuración del flujo</CardTitle>
                  <CardDescription className="text-xs">
                    Renombrá el flujo y definí desde qué nodo comienza la conversación.
                  </CardDescription>
                </CardHeader>

                <CardContent className="pt-4 bg-white rounded-b-xl">
                  {!selectedFlow ? (
                    <p className="text-xs text-muted-foreground">
                      Seleccioná un flujo en la lista de la izquierda para editar su configuración.
                    </p>
                  ) : (
                    <div className="space-y-4">
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
                              value={selectedFlow.start_node_id ? String(selectedFlow.start_node_id) : "none"}
                              onValueChange={(val) => handleSetStartNode(val === "none" ? null : Number(val))}
                              disabled={savingStartNode || nodes.length === 0}
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

                            {savingStartNode && (
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

                      <div className="mt-2 flex flex-col items-center gap-2">
                        <Button
                          size="sm"
                          className="w-full text-xs bg-[#013765] hover:bg-[#024a8a] text-white"
                          onClick={handleSaveFlow}
                          disabled={savingFlow || !hasUnsavedFlowChanges || !editFlowName.trim()}
                        >
                          {savingFlow ? "Guardando..." : "Guardar flujo"}
                        </Button>
                        {hasUnsavedFlowChanges && (
                          <div
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium border-amber-200 bg-amber-50 text-amber-700"
                            )}
                          >
                            <CircleDot className="h-3.5 w-3.5" />
                            <span>{hasUnsavedFlowChanges ? "Cambios sin guardar" : "Todo guardado"}</span>
                          </div>
                        )}

                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="flex-1 min-h-0 flex flex-col shadow-sm">
                <CardHeader className="pb-2 border-b border-slate-200 bg-slate-50 bg-white rounded-t-xl">
                  <CardTitle className="text-sm text-[#013765]">
                    Editor de nodo seleccionado
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Configurá el contenido y el comportamiento de este paso del bot.
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex-1 flex flex-col gap-4 overflow-y-auto pt-4 bg-white rounded-b-xl">
                  {!editNode ? (
                    <p className="text-xs text-muted-foreground">
                      Selecciona un nodo en la lista de la izquierda para editarlo.
                    </p>
                  ) : (
                    <>
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
                                prev ? { ...prev, key: e.target.value } : prev,
                              )
                            }
                            className="text-xs"
                          />
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

                                const linear = val === "text" || val === "input"

                                const cleanedSettings = (() => {
                                  const s = { ...(prev.settings ?? {}) }

                                  // si el nuevo tipo NO es lineal, borramos auto-advance
                                  if (!linear) {
                                    delete s.auto_advance
                                    delete s.auto_advance_delay_ms
                                    delete s.auto_advance_max_hops
                                  }

                                  // opcional: si querés, al pasar a buttons/list/handoff también podés limpiar otras cosas
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
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">Texto</SelectItem>
                              <SelectItem value="buttons">Botones</SelectItem>
                              <SelectItem value="list">Lista</SelectItem>
                              <SelectItem value="input">Input (capturar dato)</SelectItem>
                              <SelectItem value="handoff">Handoff a operador</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Texto principal */}
                      <div>
                        <label className="text-xs mb-1 block text-muted-foreground">
                          Mensaje
                        </label>
                        <Textarea
                          value={editNode.body ?? ""}
                          onChange={(e) =>
                            setEditNode((prev) =>
                              prev ? { ...prev, body: e.target.value } : prev,
                            )
                          }
                          rows={4}
                          className="text-xs"
                          placeholder="Texto que verá el paciente/usuario en este paso..."
                        />
                      </div>

                      {/* Settings específicos según tipo */}
                      {renderSettingsFields()}

                      {/* ✅ Siguiente nodo lineal (solo para text + input) */}
                      {isLinearType(editNode.type) && (
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

                      {/* ✅ Auto-disparo (solo para text + input) */}
                      {isLinearType(editNode.type) && (
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

                      {/* Botón guardar */}
                      <div className="mt-2 flex flex-col items-center gap-2">
                        <Button
                          size="sm"
                          className="w-full text-xs bg-[#013765] hover:bg-[#024a8a] text-white"
                          onClick={handleSaveNode}
                          disabled={savingNode || !hasUnsavedChanges}
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
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
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

            <div className="px-5 py-4">
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
                type="button"
                onClick={createModal === "flow" ? handleCreateFlow : handleCreateNode}
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
          </div>
        </div>
      )}

      {regexHelpOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Ayuda con regex</h3>
              <p className="mt-1 text-sm text-slate-600">
                Este campo sirve para validar lo que escribe el usuario antes de continuar con el flujo.
              </p>
            </div>

            <div className="space-y-4 px-5 py-4 text-sm text-slate-700">
              <div>
                <p className="font-medium text-slate-900">Para qué funciona</p>
                <p className="mt-1">
                  Si el texto del usuario cumple el patrón, el nodo acepta la respuesta. Si no cumple, se muestra el mensaje de error y el bot vuelve a pedir el dato.
                </p>
              </div>

              <div>
                <p className="font-medium text-slate-900">Cómo se usa</p>
                <p className="mt-1">
                  Escribí una expresión regular que represente el formato esperado. Por ejemplo, podés exigir solo números, una cantidad exacta de caracteres o un correo con formato válido.
                </p>
              </div>

              <div>
                <p className="font-medium text-slate-900">Ejemplos rápidos</p>
                <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[13px]">
                  <p><span className="font-semibold">DNI:</span> <code>^[0-9]{7,9}$</code></p>
                  <p><span className="font-semibold">Solo letras:</span> <code>^[A-Za-zÁÉÍÓÚáéíóúÑñ\\s]+$</code></p>
                  <p><span className="font-semibold">Email:</span> <code>^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$</code></p>
                  <p><span className="font-semibold">Celular argentino simple:</span> <code>^\\+?[0-9]{10,15}$</code></p>
                </div>
              </div>

              <div>
                <p className="font-medium text-slate-900">Cómo generarlo más fácil</p>
                <p className="mt-1">
                  Si no querés armar el regex a mano, podés pedírselo a ChatGPT. Ejemplo: "Generame un regex para validar un DNI argentino de 7 u 8 dígitos, y explicame qué acepta y qué no".
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

      {pendingNavigation && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Cambios sin guardar</h3>
              <p className="mt-1 text-sm text-slate-600">
                Tenes cambios sin guardar en este nodo. Si continuas, se perderan al cambiar de
                {pendingNavigation.type === "flow" ? " flujo." : " nodo."}
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
                          disabled={restoringFlowId === flow.id}
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
                            disabled={restoringNodeId === node.id || flowIsTrashed}
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
