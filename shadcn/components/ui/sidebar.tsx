import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"

import { cn } from "shadcn/lib/utils"

type SidebarContextValue = {
  isMobile: boolean
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  openMobile: boolean
  setOpenMobile: React.Dispatch<React.SetStateAction<boolean>>
  state: "expanded" | "collapsed"
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

const SIDEBAR_WIDTH = "17rem"
const SIDEBAR_WIDTH_ICON = "4.5rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const MOBILE_BREAKPOINT = 1024

function useMobileBreakpoint() {
  const [isMobile, setIsMobile] = React.useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < MOBILE_BREAKPOINT,
  )

  React.useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)

    update()
    window.addEventListener("resize", update)

    return () => window.removeEventListener("resize", update)
  }, [])

  return isMobile
}

export function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  style,
  className,
  children,
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useMobileBreakpoint()
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const [openMobile, setOpenMobile] = React.useState(false)

  const open = openProp ?? internalOpen
  const setOpen = React.useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (value) => {
      const nextOpen = typeof value === "function" ? value(open) : value

      if (onOpenChange) {
        onOpenChange(nextOpen)
        return
      }

      setInternalOpen(nextOpen)
    },
    [onOpenChange, open],
  )

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((current) => !current)
      return
    }

    setOpen((current) => !current)
  }, [isMobile, setOpen])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b"

      if (!isShortcut) {
        return
      }

      event.preventDefault()
      toggleSidebar()
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  const value = React.useMemo<SidebarContextValue>(
    () => ({
      isMobile,
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      state: open ? "expanded" : "collapsed",
      toggleSidebar,
    }),
    [isMobile, open, setOpen, openMobile, toggleSidebar],
  )

  return (
    <SidebarContext.Provider value={value}>
      <div
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            "--sidebar-width-mobile": SIDEBAR_WIDTH_MOBILE,
            ...style,
          } as React.CSSProperties
        }
        className={cn("min-h-screen w-full", className)}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const context = React.useContext(SidebarContext)

  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

export function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "icon",
  className,
  children,
  ...props
}: React.ComponentProps<"aside"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}) {
  const { isMobile, open, openMobile, setOpenMobile, state } = useSidebar()
  const isLeft = side === "left"
  const desktopWidth =
    collapsible === "none" ? "var(--sidebar-width)" : open ? "var(--sidebar-width)" : "var(--sidebar-width-icon)"

  if (isMobile) {
    return (
      <>
        <div
          className={cn(
            "fixed inset-0 z-40 bg-slate-950/40 transition-opacity duration-200 lg:hidden",
            openMobile ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={() => setOpenMobile(false)}
        />
        <aside
          data-mobile="true"
          className={cn(
            "fixed top-0 z-50 flex h-screen w-[var(--sidebar-width-mobile)] flex-col border-r border-slate-200 bg-white shadow-2xl transition-transform duration-200 ease-out lg:hidden",
            isLeft ? "left-0" : "right-0 border-l border-r-0",
            openMobile ? "translate-x-0" : isLeft ? "-translate-x-full" : "translate-x-full",
            className,
          )}
          {...props}
        >
          {children}
        </aside>
      </>
    )
  }

  const variantClassName =
    variant === "floating"
      ? "m-3 h-[calc(100vh-1.5rem)] rounded-xl border border-slate-200 shadow-xl"
      : variant === "inset"
        ? "border-r border-slate-200 bg-white"
        : "border-r border-slate-200 bg-white"

  return (
    <aside
      data-state={state}
      data-collapsible={collapsible}
      className={cn(
        "fixed top-0 z-30 hidden h-screen flex-col overflow-hidden transition-[width] duration-200 ease-out lg:flex",
        isLeft ? "left-0" : "right-0",
        variantClassName,
        className,
      )}
      style={{ width: desktopWidth }}
      {...props}
    >
      {children}
    </aside>
  )
}

export function SidebarInset({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { open, isMobile } = useSidebar()

  return (
    <div
      className={cn("min-h-screen transition-[padding] duration-200 ease-out", className)}
      {...props}
    >
      <div
        className="min-h-screen transition-[margin] duration-200 ease-out"
        style={{
          marginLeft: isMobile ? "0px" : open ? "var(--sidebar-width)" : "var(--sidebar-width-icon)",
        }}
      >
        {children}
      </div>
    </div>
  )
}

export function SidebarTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  const { open, toggleSidebar } = useSidebar()

  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900",
        className,
      )}
      onClick={toggleSidebar}
      {...props}
    >
      {children ?? (open ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />)}
      <span className="sr-only">Alternar sidebar</span>
    </button>
  )
}

export function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      type="button"
      aria-label="Alternar sidebar"
      className={cn(
        "absolute inset-y-0 -right-3 hidden w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:text-slate-900 lg:flex",
        className,
      )}
      onClick={toggleSidebar}
      {...props}
    >
      <div className="h-10 w-1.5 rounded-full bg-slate-200" />
    </button>
  )
}

export function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("border-b border-slate-200 p-3", className)} {...props} />
}

export function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("border-t border-slate-200 p-3", className)} {...props} />
}

export function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex-1 overflow-y-auto overflow-x-hidden p-3", className)} {...props} />
}

export function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mb-4", className)} {...props} />
}

export function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70", className)}
      {...props}
    />
  )
}

export function SidebarGroupContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("space-y-1", className)} {...props} />
}

export function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul className={cn("space-y-1", className)} {...props} />
}

export function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li className={cn("list-none", className)} {...props} />
}

export function SidebarMenuButton({
  asChild,
  isActive,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  isActive?: boolean
}) {
  const { open, isMobile } = useSidebar()
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-active={isActive ? "true" : "false"}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white",
        isActive && "bg-white text-[#013765] shadow-sm hover:bg-slate-100 hover:text-[#013765]",
        !open && !isMobile && "justify-center px-2.5",
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  )
}
