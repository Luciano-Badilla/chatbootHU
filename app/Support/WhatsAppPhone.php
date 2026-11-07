<?php

namespace App\Support;

/**
 * Un mismo número de WhatsApp puede estar guardado con formatos distintos: con 549 (celular),
 * con 54 (sin el 9, como lo envía el módulo) o solo con área y número (sin código de país).
 */
class WhatsAppPhone
{
    /** Forma canónica: solo dígitos, con 54 y sin el 9 de celular. Es la misma que usa el envío. */
    public static function canonical(string $raw): string
    {
        $digits = preg_replace('/\D+/', '', trim($raw)) ?? '';

        if (str_starts_with($digits, '00')) {
            $digits = substr($digits, 2);
        }

        // Número argentino sin código de país: área + número (10 dígitos).
        if (! str_starts_with($digits, '54') && strlen($digits) === 10) {
            $digits = '54'.$digits;
        }

        if (str_starts_with($digits, '549')) {
            $digits = '54'.substr($digits, 3);
        }

        return $digits;
    }

    /** Todas las formas con las que puede estar guardado el mismo número. */
    public static function variants(string $canonical): array
    {
        if (! str_starts_with($canonical, '54')) {
            return [$canonical];
        }

        $local = substr($canonical, 2);

        return array_values(array_unique([$canonical, '549'.$local, $local]));
    }
}
