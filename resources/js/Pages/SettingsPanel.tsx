import { useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronsUpDown,
  Download,
  Loader2,
  Upload,
} from "lucide-react"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "shadcn/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "shadcn/components/ui/dialog"
import { Input } from "shadcn/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "shadcn/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "shadcn/components/ui/select"
import { Textarea } from "shadcn/components/ui/textarea"
import { toast } from "sonner"
import { cn } from "shadcn/lib/utils"

interface SettingsPanelProps {
  settings?: {
    general?: {
      timezone?: string
      language?: string
    }
    integrations?: {
      whatsapp?: {
        token?: string
        phone_number_id?: string
        webhook_verify_token?: string
      }
      alephoo?: {
        base_url?: string
        api_key?: string
        timeout?: string
        enabled_endpoints?: string
      }
    }
    bot?: {
      default_flow_id?: number | null
      inactivity_timeout_minutes?: string
      inactivity_timeout_message?: string
    }
  }
  botFlows?: Array<{
    id: number
    name: string
    is_default?: boolean
  }>
  roles?: Array<{
    id: number
    name: string
  }>
  users?: Array<{
    id: number
    name: string
    email: string
    validated: boolean
    requests_password: boolean
    role_id: number
    role_name: string
    role_label?: string
  }>
  currentUserId?: number | null
  timezoneOptions?: Array<{
    value: string
    label: string
  }>
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ""

function getErrorMessage(payload: any, fallback: string): string {
  return payload?.errors?.file?.[0] ?? payload?.message ?? fallback
}

export default function SettingsPanel({
  settings,
  botFlows = [],
  roles = [],
  users = [],
  currentUserId = null,
  timezoneOptions = [],
}: SettingsPanelProps) {
  const initialTimezone = settings?.general?.timezone ?? "America/Argentina/Buenos_Aires"
  const initialLanguage = settings?.general?.language ?? "es"
  const initialWhatsappToken = settings?.integrations?.whatsapp?.token ?? ""
  const initialWhatsappPhoneNumberId = settings?.integrations?.whatsapp?.phone_number_id ?? ""
  const initialWhatsappVerifyToken = settings?.integrations?.whatsapp?.webhook_verify_token ?? ""
  const initialAlephooBaseUrl = settings?.integrations?.alephoo?.base_url ?? ""
  const initialAlephooApiKey = settings?.integrations?.alephoo?.api_key ?? ""
  const initialAlephooTimeout = settings?.integrations?.alephoo?.timeout ?? "30"
  const initialAlephooEndpoints = settings?.integrations?.alephoo?.enabled_endpoints ?? ""
  const initialDefaultFlowId =
    settings?.bot?.default_flow_id ?? botFlows.find((flow) => flow.is_default)?.id ?? botFlows[0]?.id ?? null
  const initialInactivityTimeoutMinutes = settings?.bot?.inactivity_timeout_minutes ?? "1440"
  const initialInactivityTimeoutMessage =
    settings?.bot?.inactivity_timeout_message ??
    "La conversacion se cerro por inactividad. Si queres continuar, escribinos nuevamente y retomamos desde el inicio."

  const [timezone, setTimezone] = useState(initialTimezone)
  const [language, setLanguage] = useState(initialLanguage)
  const [savedTimezone, setSavedTimezone] = useState(initialTimezone)
  const [savedLanguage, setSavedLanguage] = useState(initialLanguage)
  const [whatsappToken, setWhatsappToken] = useState(initialWhatsappToken)
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState(initialWhatsappPhoneNumberId)
  const [whatsappVerifyToken, setWhatsappVerifyToken] = useState(initialWhatsappVerifyToken)
  const [alephooBaseUrl, setAlephooBaseUrl] = useState(initialAlephooBaseUrl)
  const [alephooApiKey, setAlephooApiKey] = useState(initialAlephooApiKey)
  const [alephooTimeout, setAlephooTimeout] = useState(initialAlephooTimeout)
  const [alephooEndpoints, setAlephooEndpoints] = useState(initialAlephooEndpoints)
  const [savedWhatsappToken, setSavedWhatsappToken] = useState(initialWhatsappToken)
  const [savedWhatsappPhoneNumberId, setSavedWhatsappPhoneNumberId] = useState(initialWhatsappPhoneNumberId)
  const [savedWhatsappVerifyToken, setSavedWhatsappVerifyToken] = useState(initialWhatsappVerifyToken)
  const [savedAlephooBaseUrl, setSavedAlephooBaseUrl] = useState(initialAlephooBaseUrl)
  const [savedAlephooApiKey, setSavedAlephooApiKey] = useState(initialAlephooApiKey)
  const [savedAlephooTimeout, setSavedAlephooTimeout] = useState(initialAlephooTimeout)
  const [savedAlephooEndpoints, setSavedAlephooEndpoints] = useState(initialAlephooEndpoints)
  const [defaultFlowId, setDefaultFlowId] = useState<number | null>(initialDefaultFlowId)
  const [inactivityTimeoutMinutes, setInactivityTimeoutMinutes] = useState(initialInactivityTimeoutMinutes)
  const [inactivityTimeoutMessage, setInactivityTimeoutMessage] = useState(initialInactivityTimeoutMessage)
  const [savedDefaultFlowId, setSavedDefaultFlowId] = useState<number | null>(initialDefaultFlowId)
  const [savedInactivityTimeoutMinutes, setSavedInactivityTimeoutMinutes] = useState(initialInactivityTimeoutMinutes)
  const [savedInactivityTimeoutMessage, setSavedInactivityTimeoutMessage] = useState(initialInactivityTimeoutMessage)
  const [savingGeneral, setSavingGeneral] = useState(false)
  const [generalSaved, setGeneralSaved] = useState(false)
  const [savingBot, setSavingBot] = useState(false)
  const [botSaved, setBotSaved] = useState(false)
  const [savingIntegrations, setSavingIntegrations] = useState(false)
  const [integrationsSaved, setIntegrationsSaved] = useState(false)
  const [timezoneOpen, setTimezoneOpen] = useState(false)
  const [usersState, setUsersState] = useState(users)
  const [savedUsersState, setSavedUsersState] = useState(users)
  const [savingUserId, setSavingUserId] = useState<number | null>(null)
  const [savedUserId, setSavedUserId] = useState<number | null>(null)
  const [exportingConfig, setExportingConfig] = useState(false)
  const [importingConfig, setImportingConfig] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importError, setImportError] = useState("")

  useEffect(() => {
    setTimezone(initialTimezone)
    setLanguage(initialLanguage)
    setSavedTimezone(initialTimezone)
    setSavedLanguage(initialLanguage)
    setWhatsappToken(initialWhatsappToken)
    setWhatsappPhoneNumberId(initialWhatsappPhoneNumberId)
    setWhatsappVerifyToken(initialWhatsappVerifyToken)
    setAlephooBaseUrl(initialAlephooBaseUrl)
    setAlephooApiKey(initialAlephooApiKey)
    setAlephooTimeout(initialAlephooTimeout)
    setAlephooEndpoints(initialAlephooEndpoints)
    setSavedWhatsappToken(initialWhatsappToken)
    setSavedWhatsappPhoneNumberId(initialWhatsappPhoneNumberId)
    setSavedWhatsappVerifyToken(initialWhatsappVerifyToken)
    setSavedAlephooBaseUrl(initialAlephooBaseUrl)
    setSavedAlephooApiKey(initialAlephooApiKey)
    setSavedAlephooTimeout(initialAlephooTimeout)
    setSavedAlephooEndpoints(initialAlephooEndpoints)
    setDefaultFlowId(initialDefaultFlowId)
    setInactivityTimeoutMinutes(initialInactivityTimeoutMinutes)
    setInactivityTimeoutMessage(initialInactivityTimeoutMessage)
    setSavedDefaultFlowId(initialDefaultFlowId)
    setSavedInactivityTimeoutMinutes(initialInactivityTimeoutMinutes)
    setSavedInactivityTimeoutMessage(initialInactivityTimeoutMessage)
    setUsersState(users)
    setSavedUsersState(users)
  }, [
    initialTimezone,
    initialLanguage,
    initialWhatsappToken,
    initialWhatsappPhoneNumberId,
    initialWhatsappVerifyToken,
    initialAlephooBaseUrl,
    initialAlephooApiKey,
    initialAlephooTimeout,
    initialAlephooEndpoints,
    initialDefaultFlowId,
    initialInactivityTimeoutMinutes,
    initialInactivityTimeoutMessage,
    users,
  ])

  const hasUnsavedGeneralChanges = useMemo(() => {
    return timezone !== savedTimezone || language !== savedLanguage
  }, [timezone, language, savedTimezone, savedLanguage])

  const hasUnsavedIntegrationsChanges = useMemo(() => {
    return (
      whatsappToken !== savedWhatsappToken ||
      whatsappPhoneNumberId !== savedWhatsappPhoneNumberId ||
      whatsappVerifyToken !== savedWhatsappVerifyToken ||
      alephooBaseUrl !== savedAlephooBaseUrl ||
      alephooApiKey !== savedAlephooApiKey ||
      alephooTimeout !== savedAlephooTimeout ||
      alephooEndpoints !== savedAlephooEndpoints
    )
  }, [
    whatsappToken,
    whatsappPhoneNumberId,
    whatsappVerifyToken,
    alephooBaseUrl,
    alephooApiKey,
    alephooTimeout,
    alephooEndpoints,
    savedWhatsappToken,
    savedWhatsappPhoneNumberId,
    savedWhatsappVerifyToken,
    savedAlephooBaseUrl,
    savedAlephooApiKey,
    savedAlephooTimeout,
    savedAlephooEndpoints,
  ])

  const hasUnsavedBotChanges = useMemo(() => {
    return (
      defaultFlowId !== savedDefaultFlowId ||
      inactivityTimeoutMinutes !== savedInactivityTimeoutMinutes ||
      inactivityTimeoutMessage !== savedInactivityTimeoutMessage
    )
  }, [
    defaultFlowId,
    inactivityTimeoutMinutes,
    inactivityTimeoutMessage,
    savedDefaultFlowId,
    savedInactivityTimeoutMinutes,
    savedInactivityTimeoutMessage,
  ])

  const handleSaveGeneral = async () => {
    setSavingGeneral(true)
    setGeneralSaved(false)

    try {
      const csrfToken = document
        .querySelector('meta[name="csrf-token"]')
        ?.getAttribute("content")

      const res = await fetch(`${API_BASE}/api/settings/general`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(csrfToken ? { "X-CSRF-TOKEN": csrfToken } : {}),
        },
        body: JSON.stringify({
          timezone,
          language,
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        console.error("Error guardando configuracion general", payload)
        toast.error("No se pudo guardar la configuracion general", {
          description: getErrorMessage(payload, "Revisa los datos e intenta nuevamente."),
        })
        return
      }

      setSavedTimezone(timezone)
      setSavedLanguage(language)
      setGeneralSaved(true)
      toast.success("Configuracion general guardada", {
        description: "Los cambios de zona horaria e idioma se guardaron correctamente.",
      })
    } catch (err) {
      console.error("Error de red guardando configuracion general:", err)
      toast.error("Error de red", {
        description: "No se pudo guardar la configuracion general.",
      })
    } finally {
      setSavingGeneral(false)
    }
  }

  const handleSaveBot = async () => {
    if (!defaultFlowId) {
      return
    }

    setSavingBot(true)
    setBotSaved(false)

    try {
      const csrfToken = document
        .querySelector('meta[name="csrf-token"]')
        ?.getAttribute("content")

      const res = await fetch(`${API_BASE}/api/settings/bot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(csrfToken ? { "X-CSRF-TOKEN": csrfToken } : {}),
        },
        body: JSON.stringify({
          default_flow_id: defaultFlowId,
          inactivity_timeout_minutes: Number(inactivityTimeoutMinutes || 1440),
          inactivity_timeout_message: inactivityTimeoutMessage,
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        console.error("Error guardando configuracion del bot", payload)
        toast.error("No se pudo guardar la configuracion del bot", {
          description: getErrorMessage(payload, "Revisa los datos del bot e intenta nuevamente."),
        })
        return
      }

      setSavedDefaultFlowId(defaultFlowId)
      setSavedInactivityTimeoutMinutes(inactivityTimeoutMinutes)
      setSavedInactivityTimeoutMessage(inactivityTimeoutMessage)
      setBotSaved(true)
      toast.success("Configuracion del bot guardada", {
        description: "Se actualizaron el flujo por defecto y la politica de inactividad.",
      })
    } catch (err) {
      console.error("Error de red guardando configuracion del bot:", err)
      toast.error("Error de red", {
        description: "No se pudo guardar la configuracion del bot.",
      })
    } finally {
      setSavingBot(false)
    }
  }

  const handleSaveIntegrations = async () => {
    setSavingIntegrations(true)
    setIntegrationsSaved(false)

    try {
      const csrfToken = document
        .querySelector('meta[name="csrf-token"]')
        ?.getAttribute("content")

      const res = await fetch(`${API_BASE}/api/settings/integrations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(csrfToken ? { "X-CSRF-TOKEN": csrfToken } : {}),
        },
        body: JSON.stringify({
          whatsapp: {
            token: whatsappToken,
            phone_number_id: whatsappPhoneNumberId,
            webhook_verify_token: whatsappVerifyToken,
          },
          alephoo: {
            base_url: alephooBaseUrl,
            api_key: alephooApiKey,
            timeout: Number(alephooTimeout || 30),
            enabled_endpoints: alephooEndpoints,
          },
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        console.error("Error guardando integraciones", payload)
        toast.error("No se pudieron guardar las integraciones", {
          description: getErrorMessage(payload, "Revisa la configuracion de canales e integraciones."),
        })
        return
      }

      setSavedWhatsappToken(whatsappToken)
      setSavedWhatsappPhoneNumberId(whatsappPhoneNumberId)
      setSavedWhatsappVerifyToken(whatsappVerifyToken)
      setSavedAlephooBaseUrl(alephooBaseUrl)
      setSavedAlephooApiKey(alephooApiKey)
      setSavedAlephooTimeout(alephooTimeout)
      setSavedAlephooEndpoints(alephooEndpoints)
      setIntegrationsSaved(true)
      toast.success("Integraciones guardadas", {
        description: "La configuracion de WhatsApp y Alephoo se guardo correctamente.",
      })
    } catch (err) {
      console.error("Error de red guardando integraciones:", err)
      toast.error("Error de red", {
        description: "No se pudieron guardar las integraciones.",
      })
    } finally {
      setSavingIntegrations(false)
    }
  }

  const handleUserRoleChange = (userId: number, roleId: number) => {
    setSavedUserId(null)
    setUsersState((prev) =>
      prev.map((user) => {
        if (user.id !== userId) return user

        const nextRole = roles.find((role) => role.id === roleId)

        return {
          ...user,
          role_id: roleId,
          role_name:
            roleId === 1
              ? "admin"
              : roleId === 2
                ? "supervisor"
                : "operator",
          role_label: nextRole?.name ?? user.role_label,
        }
      }),
    )
  }

  const handleSaveUserRole = async (userId: number) => {
    const targetUser = usersState.find((user) => user.id === userId)
    if (!targetUser) return

    setSavingUserId(userId)
    setSavedUserId(null)

    try {
      const csrfToken = document
        .querySelector('meta[name="csrf-token"]')
        ?.getAttribute("content")

      const res = await fetch(`${API_BASE}/api/settings/users/${userId}/role`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(csrfToken ? { "X-CSRF-TOKEN": csrfToken } : {}),
        },
        body: JSON.stringify({
          role_id: targetUser.role_id,
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        console.error("Error guardando rol de usuario", payload)
        setUsersState(users)
        setSavedUsersState(users)
        toast.error("No se pudo actualizar el rol", {
          description: getErrorMessage(payload, "Intenta nuevamente con otro rol o recarga la pantalla."),
        })
        return
      }

      const payload = await res.json()
      setUsersState((prev) =>
        prev.map((user) => (user.id === userId ? payload.user : user)),
      )
      setSavedUsersState((prev) =>
        prev.map((user) => (user.id === userId ? payload.user : user)),
      )
      setSavedUserId(userId)
      toast.success("Rol actualizado", {
        description: `El usuario ${payload.user?.name ?? "seleccionado"} ya tiene el nuevo rol aplicado.`,
      })
    } catch (err) {
      console.error("Error de red guardando rol de usuario:", err)
      setUsersState(users)
      setSavedUsersState(users)
      toast.error("Error de red", {
        description: "No se pudo actualizar el rol del usuario.",
      })
    } finally {
      setSavingUserId(null)
    }
  }

  const handleExportConfig = async () => {
    setExportingConfig(true)

    try {
      toast.info("Exportacion iniciada", {
        description: "Se esta descargando el archivo de configuracion del sistema.",
      })
      window.location.href = `${API_BASE}/api/settings/export`
      setExportDialogOpen(false)
    } finally {
      window.setTimeout(() => setExportingConfig(false), 1200)
    }
  }

  const handleImportConfig = async () => {
    if (!importFile) {
      setImportError("Selecciona un archivo JSON exportado para continuar.")
      return
    }

    setImportingConfig(true)
    setImportError("")

    try {
      const formData = new FormData()
      formData.append("file", importFile)

      const res = await fetch(`${API_BASE}/api/settings/import`, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: formData,
      })

      const payload = await res.json().catch(() => null)

      if (!res.ok) {
        const message = getErrorMessage(
          payload,
          "No se pudo importar la configuracion. Verifica que el archivo sea valido.",
        )
        setImportError(message)
        toast.error("Importacion fallida", {
          description: message,
        })
        return
      }

      setImportDialogOpen(false)
      setImportFile(null)
      toast.success("Configuracion importada", {
        description: "La importacion se completo correctamente. La pantalla se recargara para reflejar los cambios.",
      })
      window.location.reload()
    } catch (err) {
      console.error("Error de red importando configuracion:", err)
      setImportError("Hubo un problema de red importando la configuracion.")
      toast.error("Error de red", {
        description: "Hubo un problema de red importando la configuracion.",
      })
    } finally {
      setImportingConfig(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f8fb]">
      <header className="border-b border-[#dbe5ef] bg-[#013765]">
        <div className="container mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-semibold text-white">Configuracion</h1>
              <p className="text-sm text-white/75">
                Modulo central para administrar opciones globales del sistema.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => {
                window.location.href = "/audit-panel"
              }}
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              Ver auditoria
            </Button>
            <Button
              variant="outline"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => {
                setImportError("")
                setImportDialogOpen(true)
              }}
            >
              <Upload className="mr-2 h-4 w-4" />
              Importar configuracion
            </Button>
            <Button
              className="bg-white text-[#013765] hover:bg-slate-100"
              onClick={() => setExportDialogOpen(true)}
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar configuracion
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto flex flex-col gap-6 px-6 py-8">
        <Card className="order-4 border-[#dbe5ef] bg-white">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-[#013765]">Usuarios y roles</CardTitle>
                <CardDescription className="text-[#013765]/70">
                  Administra el perfil operativo de cada usuario del sistema.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-[#dbe5ef]">
              <div className="grid grid-cols-1 gap-3 border-b border-[#dbe5ef] bg-[#013765]/[0.03] px-4 py-3 text-xs font-medium text-[#013765]/70 md:grid-cols-[minmax(0,1.4fr)_180px_160px]">
                <span>Usuario</span>
                <span>Rol</span>
                <span className="text-right">Accion</span>
              </div>

              <div className="divide-y divide-[#dbe5ef]">
                {usersState.map((user) => {
                  const hasRoleChanges =
                    user.role_id !== (savedUsersState.find((item) => item.id === user.id)?.role_id ?? user.role_id)
                  const isSaving = savingUserId === user.id
                  const isSaved = savedUserId === user.id && !hasRoleChanges
                  const isCurrentUser = currentUserId === user.id

                  return (
                    <div
                      key={user.id}
                      className={cn(
                        "grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.4fr)_180px_160px] md:items-center",
                        isCurrentUser ? "bg-slate-50/80" : "",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-[#013765]">{user.name}</p>
                          {isCurrentUser ? (
                            <Badge variant="secondary" className="bg-slate-200 text-slate-700">
                              Tu usuario
                            </Badge>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-[#013765]/65">{user.email}</p>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium uppercase tracking-wide text-[#013765]/55 md:hidden">
                          Rol
                        </label>
                        <Select
                          value={String(user.role_id)}
                          onValueChange={(value) => handleUserRoleChange(user.id, Number(value))}
                          disabled={isSaving || isCurrentUser}
                        >
                          <SelectTrigger className="bg-white">
                            <SelectValue placeholder="Selecciona un rol" />
                          </SelectTrigger>
                          <SelectContent>
                            {roles.map((role) => (
                              <SelectItem key={role.id} value={String(role.id)}>
                                {role.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <span className="text-[11px] text-[#013765]/60">
                          {isCurrentUser
                            ? "No editable desde aqui"
                            : hasRoleChanges
                            ? "Cambio pendiente"
                            : isSaved
                              ? "Rol actualizado"
                              : ""}
                        </span>
                        <Button
                          className="bg-[#013765] text-white hover:bg-[#024a8a]"
                          onClick={() => handleSaveUserRole(user.id)}
                          disabled={isSaving || !hasRoleChanges || isCurrentUser}
                        >
                          {isSaving ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Guardando...
                            </>
                          ) : (
                            "Guardar"
                          )}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="rounded-xl border border-dashed border-[#013765]/20 bg-[#013765]/[0.03] px-4 py-3 text-xs text-[#013765]/70">
              Los cambios de rol impactan en accesos a configuracion, flujos y operacion. Tu propio usuario queda
              bloqueado para evitar que te quites permisos por error.
            </div>
          </CardContent>
        </Card>

        <Card className="order-1 border-[#dbe5ef] bg-white">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-[#013765]">Configuracion general</CardTitle>
                <CardDescription className="text-[#013765]/70">
                  Preferencias base del sistema que afectan el comportamiento global.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[#013765]">Zona horaria</label>
                <Popover open={timezoneOpen} onOpenChange={setTimezoneOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={timezoneOpen}
                      className="w-full justify-between border-[#dbe5ef] text-sm font-normal text-[#013765] hover:bg-transparent"
                    >
                      <span className="truncate">
                        {timezoneOptions.find((option) => option.value === timezone)?.label ??
                          "Selecciona una zona horaria"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar zona horaria..." className="h-9" />
                      <CommandList>
                        <CommandEmpty>No se encontraron zonas horarias.</CommandEmpty>
                        <CommandGroup>
                          {timezoneOptions.map((option) => (
                            <CommandItem
                              key={option.value}
                              value={`${option.label} ${option.value}`}
                              onSelect={() => {
                                setTimezone(option.value)
                                setTimezoneOpen(false)
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  timezone === option.value ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <span className="truncate">{option.label}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-[#013765]/60">
                  Define la referencia horaria usada en mensajes, turnos y automatizaciones.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[#013765]">Idioma</label>
                <div className="rounded-xl border border-dashed border-[#013765]/20 bg-[#013765]/[0.03] px-4 py-3">
                  <p className="text-sm font-medium text-[#013765]">Español</p>
                  <p className="mt-1 text-xs text-[#013765]/65">
                    Es el unico idioma descargado y disponible en este momento.
                  </p>
                </div>
                <p className="text-xs text-[#013765]/60">
                  Marca el idioma principal para textos del sistema y experiencia del operador.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dbe5ef] pt-4">
              <div className="text-xs text-[#013765]/70">
                {hasUnsavedGeneralChanges
                  ? "Hay cambios sin guardar en la configuracion general."
                  : generalSaved
                    ? "Configuracion general guardada."
                    : "Sin cambios pendientes."}
              </div>
              <Button
                className="bg-[#013765] text-white hover:bg-[#024a8a]"
                onClick={handleSaveGeneral}
                disabled={savingGeneral || !hasUnsavedGeneralChanges}
              >
                {savingGeneral ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  "Guardar configuracion general"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="order-3 border-[#dbe5ef] bg-white">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-[#013765]">Bot</CardTitle>
                <CardDescription className="text-[#013765]/70">
                  Define el flujo principal y como debe cerrarse una conversacion que queda pendiente.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[#013765]">Flujo por defecto</label>
                <Select
                  value={defaultFlowId ? String(defaultFlowId) : undefined}
                  onValueChange={(value) => setDefaultFlowId(Number(value))}
                  disabled={botFlows.length === 0}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Selecciona un flujo activo" />
                  </SelectTrigger>
                  <SelectContent>
                    {botFlows.map((flow) => (
                      <SelectItem key={flow.id} value={String(flow.id)}>
                        {flow.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-[#013765]/60">
                  Es el flujo que se usa para iniciar nuevas conversaciones y para reiniciar chats vencidos.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[#013765]">Tiempo de inactividad (minutos)</label>
                <Input
                  type="number"
                  min={1}
                  max={10080}
                  value={inactivityTimeoutMinutes}
                  onChange={(e) => setInactivityTimeoutMinutes(e.target.value)}
                  placeholder="1440"
                />
                <p className="text-xs text-[#013765]/60">
                  Si el usuario deja el flujo a medias y supera este tiempo, el bot reinicia la conversacion.
                </p>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-sm font-medium text-[#013765]">Mensaje por inactividad</label>
                <Textarea
                  rows={4}
                  value={inactivityTimeoutMessage}
                  onChange={(e) => setInactivityTimeoutMessage(e.target.value)}
                  placeholder="La conversacion se cerro por inactividad. Si queres continuar, escribinos nuevamente."
                />
                <p className="text-xs text-[#013765]/60">
                  Este texto se envia cuando el sistema detecta que el flujo pendiente vencio por inactividad.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dbe5ef] pt-4">
              <div className="text-xs text-[#013765]/70">
                {hasUnsavedBotChanges
                  ? "Hay cambios sin guardar en la configuracion del bot."
                  : botSaved
                    ? "Configuracion del bot guardada."
                    : "Sin cambios pendientes."}
              </div>
              <Button
                className="bg-[#013765] text-white hover:bg-[#024a8a]"
                onClick={handleSaveBot}
                disabled={savingBot || !hasUnsavedBotChanges || !defaultFlowId}
              >
                {savingBot ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  "Guardar configuracion del bot"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="order-2 border-[#dbe5ef] bg-white">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-[#013765]">Canales e integraciones</CardTitle>
                <CardDescription className="text-[#013765]/70">
                  Credenciales y parametros de los servicios externos conectados al sistema.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-2xl border border-[#dbe5ef] p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#013765]">WhatsApp</h3>
                  <p className="text-xs text-[#013765]/65">
                    Datos necesarios para operar el canal y validar el webhook.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-sm font-medium text-[#013765]">Token</label>
                  <Input
                    value={whatsappToken}
                    onChange={(e) => setWhatsappToken(e.target.value)}
                    placeholder="Token de acceso de WhatsApp"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-[#013765]">Phone Number ID</label>
                  <Input
                    value={whatsappPhoneNumberId}
                    onChange={(e) => setWhatsappPhoneNumberId(e.target.value)}
                    placeholder="Ej: 123456789012345"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-[#013765]">Webhook verify token</label>
                  <Input
                    value={whatsappVerifyToken}
                    onChange={(e) => setWhatsappVerifyToken(e.target.value)}
                    placeholder="Token de verificacion del webhook"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#dbe5ef] p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#013765]">Alephoo</h3>
                  <p className="text-xs text-[#013765]/65">
                    Configuracion del sistema central y endpoints permitidos para el bot.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-sm font-medium text-[#013765]">Base URL</label>
                  <Input
                    value={alephooBaseUrl}
                    onChange={(e) => setAlephooBaseUrl(e.target.value)}
                    placeholder="Ej: http://172.22.118.103/apiturnos/public/api/v1"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-[#013765]">API key</label>
                  <Input
                    value={alephooApiKey}
                    onChange={(e) => setAlephooApiKey(e.target.value)}
                    placeholder="Clave de acceso a Alephoo"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-[#013765]">Timeout (segundos)</label>
                  <Input
                    type="number"
                    min={1}
                    max={300}
                    value={alephooTimeout}
                    onChange={(e) => setAlephooTimeout(e.target.value)}
                    placeholder="30"
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-sm font-medium text-[#013765]">Endpoints habilitados</label>
                  <Textarea
                    rows={5}
                    value={alephooEndpoints}
                    onChange={(e) => setAlephooEndpoints(e.target.value)}
                    placeholder={"/personas/{dni}\n/obrasocial\n/planes/{id}"}
                  />
                  <p className="text-xs text-[#013765]/60">
                    Ingresa un endpoint por linea para dejar documentado y controlado lo que puede usar el sistema.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dbe5ef] pt-4">
              <div className="text-xs text-[#013765]/70">
                {hasUnsavedIntegrationsChanges
                  ? "Hay cambios sin guardar en canales e integraciones."
                  : integrationsSaved
                    ? "Canales e integraciones guardados."
                    : "Sin cambios pendientes."}
              </div>
              <Button
                className="bg-[#013765] text-white hover:bg-[#024a8a]"
                onClick={handleSaveIntegrations}
                disabled={savingIntegrations || !hasUnsavedIntegrationsChanges}
              >
                {savingIntegrations ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  "Guardar canales e integraciones"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Exportar configuracion</DialogTitle>
            <DialogDescription>
              Esta exportacion genera un JSON listo para respaldar o mover la configuracion a otra instancia.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm text-slate-700">
            <div className="rounded-xl border border-[#dbe5ef] bg-slate-50 p-4">
              <p className="font-medium text-[#013765]">Incluye</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                <li>Configuracion global del sistema</li>
                <li>Flujos del bot y todos sus nodos</li>
              </ul>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="font-medium text-amber-900">No incluye</p>
              <ul className="mt-2 space-y-1 text-sm text-amber-800">
                <li>Usuarios, chats, mensajes, contactos y logs</li>
                <li>Historial de auditoria</li>
                <li>Estado de conversaciones activas</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
              Cancelar
            </Button>
            <Button className="bg-[#013765] text-white hover:bg-[#024a8a]" onClick={handleExportConfig} disabled={exportingConfig}>
              {exportingConfig ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Exportando...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Confirmar exportacion
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open)
          if (!open) {
            setImportError("")
            setImportFile(null)
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Importar configuracion</DialogTitle>
            <DialogDescription>
              Carga un JSON exportado desde este modulo para reaplicar configuracion global y flujos del bot.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm text-slate-700">
            <div className="rounded-xl border border-[#dbe5ef] bg-slate-50 p-4">
              <p className="font-medium text-[#013765]">Como funciona</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                <li>Sobrescribe configuraciones globales de configuracion</li>
                <li>Recrea los nodos de los flujos importados y recompone sus enlaces internos</li>
              </ul>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="font-medium text-amber-900">Importante</p>
              <p className="mt-2 text-sm text-amber-800">
                Si un flujo importado tiene el mismo nombre que uno existente, su estructura se reemplaza. Conviene hacerlo
                fuera de conversaciones activas.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[#013765]">Archivo JSON exportado</label>
              <Input
                type="file"
                accept=".json,application/json"
                className="bg-white"
                onChange={(e) => {
                  setImportError("")
                  setImportFile(e.target.files?.[0] ?? null)
                }}
              />
              <p className="text-xs text-slate-500">
                Solo se admiten archivos generados por la opcion de exportacion de este panel.
              </p>
            </div>

            {importError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {importError}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="bg-[#013765] text-white hover:bg-[#024a8a]"
              onClick={handleImportConfig}
              disabled={importingConfig || !importFile}
            >
              {importingConfig ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Confirmar importacion
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
