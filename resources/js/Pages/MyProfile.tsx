import { useForm } from "@inertiajs/react"
import type { FormEvent, ReactNode } from "react"
import { UserCircle2 } from "lucide-react"
import { toast } from "sonner"

import { AppShell } from "../Components/AppShell"
import { Badge } from "shadcn/components/ui/badge"
import { Button } from "shadcn/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"
import { Input } from "shadcn/components/ui/input"

type ProfileData = {
  name: string
  email: string
  role: string
  created_at: string | null
}

function formatDate(value: string | null) {
  if (!value) return "—"
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-500">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  )
}

export default function MyProfile({ profile }: { profile: ProfileData }) {
  const dataForm = useForm({ email: profile.email })
  const passwordForm = useForm({ current_password: "", password: "", password_confirmation: "" })

  const saveData = (event: FormEvent) => {
    event.preventDefault()
    dataForm.patch(route("profile.update"), {
      preserveScroll: true,
      onSuccess: () => toast.success("Datos actualizados"),
    })
  }

  const savePassword = (event: FormEvent) => {
    event.preventDefault()
    passwordForm.put(route("password.update"), {
      preserveScroll: true,
      onSuccess: () => {
        passwordForm.reset()
        toast.success("Contraseña actualizada")
      },
    })
  }

  return (
    <AppShell
      currentPath="/profile"
      title="Mi perfil"
      subtitle="Tus datos de acceso y tu contraseña."
      contentClassName="px-4 py-4 lg:px-6 lg:py-6"
    >
      <div className="mx-auto max-w-5xl">
        <Card>
          <CardHeader>
            <CardTitle>Mi cuenta</CardTitle>
            <CardDescription>Tu email es el que usás para entrar al sistema.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="flex flex-wrap items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#013765]">
                <UserCircle2 className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{profile.name}</p>
                <p className="truncate text-xs text-slate-500">{profile.email}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="bg-[#013765]/10 text-[#013765] hover:bg-[#013765]/10">
                  {profile.role}
                </Badge>
                <Badge variant="outline">Cuenta desde {formatDate(profile.created_at)}</Badge>
              </div>
            </section>

            <section className="space-y-4 border-t border-slate-100 pt-6">
              <div>
                <h3 className="text-sm font-semibold text-[#013765]">Datos de acceso</h3>
                <p className="mt-1 text-xs text-slate-500">Cambiá el email con el que entrás al sistema.</p>
              </div>

              <form onSubmit={saveData} className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field id="profile-name" label="Nombre" hint="El nombre lo cambia un administrador.">
                    <Input id="profile-name" value={profile.name} readOnly disabled className="bg-slate-50" />
                  </Field>

                  <Field id="profile-email" label="Email" error={dataForm.errors.email}>
                    <Input
                      id="profile-email"
                      type="email"
                      autoComplete="email"
                      value={dataForm.data.email}
                      onChange={(event) => dataForm.setData("email", event.target.value)}
                    />
                  </Field>
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={dataForm.processing || !dataForm.isDirty}
                    className="bg-[#013765] text-white hover:bg-[#012e54]"
                  >
                    Guardar datos
                  </Button>
                </div>
              </form>
            </section>

            <section className="space-y-4 border-t border-slate-100 pt-6">
              <div>
                <h3 className="text-sm font-semibold text-[#013765]">Contraseña</h3>
                <p className="mt-1 text-xs text-slate-500">Para cambiarla necesitás la contraseña actual.</p>
              </div>

              <form onSubmit={savePassword} className="space-y-4">
                <Field id="profile-current-password" label="Contraseña actual" error={passwordForm.errors.current_password}>
                  <Input
                    id="profile-current-password"
                    type="password"
                    autoComplete="current-password"
                    value={passwordForm.data.current_password}
                    onChange={(event) => passwordForm.setData("current_password", event.target.value)}
                  />
                </Field>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field id="profile-new-password" label="Nueva contraseña" error={passwordForm.errors.password}>
                    <Input
                      id="profile-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={passwordForm.data.password}
                      onChange={(event) => passwordForm.setData("password", event.target.value)}
                    />
                  </Field>

                  <Field id="profile-password-confirmation" label="Confirmar nueva contraseña">
                    <Input
                      id="profile-password-confirmation"
                      type="password"
                      autoComplete="new-password"
                      value={passwordForm.data.password_confirmation}
                      onChange={(event) => passwordForm.setData("password_confirmation", event.target.value)}
                    />
                  </Field>
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={passwordForm.processing}
                    className="bg-[#013765] text-white hover:bg-[#012e54]"
                  >
                    Cambiar contraseña
                  </Button>
                </div>
              </form>
            </section>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
