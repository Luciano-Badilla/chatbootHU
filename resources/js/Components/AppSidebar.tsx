import { usePage } from "@inertiajs/react"
import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Contact,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquare,
  MessageSquareText,
  Settings,
  ShieldCheck,
  UserCircle2,
} from "lucide-react"

import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "shadcn/components/ui/sidebar"
import { cn } from "shadcn/lib/utils"

const APP_URL = import.meta.env.VITE_APP_URL || ""
const HOSPITAL_LOGO_URL = `${APP_URL}/storage/images/hu_icon_new.png`
const HOSPITAL_FAVICON_URL = `${APP_URL}/favicon-48x48.png`

const navigationItems: Array<{ label: string; href: string; icon: LucideIcon; permission?: string }> = [
  { label: "Inicio", href: `${APP_URL}/dashboard`, icon: LayoutDashboard },
  { label: "Mensajes", href: `${APP_URL}/chat-panel`, icon: MessageSquare },
  { label: "Respuestas rapidas", href: `${APP_URL}/quick-replies-panel`, icon: MessageSquareText },
  { label: "Agenda", href: `${APP_URL}/agenda-panel`, icon: Contact },
  { label: "Campañas", href: `${APP_URL}/campaigns-panel`, icon: Megaphone, permission: "can_manage_campaigns" },
  { label: "Flujos", href: `${APP_URL}/bot/flows`, icon: GitBranch },
  { label: "Configuracion", href: `${APP_URL}/settings-panel`, icon: Settings },
  { label: "Auditoria", href: `${APP_URL}/audit-panel`, icon: ShieldCheck },
]

function navigateTo(href: string) {
  window.location.href = href
}

export function AppSidebar({ currentPath = "/dashboard" }: { currentPath?: string }) {
  const { props } = usePage<{
    auth?: {
      user?: {
        name?: string | null
        email?: string | null
        role_label?: string | null
        role_name?: string | null
      } | null
      permissions?: Record<string, boolean>
    }
  }>()
  const { open, isMobile, setOpen, setOpenMobile } = useSidebar()
  const compact = !open && !isMobile
  const user = props.auth?.user
  const permissions = props.auth?.permissions ?? {}
  const userName = user?.name?.trim() || "Usuario"
  const userRole = user?.role_label?.trim() || user?.role_name?.trim() || "Usuario"

  return (
    <Sidebar
      collapsible="icon"
      className="bg-[#013765] text-white"
      onMouseEnter={() => {
        if (!isMobile) {
          setOpen(true)
        }
      }}
      onMouseLeave={() => {
        if (!isMobile) {
          setOpen(false)
        }
      }}
    >
      <SidebarHeader className="h-20 border-b border-white/10 bg-[#013765] p-0">
        <div
          className={cn(
            "flex h-full w-full items-center gap-3 border-b border-white/10 bg-white/10 px-4 text-white shadow-sm backdrop-blur-sm",
            compact ? "justify-center px-2.5" : "justify-center",
          )}
        >
          {compact ? (
            <button
              type="button"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white p-0.5 transition hover:scale-[1.02]"
              onClick={() => {
                navigateTo(`${APP_URL}/dashboard`)
                setOpenMobile(false)
              }}
            >
              <img src={HOSPITAL_FAVICON_URL} alt="Hospital favicon" className="h-full w-full object-contain" />
            </button>
          ) : (
            <button
              type="button"
              className="flex h-16 w-full shrink-0 items-center justify-center rounded-xl bg-white shadow-sm transition hover:scale-[1.01]"
              onClick={() => {
                navigateTo(`${APP_URL}/dashboard`)
                setOpenMobile(false)
              }}
            >
              <img src={HOSPITAL_LOGO_URL} alt="Hospital logo" className="h-full w-full object-contain" />
            </button>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="bg-[#013765] text-white">
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.filter((item) => !item.permission || permissions[item.permission]).map((item) => {
                const Icon = item.icon
                const isActive = currentPath === item.href.replace(APP_URL, "")

                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => {
                        navigateTo(item.href)
                        setOpenMobile(false)
                      }}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!compact ? <span>{item.label}</span> : null}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        
      </SidebarContent>

      <SidebarFooter className="bg-[#013765]">
        <div
          className={cn(
            "rounded-xl border border-white/10 bg-white/10 p-3 text-white shadow-sm backdrop-blur-sm",
            compact && "px-2.5 py-3",
          )}
        >
          {!compact ? (
            <div className={cn("flex items-center gap-3", compact && "justify-center")}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
                <UserCircle2 className="h-5 w-5" />
              </div>
              {!compact ? (
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{userName}</p>
                  <p className="truncate text-xs text-white/70">{userRole}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <Button
            variant="outline"
            className={cn(
              "mt-3 w-full justify-start border-white/20 bg-white text-[#013765] hover:bg-slate-100",
              compact && "mt-0 justify-center px-0",
            )}
            onClick={() => {
              navigateTo(`${APP_URL}/logout`)
              setOpenMobile(false)
            }}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!compact ? (
              <>
                <span className="ml-2">Cerrar sesion</span>
              </>
            ) : null}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
