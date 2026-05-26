import { useEffect } from 'react';
import Checkbox from '@/Components/Checkbox';
import GuestLayout from '@/Layouts/GuestLayout';
import InputError from '@/Components/InputError';
import InputLabel from '@/Components/InputLabel';
import PrimaryButton from '@/Components/PrimaryButton';
import TextInput from '@/Components/TextInput';
import { Head, Link, useForm } from '@inertiajs/react';
import { route } from 'ziggy-js';

export default function Login({ status, canResetPassword }) {
    const { data, setData, post, processing, errors, reset } = useForm({
        email: '',
        password: '',
        remember: false,
    });

    useEffect(() => {
        return () => {
            reset('password');
        };
    }, []);

    const submit = (e) => {
        e.preventDefault();
        post(route('login'));
    };

    return (
        <GuestLayout>
            <Head title="Iniciar sesion" />
            <div className="border-b border-[#dbe5ef] bg-[#013765] px-6 py-5 text-white">
                <h1 className="text-2xl font-semibold">Iniciar sesion</h1>
            </div>

            <div className="px-6 py-6">
                {status && (
                    <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        {status}
                    </div>
                )}

                <form onSubmit={submit} className="space-y-5">
                    <div>
                        <InputLabel htmlFor="email" value="Correo electronico" />

                        <TextInput
                            id="email"
                            type="email"
                            name="email"
                            value={data.email}
                            className="mt-2 block h-11 w-full border border-[#dbe5ef] bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#2b5f90] focus:ring-[#2b5f90]"
                            autoComplete="username"
                            isFocused={true}
                            placeholder="tu.usuario@empresa.com"
                            onChange={(e) => setData('email', e.target.value)}
                        />

                        <InputError message={errors.email} className="mt-2" />
                    </div>

                    <div>
                        <InputLabel htmlFor="password" value="Contrasena" />

                        <TextInput
                            id="password"
                            type="password"
                            name="password"
                            value={data.password}
                            className="mt-2 block h-11 w-full border border-[#dbe5ef] bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#2b5f90] focus:ring-[#2b5f90]"
                            autoComplete="current-password"
                            placeholder="Ingresa tu contrasena"
                            onChange={(e) => setData('password', e.target.value)}
                        />

                        <InputError message={errors.password} className="mt-2" />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                        <label className="flex items-center">
                            <Checkbox
                                name="remember"
                                checked={data.remember}
                                onChange={(e) => setData('remember', e.target.checked)}
                            />
                            <span className="ms-2 text-sm text-slate-600">Recordarme</span>
                        </label>

                        {canResetPassword && (
                            <Link
                                href={route('password.request')}
                                className="text-sm font-medium text-[#013765] transition hover:text-[#024a8a]"
                            >
                                Olvide mi contrasena
                            </Link>
                        )}
                    </div>

                    <div className="pt-2">
                        <PrimaryButton
                            className="flex h-11 w-full items-center justify-center rounded-xl bg-[#013765] text-sm font-semibold normal-case tracking-normal hover:bg-[#024a8a] focus:bg-[#024a8a] active:bg-[#012e54]"
                            disabled={processing}
                        >
                            {processing ? 'Ingresando...' : 'Iniciar sesion'}
                        </PrimaryButton>
                    </div>
                </form>
            </div>
        </GuestLayout>
    );
}

