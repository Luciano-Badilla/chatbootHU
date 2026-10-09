"use client"

type StartupCurtainProps = {
  visible: boolean
  leaving?: boolean
  logoSrc: string
  title?: string
  subtitle?: string
  error?: string
}

export default function StartupCurtain({
  visible,
  leaving = false,
  logoSrc,
  title = "HUni Chat",
  subtitle = "Preparando tu conversación",
  error,
}: StartupCurtainProps) {
  if (!visible) return null

  return (
    <div
      aria-live="polite"
      aria-label="Cargando"
      style={{ transitionDuration: "850ms" }}
      className={`fixed inset-0 z-[10050] grid place-items-center overflow-hidden bg-[#003f73] px-6 text-white transition-all ease-in-out ${leaving ? "pointer-events-none -translate-y-full opacity-0" : "translate-y-0 opacity-100"}`}
    >
      <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full border-[34px] border-white/[0.07]" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full border-[42px] border-white/[0.06]" />
      <div className="relative flex flex-col items-center text-center">
        <div className="relative grid h-24 w-24 place-items-center rounded-[28px] bg-white p-4 shadow-2xl shadow-slate-950/25">
          <span className="absolute inset-0 rounded-[28px] border-2 border-white/70 animate-ping" />
          <img src={logoSrc} alt="" className="relative h-full w-full rounded-2xl object-contain" />
        </div>
        <p className="mt-6 text-lg font-bold tracking-tight">{title}</p>
        <p className="mt-1 max-w-sm text-sm leading-6 text-white/75">{error ? "Conectando…" : subtitle}</p>
        <span className="mt-6 h-1.5 w-28 overflow-hidden rounded-full bg-white/20">
          <span className="block h-full w-1/2 animate-pulse rounded-full bg-white" />
        </span>
      </div>
    </div>
  )
}
