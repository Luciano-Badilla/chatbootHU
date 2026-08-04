import { useEffect } from 'react';
import { Head, useForm } from '@inertiajs/react';
import { LockKeyhole, LogIn, UserRound } from 'lucide-react';
import { Button } from 'shadcn/components/ui/button';
import {
    Field,
    FieldError,
    FieldGroup,
    FieldLabel,
} from 'shadcn/components/ui/field';
import { Input } from 'shadcn/components/ui/input';
import { route } from 'ziggy-js';

export default function Login({ status }) {
    const publicUrl = import.meta.env.VITE_APP_URL?.replace(/\/$/, '') ?? '';
    const logoUrl = `${publicUrl}/images/hu_icon_new.png`;
    const loginImageUrl = `${publicUrl}/images/login_image.jpg`;

    const { data, setData, post, processing, errors, reset } = useForm({
        email: '',
        password: '',
    });
    const loginError = errors.email || errors.password;

    useEffect(() => {
        return () => {
            reset('password');
        };
    }, []);

    const submit = (event) => {
        event.preventDefault();
        post(route('login'));
    };

    return (
        <>
            <Head title="Iniciar sesión" />

            <main className="min-h-screen bg-white font-sans text-slate-950 lg:grid lg:grid-cols-2">
                <section className="flex min-h-screen items-center justify-center bg-[#06436f] px-6 py-10 text-white lg:px-12">
                    <div className="w-full max-w-md">
                        <div className="mb-10">
                            <img
                                src={logoUrl}
                                alt="Hospital Universitario"
                                className="h-auto w-[285px] brightness-0 invert sm:w-[300px]"
                            />
                        </div>

                        <div className="mb-8">
                            <h2 className="text-3xl font-bold tracking-tight">Inicia sesión</h2>
                            <div className="absolute top-0 left-0 right-0 p-12 text-white">
                                <span className="inline-flex rounded-full bg-white/90 px-4 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[#06436f]">
                                    Chatbot WhatsApp HU
                                </span>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-blue-100">
                                Accede con tus credenciales para administrar el sistema de turnos.
                            </p>
                        </div>

                        {status && (
                            <div className="mb-4 rounded-md border border-emerald-300/40 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                                {status}
                            </div>
                        )}

                        {loginError && (
                            <div className="mb-4 rounded-md border border-red-300/50 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                                {loginError}
                            </div>
                        )}

                        <form onSubmit={submit}>
                            <FieldGroup>
                                <Field>
                                    <FieldLabel htmlFor="email" className="text-white">
                                        Email
                                    </FieldLabel>
                                    <div className="relative">
                                        <UserRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                                        <Input
                                            id="email"
                                            type="email"
                                            name="email"
                                            value={data.email}
                                            autoComplete="username"
                                            autoFocus
                                            onChange={(event) => setData('email', event.target.value)}
                                            className="h-10 p-5 pl-12 text-sm bg-white text-black font-semibold"
                                            placeholder="Correo electrónico"
                                        />
                                    </div>
                                    <FieldError className="text-red-100">
                                        {errors.email}
                                    </FieldError>
                                </Field>

                                <Field>
                                    <FieldLabel htmlFor="password" className="text-white">
                                        Contraseña
                                    </FieldLabel>
                                    <div className="relative">
                                        <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                                        <Input
                                            id="password"
                                            type="password"
                                            name="password"
                                            value={data.password}
                                            autoComplete="current-password"
                                            onChange={(event) => setData('password', event.target.value)}
                                            className="h-10 p-5 pl-12 text-sm bg-white text-black font-semibold"
                                            placeholder="Ingresa tu contraseña"
                                        />
                                    </div>
                                    <FieldError className="text-red-100">{errors.password}</FieldError>
                                </Field>

                                <Field orientation="horizontal">
                                    <Button
                                        type="submit"
                                        disabled={processing}
                                        className="h-12 w-full bg-white px-4 text-sm font-bold text-[#06436f] shadow-sm hover:bg-slate-900 hover:text-white focus-visible:ring-4 focus-visible:ring-white/25 disabled:cursor-wait"
                                    >
                                        <LogIn className="h-4 w-4" />
                                        {processing ? 'Ingresando...' : 'Iniciar sesión'}
                                    </Button>
                                </Field>
                            </FieldGroup>
                        </form>
                    </div>
                </section>

                <section className="relative hidden min-h-screen overflow-hidden bg-slate-100 lg:block">
                    <img
                        src={loginImageUrl}
                        alt="Autogestión de turnos"
                        className="absolute inset-0 h-full w-full object-cover"
                    />
                    <div className="pointer-events-none absolute inset-0" />
                </section>
            </main>
        </>
    );
}
