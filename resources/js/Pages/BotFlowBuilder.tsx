"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus, RefreshCcw, ChevronRight, Zap, Loader2 } from "lucide-react"
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
}

interface BotNode {
  id: number
  flow_id: number
  key: string | null
  type: NodeType
  body: string | null
  settings: any
  next_node_id: number | null
}

const API_BASE = (import.meta.env.VITE_APP_URL || "").replace(/\/$/, "")

const MAX_BUTTONS = 2 // si querés 3 (lo que permite WhatsApp), poné 3
const MAX_LIST_ROWS = 10

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

  const [newFlowName, setNewFlowName] = useState("")
  const [newNodeKey, setNewNodeKey] = useState("")

  // Estado local editable del nodo
  const [editNode, setEditNode] = useState<BotNode | null>(null)

  // 🔹 Flow seleccionado
  const selectedFlow = useMemo(
    () => flows.find((f) => f.id === selectedFlowId) ?? null,
    [flows, selectedFlowId],
  )

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
      return
    }
    const n = nodes.find((x) => x.id === selectedNodeId) ?? null
    setEditNode(n ? { ...n, settings: n.settings ?? {} } : null)
  }, [selectedNodeId, nodes])

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
    } catch (err) {
      console.error("Error de red al crear node:", err)
    } finally {
      setCreatingNode(false)
    }
  }

  // 🔹 Guardar cambios del nodo
  const handleSaveNode = async () => {
    if (!editNode) return
    setSavingNode(true)
    try {
      const res = await fetch(`${API_BASE}/api/bot/nodes/${editNode.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editNode),
      })
      if (!res.ok) {
        console.error("Error al guardar node", await res.text())
        return
      }
      const updated: BotNode = await res.json()
      setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)))
    } catch (err) {
      console.error("Error de red al guardar node:", err)
    } finally {
      setSavingNode(false)
    }
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
    return nodes.map((node) => {
      const next = node.next_node_id ? nodesById.get(node.next_node_id) : undefined

      return {
        ...node,
        nextNodeKey: next?.key ?? (next ? `node_${next.id}` : null),
      }
    })
  }, [nodes, nodesById])

  const startNodeLabel = useMemo(() => {
    if (!selectedFlow?.start_node_id) return "no definido"
    const n = nodes.find((x) => x.id === selectedFlow.start_node_id)
    return n?.key || (n ? `node_${n.id}` : `Cargando...`)
  }, [selectedFlow?.start_node_id, nodes])

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
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Botones</h4>
            <Button
              size="xs"
              variant="outline"
              className="border-[#013765] text-[#013765] hover:bg-[#013765] hover:text-white"
              onClick={addButton}
              disabled={buttons.length >= MAX_BUTTONS}
            >
              <Plus className="h-3 w-3 mr-1" />
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

                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => removeButton(index)}
                  >
                    Eliminar
                  </Button>
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

          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Opciones de la lista</h4>
            <Button
              size="xs"
              variant="outline"
              className="border-[#013765] text-[#013765] hover:bg-[#013765] hover:text-white"
              onClick={addRow}
              disabled={rows.length >= MAX_LIST_ROWS}
            >
              <Plus className="h-3 w-3 mr-1" />
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

                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => removeRow(index)}
                  >
                    Eliminar
                  </Button>
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
            <label className="text-xs mb-1 block text-muted-foreground">
              Nombre de la variable
            </label>
            <Input
              value={settings.variable ?? ""}
              onChange={(e) => update("variable", e.target.value)}
              placeholder="Ej: dni, nro_historia, etc."
              className="text-xs"
            />
          </div>

          <div>
            <label className="text-xs mb-1 block text-muted-foreground">
              Regex de validación (opcional)
            </label>
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
    <div className="flex h-full flex-col bg-slate-100">
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
        {selectedFlow && (
          <div className="inline-flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full text-xs">
            <Zap className="h-6 w-6 text-yellow-300" />

            <span className="opacity-90">Nodo inicial:</span>
            <div className="relative">
              <Select
                value={selectedFlow.start_node_id ? String(selectedFlow.start_node_id) : "none"}
                onValueChange={(val) => handleSetStartNode(val === "none" ? null : Number(val))}
                disabled={savingStartNode || nodes.length === 0}
              >
                <SelectTrigger className="h-7 text-xs bg-white/10 border-white/20 text-white hover:bg-white/15 pr-8">
                  <SelectValue placeholder="Elegí nodo..." />
                </SelectTrigger>
                <SelectContent>
                  {startNodeOptions.map((opt) => (
                    <SelectItem key={opt.id} value={String(opt.id)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {savingStartNode && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-white/90" />
                </div>
              )}
            </div>
          </div>

        )}

      </div>

      {/* Contenido */}
      <div className="flex flex-1 gap-4 p-4">
        {/* Sidebar de Flows */}
        <div className="w-64 flex flex-col border rounded-xl bg-white p-3 gap-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-[#013765]">Flujos del bot</h2>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-[#013765]"
              onClick={() => window.location.reload()}
            >
              <RefreshCcw className="h-3 w-3" />
            </Button>
          </div>

          <div className="space-y-2 flex-1 overflow-y-auto">
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
                  onClick={() => setSelectedFlowId(flow.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      setSelectedFlowId(flow.id)
                    }
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-xs border flex items-center justify-between transition-colors cursor-pointer select-none",
                    selectedFlowId === flow.id
                      ? "bg-[#013765] text-white border-[#013765]"
                      : "bg-white hover:bg-slate-100 border-slate-200",
                  )}
                >
                  <span className="truncate">{flow.name}</span>

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
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Crear flujo */}
          <div className="border-t pt-2 mt-2">
            <p className="text-[11px] text-muted-foreground mb-1">Crear nuevo flujo</p>
            <div className="flex gap-1">
              <Input
                value={newFlowName}
                onChange={(e) => setNewFlowName(e.target.value)}
                placeholder="Nombre del flujo"
                className="h-8 text-xs"
              />
              <Button
                size="icon"
                className="h-8 w-8 bg-[#013765] hover:bg-[#024a8a] text-white"
                onClick={handleCreateFlow}
                disabled={creatingFlow || !newFlowName.trim()}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        {/* Main: Nodes y editor */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex gap-4 h-[calc(100%-0rem)]">
            {/* Lista de nodos */}
            <div className="w-80 border rounded-xl bg-white p-3 flex flex-col shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-sm text-[#013765]">Nodos del flujo</h3>
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

              <div className="space-y-2 flex-1 overflow-y-auto">
                {loadingNodes ? (
                  <p className="text-xs text-muted-foreground">Cargando nodos...</p>
                ) : nodes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No hay nodos para este flujo.</p>
                ) : (
                  nodesWithNextKey.map((node) => (
                    <button
                      key={node.id}
                      onClick={() => setSelectedNodeId(node.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg border text-xs flex flex-col gap-1 transition-colors",
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

                      {node.next_node_id && (
                        <div className="flex items-center text-[10px] opacity-80">
                          <ChevronRight className="h-3 w-3 mr-1" />
                          Siguiente: {node.nextNodeKey}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>

              {/* Crear nodo */}
              {selectedFlowId && (
                <div className="border-t pt-2 mt-2">
                  <p className="text-[11px] text-muted-foreground mb-1">Nuevo nodo</p>
                  <div className="flex gap-1">
                    <Input
                      value={newNodeKey}
                      onChange={(e) => setNewNodeKey(e.target.value)}
                      placeholder="key del nodo (ej: menu_principal)"
                      className="h-8 text-xs"
                    />
                    <Button
                      size="icon"
                      className="h-8 w-8 bg-[#013765] hover:bg-[#024a8a] text-white"
                      onClick={handleCreateNode}
                      disabled={creatingNode || !newNodeKey.trim()}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Editor del nodo seleccionado */}
            <div className="flex-1">
              <Card className="h-full flex flex-col shadow-sm">
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
                        </div>
                      )}

                      {/* Botón guardar */}
                      <div className="mt-2">
                        <Button
                          size="sm"
                          className="text-xs bg-[#013765] hover:bg-[#024a8a] text-white"
                          onClick={handleSaveNode}
                          disabled={savingNode}
                        >
                          {savingNode ? "Guardando..." : "Guardar nodo"}
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
