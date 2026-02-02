"use client"

import { useEffect, useRef, useState } from "react"
import { Code, Database, Zap, User } from "lucide-react"
import { Avatar } from "shadcn/components/ui/avatar"
import { Badge } from "shadcn/components/ui/badge"
import mqtt from "mqtt"
import type { Chat, ChatVariable } from "./ChatPanel"

interface ChatInfoProps {
  chat?: Chat
  // opcional: si lo mandás por props lo usa, si no deriva de bot_state.vars
  variables?: ChatVariable[]
}

type VarType = "string" | "number" | "boolean" | "object" | "array" | "null" | "unknown"

export default function ChatInfo({ chat, variables = [] }: ChatInfoProps) {
  if (!chat) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-center">
          <h3 className="text-lg font-medium text-foreground mb-2">Información del Chat</h3>
          <p className="text-muted-foreground text-sm">
            Selecciona una conversación para ver los detalles
          </p>
        </div>
      </div>
    )
  }

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

  // ✅ 1) Variables internas como MAPA: evita duplicados
  const [varsMap, setVarsMap] = useState<Record<string, any>>(() => {
    // prioridad: variables por props si vienen (las convertimos a mapa)
    if (Array.isArray(variables) && variables.length > 0) {
      const m: Record<string, any> = {}
      for (const v of variables) m[v.name] = v.value
      return m
    }

    // fallback: bot_state.vars
    const initial = (chat?.bot_state as any)?.vars
    return initial && typeof initial === "object" && !Array.isArray(initial) ? initial : {}
  })

  // ✅ 2) Cuando cambia el chat, reseteamos varsMap desde bot_state.vars
  useEffect(() => {
    // prioridad: props
    if (Array.isArray(variables) && variables.length > 0) {
      const m: Record<string, any> = {}
      for (const v of variables) m[v.name] = v.value
      setVarsMap(m)
      return
    }

    const v = (chat?.bot_state as any)?.vars
    setVarsMap(v && typeof v === "object" && !Array.isArray(v) ? v : {})
  }, [chat?.id]) // intencional: al cambiar de chat, rehidrata

  // ✅ 3) MQTT: escuchar updates de variables (sin duplicar)
  const varsClientRef = useRef<any>(null)

  useEffect(() => {
    if (!chat?.id) return

    // cerrar cliente anterior (importantísimo)
    try {
      varsClientRef.current?.end?.(true)
    } catch { }

    const host = import.meta.env.VITE_MOSQUITTO_HOST
    const client = mqtt.connect(`ws://${host}:9001`, {
      clientId: `front_vars_${chat.id}_${Math.random().toString(16).slice(2)}`,
      clean: true,
      reconnectPeriod: 2000,
    })

    varsClientRef.current = client

    const topic = `chat/${chat.id}/vars`

    client.on("connect", () => {
      client.subscribe(topic)
    })

    client.on("message", (t, payload) => {
      if (t !== topic) return

      try {
        const data = JSON.parse(payload.toString())
        if (String(data.chat_id) !== String(chat.id)) return

        // ✅ si viene el mapa completo, reemplazamos
        if (data.vars && typeof data.vars === "object" && !Array.isArray(data.vars)) {
          setVarsMap(data.vars)
          return
        }

        // ✅ si viene una sola variable, merge por name (pisar, no append)
        if (data.var?.name) {
          const k = String(data.var.name)
          setVarsMap((prev) => ({
            ...prev,
            [k]: data.var.value,
          }))
        }
      } catch (err) {
        console.error("Error procesando MQTT vars en ChatInfo:", err)
      }
    })

    return () => {
      try {
        client.end(true)
      } catch { }
    }
  }, [chat?.id])

  // ✅ 4) Lista a render desde el mapa (no duplica nunca)
  const derivedVars: ChatVariable[] = Object.entries(varsMap).map(([name, value]) => ({
    name,
    value,
    type: detectType(value),
  }))

  // orden opcional para que se vea prolijo
  derivedVars.sort((a, b) => a.name.localeCompare(b.name))

  const hasVars = derivedVars.length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-300 bg-gray-50">
        <h2 className="text-lg font-semibold text-foreground">Información del Chat</h2>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-4">
          {/* Contacto */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="relative mb-3">
              <Avatar className="h-16 w-16 bg-gray-300 flex items-center justify-center">
                <User />
              </Avatar>
            </div>
            <h3 className="font-semibold text-foreground text-lg">{chat.name}</h3>
            <p className="text-sm text-muted-foreground">{chat.number}</p>

            {chat.unread > 0 && (
              <Badge variant="secondary" className="mt-2 bg-[#013765] text-white">
                {chat.unread} mensajes sin leer
              </Badge>
            )}
          </div>

          {/* Variables */}
          <div>
            <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <Database className="h-4 w-4" />
              Variables del Chat
            </h4>

            {!hasVars ? (
              <div className="bg-muted/30 rounded-lg p-3 border border-gray-300">
                <p className="text-sm text-muted-foreground">
                  Todavía no hay variables capturadas en este chat.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {derivedVars.map((variable) => {
                  const t = (variable.type as VarType) ?? detectType(variable.value)

                  return (
                    <div
                      key={variable.name}
                      className="rounded-lg border border-gray-200 bg-gray-100/80 px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {getVariableIcon(t)}
                          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                            {variable.name}
                          </span>
                        </div>

                        <span className="text-[11px] text-muted-foreground">
                          {t}
                        </span>
                      </div>

                      <div className="mt-1">
                        <div className="text-sm font-medium text-foreground break-words">
                          {formatVariableValue(variable.value, t)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
