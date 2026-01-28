"use client"

import { useEffect, useMemo, useState } from "react"
import { Code, Database, Zap, User } from "lucide-react"
import { Avatar } from "shadcn/components/ui/avatar"
import { Badge } from "shadcn/components/ui/badge"
import type { Chat, ChatVariable } from "./ChatPanel"
import mqtt from "mqtt"

interface ChatInfoProps {
  chat?: Chat
  // si viene desde backend lo usamos, si no, lo inferimos del chat.bot_state.vars
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

  // ✅ estado local “vivo” (se actualiza desde chat.bot_state.vars y MQTT)
  const [varsState, setVarsState] = useState<Record<string, any>>({})

  // ✅ sync inicial cada vez que cambie el chat seleccionado
  useEffect(() => {
    const varsObj =
      chat?.bot_state?.vars &&
        typeof chat.bot_state.vars === "object" &&
        !Array.isArray(chat.bot_state.vars)
        ? (chat.bot_state.vars as Record<string, any>)
        : {}

    setVarsState(varsObj)
  }, [chat.id])

  // ✅ MQTT: escuchar variables en tiempo real del chat actual
  useEffect(() => {
    if (!chat) return

    const mosquitto_host = import.meta.env.VITE_MOSQUITTO_HOST
    const client = mqtt.connect(`ws://${mosquitto_host}:9001`)

    client.on("connect", () => {
      // 👇 OPCIÓN 1 (recomendada): topic separado para variables
      const topic = `chat/${chat.id}/vars`
      client.subscribe(topic)
    })

    client.on("message", (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString())

        // Si publicás con chat_id, filtramos por seguridad
        if (data?.chat_id && String(data.chat_id) !== String(chat.id)) return

        /**
         * Soportamos 2 formatos:
         * A) { chat_id, vars: {dni:"...", ...} }   -> reemplaza todo
         * B) { chat_id, var: {name:"dni", value:"..."} } -> upsert 1 variable
         */
        if (data?.vars && typeof data.vars === "object" && !Array.isArray(data.vars)) {
          setVarsState(data.vars)
          return
        }

        const v = data?.var
        if (v?.name) {
          setVarsState((prev) => ({
            ...prev,
            [v.name]: v.value,
          }))
        }
      } catch (err) {
        console.error("Error procesando MQTT vars en ChatInfo:", err)
      }
    })

    return () => {
      client.end()
    }
  }, [chat?.id])

  // ✅ Variables a renderizar:
  // 1) si vienen por props (backend) ganan
  // 2) si no, usamos varsState (vivo)
  const derivedVars: ChatVariable[] = useMemo(() => {
    const varsFromProps = Array.isArray(variables) ? variables : []
    if (varsFromProps.length > 0) return varsFromProps

    return Object.entries(varsState).map(([name, value]) => ({
      name,
      value,
      type: detectType(value),
    }))
  }, [variables, varsState])

  const hasVars = derivedVars.length > 0

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-gray-300">
        <h2 className="text-lg font-semibold text-foreground">Información del Chat</h2>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-4">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="relative mb-3">
              <Avatar className="h-16 w-16 bg-gray-300 flex items-center justify-center">
                <User />
              </Avatar>
            </div>

            <h3 className="font-semibold text-foreground text-lg">{chat.name}</h3>
            <h3 className="text-sm text-muted-foreground">{chat.number}</h3>

            {chat.unread > 0 && (
              <Badge variant="secondary" className="mt-2 bg-[#013765] text-white">
                {chat.unread} mensajes sin leer
              </Badge>
            )}
          </div>

          <div>
            <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
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
                {derivedVars.map((variable, index) => {
                  const t = (variable.type as VarType) ?? detectType(variable.value)

                  return (
                    <div className="space-y-3">
                      {derivedVars.map((variable, index) => {
                        const t = variable.type as VarType

                        return (
                          <div
                            key={`${variable.name}-${index}`}
                            className="
                              rounded-lg
                              bg-gray-200
                              border
                              border-gray-200
                              px-3
                              py-2.5
                              shadow-sm
                            "
                          >
                            {/* Header: nombre + tipo */}
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                {variable.name}
                              </span>
                              </div>

                            {/* Valor */}
                            <div className="text-sm font-medium text-foreground break-all">
                              {formatVariableValue(variable.value, t)}
                            </div>
                          </div>
                        )
                      })}
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
