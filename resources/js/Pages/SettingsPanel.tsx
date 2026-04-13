import { useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  Bot,
  CalendarDays,
  Check,
  ChevronsUpDown,
  Loader2,
  MessageSquare,
  Shield,
  UserCog,
  Workflow,
} from "lucide-react"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "shadcn/components/ui/command"
import { Input } from "shadcn/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "shadcn/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "shadcn/components/ui/select"
import { Textarea } from "shadcn/components/ui/textarea"
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
  }
  timezoneOptions?: Array<{
    value: string
    label: string
  }>
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ""

const sections = [
  {
    title: "Canales e integraciones",
    description: "WhatsApp, Alephoo y cualquier integracion externa que use el sistema.",
    icon: MessageSquare,
    status: "Pendiente",
  },
  {
    title: "Bot",
    description: "Parametros globales del bot, flujos por defecto y comportamiento general.",
    icon: Bot,
    status: "Pendiente",
  },
  {
    title: "Turnos",
    description: "Reglas de negocio, habilitaciones y opciones del circuito de turnos.",
    icon: CalendarDays,
    status: "Pendiente",
  },
  {
    title: "Usuarios y permisos",
    description: "Roles, accesos y limites operativos dentro del sistema.",
    icon: UserCog,
    status: "Pendiente",
  },
  {
    title: "Auditoria y seguridad",
    description: "Trazabilidad de cambios, logs y resguardo de datos sensibles.",
    icon: Shield,
    status: "Pendiente",
  },
]

export default function SettingsPanel({ settings, timezoneOptions = [] }: SettingsPanelProps) {
  const initialTimezone = settings?.general?.timezone ?? "America/Argentina/Buenos_Aires"
  const initialLanguage = settings?.general?.language ?? "es"
  const initialWhatsappToken = settings?.integrations?.whatsapp?.token ?? ""
  const initialWhatsappPhoneNumberId = settings?.integrations?.whatsapp?.phone_number_id ?? ""
  const initialWhatsappVerifyToken = settings?.integrations?.whatsapp?.webhook_verify_token ?? ""
  const initialAlephooBaseUrl = settings?.integrations?.alephoo?.base_url ?? ""
  const initialAlephooApiKey = settings?.integrations?.alephoo?.api_key ?? ""
  const initialAlephooTimeout = settings?.integrations?.alephoo?.timeout ?? "30"
  const initialAlephooEndpoints = settings?.integrations?.alephoo?.enabled_endpoints ?? ""

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
  const [savingGeneral, setSavingGeneral] = useState(false)
  const [generalSaved, setGeneralSaved] = useState(false)
  const [savingIntegrations, setSavingIntegrations] = useState(false)
  const [integrationsSaved, setIntegrationsSaved] = useState(false)
  const [timezoneOpen, setTimezoneOpen] = useState(false)

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
  }, [initialTimezone, initialLanguage])

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
        console.error("Error guardando configuracion general", await res.text())
        return
      }

      setSavedTimezone(timezone)
      setSavedLanguage(language)
      setGeneralSaved(true)
    } catch (err) {
      console.error("Error de red guardando configuracion general:", err)
    } finally {
      setSavingGeneral(false)
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
        console.error("Error guardando integraciones", await res.text())
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
    } catch (err) {
      console.error("Error de red guardando integraciones:", err)
    } finally {
      setSavingIntegrations(false)
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

          <Badge className="border border-white/20 bg-white/10 text-white hover:bg-white/10">
            Funcional
          </Badge>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-6 py-8">
        <Card className="border-[#dbe5ef] bg-white">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#013765]/10 text-[#013765]">
                <Workflow className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-[#013765]">Estructura inicial del modulo</CardTitle>
                <CardDescription className="text-[#013765]/70">
                  Esta pantalla ya guarda configuracion real y nos permite seguir ampliando el modulo por bloques.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Card className="border-[#dbe5ef] bg-white">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-[#013765]">Configuracion general</CardTitle>
                <CardDescription className="text-[#013765]/70">
                  Preferencias base del sistema que afectan el comportamiento global.
                </CardDescription>
              </div>
              <Badge variant="secondary" className="bg-[#013765]/10 text-[#013765]">
                Primer bloque
              </Badge>
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

        <Card className="border-[#dbe5ef] bg-white">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-[#013765]">Canales e integraciones</CardTitle>
                <CardDescription className="text-[#013765]/70">
                  Credenciales y parametros de los servicios externos conectados al sistema.
                </CardDescription>
              </div>
              <Badge variant="secondary" className="bg-[#013765]/10 text-[#013765]">
                Segundo bloque
              </Badge>
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => {
            const Icon = section.icon

            return (
              <Card key={section.title} className="border-[#dbe5ef] bg-white">
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#013765]/10 text-[#013765]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                      {section.status}
                    </Badge>
                  </div>
                  <div>
                    <CardTitle className="text-base text-[#013765]">{section.title}</CardTitle>
                    <CardDescription className="mt-1 text-sm text-[#013765]/70">
                      {section.description}
                    </CardDescription>
                  </div>
                </CardHeader>
              </Card>
            )
          })}
        </div>
      </main>
    </div>
  )
}
