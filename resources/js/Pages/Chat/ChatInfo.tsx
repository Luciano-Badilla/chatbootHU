"use client"

import { Settings, Bell, Shield, Code, Database, Zap, User } from "lucide-react"
import { Button } from "shadcn/components/ui/button"
import { Avatar } from "shadcn/components/ui/avatar"
import { Badge } from "shadcn/components/ui/badge"
import { Separator } from "shadcn/components/ui/separator"
import type { Chat, ChatVariable } from "./ChatPanel"

interface ChatInfoProps {
  // Chat actualmente seleccionado en el panel.
  // Viene desde ChatPanel, que gestiona el estado global de chats.
  chat?: Chat
  // Variables asociadas al chat (contexto, metadata, etc.).
  // La idea es que esto venga calculado desde el backend o desde otra capa.
  variables: ChatVariable[]
}

// Panel derecho con la información y metadata del chat seleccionado.
export default function ChatInfo({ chat, variables }: ChatInfoProps) {
  // Si todavía no se seleccionó ningún chat, mostramos un mensaje vacío.
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

  // Devuelve un icono según el tipo de variable (string, object, boolean, etc.)
  const getVariableIcon = (type: string) => {
    switch (type) {
      case "string":
        return <Code className="h-3 w-3" />
      case "object":
        return <Database className="h-3 w-3" />
      case "boolean":
        return <Zap className="h-3 w-3" />
      default:
        return <Code className="h-3 w-3" />
    }
  }

  // Formatea el valor de la variable para mostrarlo:
  // si es objeto/array lo mostramos como JSON, sino como string plano.
  const formatVariableValue = (value: any, type: string) => {
    if (type === "object") {
      return Array.isArray(value) ? `[${value.join(", ")}]` : JSON.stringify(value, null, 2)
    }
    return String(value)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header del panel de información */}
      <div className="p-4 border-b border-gray-300">
        <h2 className="text-lg font-semibold text-foreground">Información del Chat</h2>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Datos principales del chat */}
        <div className="p-4">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="relative mb-3">
              {/* Avatar genérico del contacto.
                 Se podría reemplazar por una imagen real si el backend envía `avatar`. */}
              <Avatar className="h-16 w-16 bg-gray-300 flex items-center justify-center">
                <User />
              </Avatar>
            </div>
            <h3 className="font-semibold text-foreground text-lg">{chat.name}</h3>
            {chat.unread > 0 && (
              <Badge variant="secondary" className="mt-2 bg-[#013765] text-white">
                {chat.unread} mensajes sin leer
              </Badge>
            )}
          </div>

          {/* Acciones rápidas (actualmente solo UI, no conectadas a lógica real) */}
          <div className="grid grid-cols-3 gap-2 mb-6">
            <Button
              variant="outline"
              size="sm"
              className="flex flex-col gap-1 h-auto py-3 bg-transparent"
            >
              <Bell className="h-4 w-4" />
              <span className="text-xs">Silenciar</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex flex-col gap-1 h-auto py-3 bg-transparent"
            >
              <Shield className="h-4 w-4" />
              <span className="text-xs">Bloquear</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex flex-col gap-1 h-auto py-3 bg-transparent"
            >
              <Settings className="h-4 w-4" />
              <span className="text-xs">Ajustes</span>
            </Button>
          </div>

          <Separator className="my-4" />

          {/* Sección de variables del chat (contexto, flags, metadata de IA, etc.) */}
          <div>
            <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <Database className="h-4 w-4" />
              Variables del Chat
            </h4>

            <div className="space-y-3">
              {variables.map((variable, index) => (
                <div
                  key={index}
                  className="bg-muted/30 rounded-lg p-3 border border-gray-300"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getVariableIcon(variable.type)}
                      <span className="font-mono text-sm text-foreground">
                        {variable.name}
                      </span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {variable.type}
                    </Badge>
                  </div>

                  {variable.description && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {variable.description}
                    </p>
                  )}

                  <div className="bg-background/50 rounded p-2 border">
                    <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-all">
                      {formatVariableValue(variable.value, variable.type)}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator className="my-4" />

          {/* Estadísticas del chat.
             De momento los datos son estáticos/ejemplo, salvo variables.length y chat.timestamp.
             Se pueden reemplazar por métricas reales si el backend las provee. */}
          <div>
            <h4 className="font-medium text-foreground mb-3">Estadísticas</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mensajes totales:</span>
                <span className="text-foreground">247</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Variables generadas:</span>
                <span className="text-foreground">{variables.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Última actividad:</span>
                <span className="text-foreground">{chat.timestamp}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
