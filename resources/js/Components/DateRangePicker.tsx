import { useEffect, useState, type ReactNode } from "react"
import type { DateRange } from "react-day-picker"
import { es } from "date-fns/locale"

import { Button } from "shadcn/components/ui/button"
import { Calendar } from "shadcn/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "shadcn/components/ui/popover"

// Fechas en formato local Y-m-d, que es lo que espera el servidor.
export function isoFromDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

export function dateFromIso(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

export function formatIsoDay(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" }).format(dateFromIso(value))
}

// Formato corto para campos: 31/10/2026.
export function formatNumericDay(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(dateFromIso(value))
}

type DateRangePickerProps = {
  trigger: ReactNode
  value?: DateRange
  onApply: (range: DateRange) => void
  // Si se pasa, el botón principal restablece cuando no hay un rango completo.
  onReset?: () => void
  resetEnabled?: boolean
  align?: "start" | "end"
  formatDay?: (value: string) => string
}

export function DateRangePicker({
  trigger,
  value,
  onApply,
  onReset,
  resetEnabled = false,
  align = "end",
  formatDay = formatIsoDay,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>(value)

  // Se compara por valor: el padre suele pasar un objeto nuevo en cada render.
  useEffect(() => {
    setDraft(value)
  }, [value?.from?.getTime(), value?.to?.getTime()])

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const complete = Boolean(draft?.from && draft?.to)
  const selectionLabel = draft?.from
    ? `${formatDay(isoFromDate(draft.from))}${draft.to ? ` – ${formatDay(isoFromDate(draft.to))}` : " – Elegí el fin"}`
    : "Elegí inicio y fin"

  const apply = () => {
    if (draft?.from && draft.to) {
      onApply({ from: draft.from, to: draft.to })
      setOpen(false)
    }
  }

  const reset = () => {
    onReset?.()
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setDraft(value)
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        className="z-[10000] w-[min(92vw,300px)] rounded-xl border-slate-200 bg-white p-2 text-slate-900 shadow-lg"
      >
        <div className="px-2 pt-1 text-xs text-slate-500">{selectionLabel}</div>
        <Calendar
          mode="range"
          selected={draft}
          onSelect={setDraft}
          locale={es}
          defaultMonth={draft?.from ?? today}
          disabled={{ after: today }}
          min={0}
          numberOfMonths={1}
          showOutsideDays={false}
          initialFocus
          className="p-1"
          classNames={{
            month: "space-y-2",
            caption: "relative flex h-8 items-center justify-center",
            caption_label: "text-xs font-semibold capitalize text-[#013765]",
            nav: "flex items-center gap-1",
            nav_button: "inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white p-0 text-slate-500 transition hover:bg-[#f4f8fb] hover:text-[#013765]",
            nav_button_previous: "absolute left-0",
            nav_button_next: "absolute right-0",
            head_cell: "w-8 rounded-md text-[10px] font-medium capitalize text-slate-400",
            row: "mt-1 flex w-full",
            day: "h-7 w-8 rounded-md bg-transparent p-0 text-xs font-normal text-slate-700 transition hover:bg-[#eaf2f8]",
            day_selected: "!bg-[#013765] hover:!bg-[#024a8a] focus:!bg-[#024a8a]",
            day_range_start: "day-range-start !text-white",
            day_range_end: "day-range-end !text-white",
            day_range_middle: "!bg-[#eaf2f8] !text-[#013765] aria-selected:opacity-100",
            day_outside: "text-slate-300 opacity-50",
            day_disabled: "!bg-transparent text-slate-300 opacity-50",
          }}
        />
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-1 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mr-auto h-8 rounded-lg px-2 text-xs text-slate-500 shadow-none hover:bg-[#f4f8fb] hover:text-[#013765]"
            disabled={!draft?.from && !resetEnabled}
            onClick={() => setDraft(undefined)}
          >
            Limpiar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg border-slate-200 bg-white text-xs text-[#013765] shadow-none hover:bg-[#f4f8fb] hover:text-[#013765]"
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          {onReset ? (
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg bg-[#185e9c] text-xs text-white shadow-none hover:bg-[#013765] disabled:bg-slate-100 disabled:text-slate-400"
              disabled={complete ? false : draft?.from ? true : !resetEnabled}
              onClick={complete ? apply : reset}
            >
              {complete ? "Aplicar" : "Restablecer"}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg bg-[#185e9c] text-xs text-white shadow-none hover:bg-[#013765] disabled:bg-slate-100 disabled:text-slate-400"
              disabled={!complete}
              onClick={apply}
            >
              Aplicar
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
