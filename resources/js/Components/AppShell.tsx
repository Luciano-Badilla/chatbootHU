import type { ReactNode } from "react"

import { Button } from "shadcn/components/ui/button"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "shadcn/components/ui/sidebar"
import { ArrowLeft } from "lucide-react"

import { AppSidebar } from "./AppSidebar"

type AppShellProps = {
  currentPath: string
  title: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
  leading?: ReactNode
  contentClassName?: string
  fullHeight?: boolean
}

export function AppShell({
  currentPath,
  title,
  subtitle,
  children,
  actions,
  leading,
  contentClassName = "px-4 py-4 lg:px-6 lg:py-6",
  fullHeight = false,
}: AppShellProps) {
  return (
    <SidebarProvider defaultOpen={false}>
      <div className="min-h-screen bg-[#f4f8fb]">
        <AppSidebar currentPath={currentPath} />

        <SidebarInset className="bg-[#f4f8fb]">
          <div className={fullHeight ? "flex h-screen flex-col overflow-hidden" : "min-h-screen"}>
            <header className="sticky top-0 z-30 border-b border-[#dbe5ef] bg-[#013765] shadow-sm">
              <div className="flex h-20 items-center justify-between gap-4 px-4 lg:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <SidebarTrigger className="shrink-0 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" />
                  {leading}
                  <div className="min-w-0">
                    <h1 className="truncate text-xl font-semibold text-white">{title}</h1>
                    {subtitle ? <p className="truncate text-sm text-white/75">{subtitle}</p> : null}
                  </div>
                </div>

                {actions ? <div className="hidden items-center gap-2 md:flex">{actions}</div> : null}
              </div>
            </header>

            <main className={fullHeight ? `flex-1 min-h-0 ${contentClassName}` : contentClassName}>{children}</main>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

export function AppShellBackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="icon"
      className="h-9 w-9 rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
      onClick={onClick}
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
  )
}
