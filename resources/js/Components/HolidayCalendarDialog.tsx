import { useMemo, useState } from "react"
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "shadcn/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "shadcn/components/ui/dialog"
import { Input } from "shadcn/components/ui/input"
import { cn } from "shadcn/lib/utils"

export type Holiday = { id: number; date: string; name: string; source: "api" | "manual" }

interface HolidayCalendarDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  year: number
  onYearChange: (year: number) => void
  holidays: Holiday[]
  loading: boolean
  busy: boolean
  onAdd: (date: string, name: string) => Promise<boolean>
  onRemove: (holiday: Holiday) => Promise<void>
  onImport: () => Promise<void>
}

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

const pad = (value: number) => String(value).padStart(2, "0")
const toIsoDate = (year: number, monthIndex: number, day: number) => `${year}-${pad(monthIndex + 1)}-${pad(day)}`
const todayIso = () => {
  const now = new Date()
  return toIsoDate(now.getFullYear(), now.getMonth(), now.getDate())
}
const formatLongDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

export function HolidayCalendarDialog({
  open,
  onOpenChange,
  year,
  onYearChange,
  holidays,
  loading,
  busy,
  onAdd,
  onRemove,
  onImport,
}: HolidayCalendarDialogProps) {
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth())
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState("")
  const today = todayIso()

  const holidayByDate = useMemo(() => new Map(holidays.map((holiday) => [holiday.date, holiday])), [holidays])

  const cells = useMemo(() => {
    const offset = (new Date(year, viewMonth, 1).getDay() + 6) % 7 // la semana empieza en lunes
    const daysInMonth = new Date(year, viewMonth + 1, 0).getDate()
    const list: Array<number | null> = Array.from({ length: offset }, () => null)
    for (let day = 1; day <= daysInMonth; day++) list.push(day)
    while (list.length % 7 !== 0) list.push(null)
    return list
  }, [year, viewMonth])

  const monthTitle = new Date(year, viewMonth, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" })
  const selectedHoliday = selected ? holidayByDate.get(selected) ?? null : null

  const shiftMonth = (delta: number) => {
    let nextMonth = viewMonth + delta
    let nextYear = year
    if (nextMonth < 0) {
      nextMonth = 11
      nextYear -= 1
    } else if (nextMonth > 11) {
      nextMonth = 0
      nextYear += 1
    }
    setViewMonth(nextMonth)
    setSelected(null)
    setName("")
    if (nextYear !== year) onYearChange(nextYear)
  }

  const selectDay = (iso: string) => {
    setSelected(iso)
    setName("")
  }

  const handleAdd = async () => {
    if (!selected || !name.trim()) return
    const saved = await onAdd(selected, name.trim())
    if (saved) setName("")
  }

  const handleRemove = async () => {
    if (!selectedHoliday) return
    await onRemove(selectedHoliday)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#013765]">Calendario de feriados</DialogTitle>
          <DialogDescription>Tocá un día para ver si es feriado, quitarlo o agregarlo.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-[#013765]" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="text-sm font-semibold capitalize text-[#013765]">{monthTitle}</p>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-[#013765]" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative">
          <div className="grid grid-cols-7 gap-1 pb-1">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="text-center text-[11px] font-medium text-[#013765]/60">{label}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, index) => {
              if (day === null) return <span key={`blank-${index}`} />
              const iso = toIsoDate(year, viewMonth, day)
              const holiday = holidayByDate.get(iso)
              const isSelected = selected === iso
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => selectDay(iso)}
                  aria-label={holiday ? `${formatLongDate(iso)}: ${holiday.name}` : formatLongDate(iso)}
                  aria-pressed={isSelected}
                  className={cn(
                    "relative h-9 rounded-lg text-sm transition",
                    holiday ? "bg-rose-100 font-semibold text-rose-800" : "text-[#013765] hover:bg-[#013765]/[0.06]",
                    isSelected && "bg-[#013765] text-white hover:bg-[#024a8a]",
                    iso === today && !isSelected && "ring-1 ring-[#013765]",
                  )}
                >
                  {day}
                </button>
              )
            })}
          </div>
          {loading ? (
            <div className="absolute inset-0 grid place-items-center rounded-lg bg-white/60">
              <Loader2 className="h-5 w-5 animate-spin text-[#013765]" />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-4 text-[11px] text-[#013765]/70">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-300" /> Feriado</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full ring-1 ring-[#013765]" /> Hoy</span>
        </div>

        <div className="min-h-[7.5rem] rounded-xl border border-[#dbe5ef] bg-[#f8fafc] p-4">
          {!selected ? (
            <p className="text-sm text-[#013765]/70">Elegí un día del calendario.</p>
          ) : selectedHoliday ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-[#013765]">{selectedHoliday.name}</p>
                <p className="text-xs capitalize text-[#013765]/65">{formatLongDate(selected)}</p>
                <span className="mt-1 inline-block rounded-full border border-[#d5e1ec] bg-white px-2 py-0.5 text-[11px] font-medium text-[#013765]/75">
                  {selectedHoliday.source === "api" ? "Calendario" : "Manual"}
                </span>
              </div>
              <Button type="button" variant="outline" size="sm" className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800" onClick={handleRemove} disabled={busy}>
                <Trash2 className="h-4 w-4" /> Quitar feriado
              </Button>
              <p className="text-[11px] text-[#013765]/60">El bot lo tratará como día hábil. La carga automática no lo vuelve a agregar.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-[#013765]">No es feriado</p>
                <p className="text-xs capitalize text-[#013765]/65">{formatLongDate(selected)}</p>
              </div>
              <div className="flex gap-2">
                <Input value={name} maxLength={150} placeholder="Nombre del feriado" aria-label="Nombre del feriado" onChange={(e) => setName(e.target.value)} />
                <Button type="button" className="shrink-0 bg-[#013765] text-white hover:bg-[#024a8a]" onClick={handleAdd} disabled={busy || !name.trim()}>
                  Marcar
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#dbe5ef] pt-3">
          <Button type="button" variant="outline" size="sm" className="gap-2 border-[#cbd8e5] text-[#013765] hover:bg-[#013765]/[0.06]" onClick={onImport} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Cargar feriados de {year}
          </Button>
          <span className="flex items-center gap-1 text-[11px] text-[#013765]/60">
            <CalendarDays className="h-3.5 w-3.5" /> {holidays.length} en {year}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
