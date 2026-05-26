import { Link } from '@inertiajs/react';

export default function Guest({ children }) {
    const appUrl = import.meta.env.VITE_APP_URL || '';
    const hospitalLogoUrl = `${appUrl}/storage/images/hu_icon_new.png`;

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f4f8fb]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(1,55,101,0.18),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(43,95,144,0.14),_transparent_32%)]" />
            <div className="absolute inset-x-0 top-0 h-40 bg-[#013765]" />

            <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
                <div className="w-full max-w-md">
                    <div className="mb-6 flex flex-col items-center text-center">
                        <Link href="/" className="inline-flex">
                            <img
                                src={hospitalLogoUrl}
                                alt="Hospital Universitario"
                                className="h-20 w-auto object-contain"
                            />
                        </Link>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-[#dbe5ef] bg-white shadow-xl shadow-[#013765]/10">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
}
