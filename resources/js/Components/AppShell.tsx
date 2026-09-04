import type { FormEvent, ReactNode } from "react"

import { useForm, usePage } from "@inertiajs/react"
import { Button } from "shadcn/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "shadcn/components/ui/dialog"
import { Input } from "shadcn/components/ui/input"
import { SidebarInset, SidebarProvider } from "shadcn/components/ui/sidebar"
import { ArrowLeft, KeyRound, Loader2, ShieldCheck } from "lucide-react"

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
  const page = usePage<{ auth?: { user?: { requestsPassword?: boolean } | null } }>()
  const mustChangePassword = Boolean(page.props.auth?.user?.requestsPassword)
  const passwordForm = useForm({ current_password: "", password: "", password_confirmation: "" })

  const changePassword = (event: FormEvent) => {
    event.preventDefault()
    passwordForm.put(route("password.update"), {
      preserveScroll: true,
      onSuccess: () => passwordForm.reset(),
    })
  }

  return (
    <SidebarProvider defaultOpen={false}>
      <div className="min-h-screen bg-[#f4f8fb]">
        <AppSidebar currentPath={currentPath} />

        <SidebarInset className="bg-[#f4f8fb]">
          <div className={fullHeight ? "flex h-screen flex-col overflow-hidden" : "min-h-screen"}>
            <header className="sticky top-0 z-30 border-b border-[#dbe5ef] bg-[#013765] shadow-sm">
              <div className="flex h-20 items-center justify-between gap-4 px-4 lg:px-6">
                <div className="flex min-w-0 items-center gap-3">
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

      <Dialog open={mustChangePassword} onOpenChange={() => undefined}>
        <DialogContent
          hideClose
          className="max-w-md overflow-hidden border-0 p-0"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div className="bg-[#013765] px-6 py-5 text-white">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-white">Protege tu cuenta</DialogTitle>
              <DialogDescription className="text-white/75">
                Estás usando una contraseña provisoria. Cámbiala antes de comenzar a operar en el sistema.
              </DialogDescription>
            </DialogHeader>
          </div>

          <form onSubmit={changePassword} className="space-y-4 px-6 pb-6">
            <div className="space-y-1.5">
              <label htmlFor="forced-current-password" className="text-sm font-medium text-[#013765]">Contraseña provisoria</label>
              <Input id="forced-current-password" type="password" autoComplete="current-password" autoFocus value={passwordForm.data.current_password} onChange={(event) => passwordForm.setData("current_password", event.target.value)} />
              {passwordForm.errors.current_password ? <p className="text-xs text-red-600">{passwordForm.errors.current_password}</p> : null}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="forced-new-password" className="text-sm font-medium text-[#013765]">Nueva contraseña</label>
              <Input id="forced-new-password" type="password" autoComplete="new-password" value={passwordForm.data.password} onChange={(event) => passwordForm.setData("password", event.target.value)} />
              {passwordForm.errors.password ? <p className="text-xs text-red-600">{passwordForm.errors.password}</p> : null}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="forced-password-confirmation" className="text-sm font-medium text-[#013765]">Confirmar nueva contraseña</label>
              <Input id="forced-password-confirmation" type="password" autoComplete="new-password" value={passwordForm.data.password_confirmation} onChange={(event) => passwordForm.setData("password_confirmation", event.target.value)} />
              {passwordForm.errors.password_confirmation ? <p className="text-xs text-red-600">{passwordForm.errors.password_confirmation}</p> : null}
            </div>

            <DialogFooter>
              <Button type="submit" disabled={passwordForm.processing} className="w-full bg-[#013765] text-white hover:bg-[#024a8a]">
                {passwordForm.processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                Guardar nueva contraseña
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
