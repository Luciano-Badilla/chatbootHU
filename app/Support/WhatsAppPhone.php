<?php

namespace App\Support;

/**
 * Un mismo número de WhatsApp puede estar guardado con formatos distintos: con 549 (celular argentino),
 * con 54 (sin el 9, como lo envía el módulo) o solo con área y número (sin código de país).
 */
class WhatsAppPhone
{
    /**
     * Forma canónica que usa el envío: solo dígitos y, para Argentina, 54 sin el 9 de celular.
     * Un número con "+" (o 00) ya trae su código de país, así que no se le antepone 54.
     * Un número sin código de país (área + número de 10 dígitos) se trata como argentino.
     */
    public static function canonical(string $raw): string
    {
        $trimmed = trim($raw);
        $digits = preg_replace('/\D+/', '', $trimmed) ?? '';
        $international = str_starts_with($trimmed, '+') || str_starts_with($digits, '00');

        if (str_starts_with($digits, '00')) {
            $digits = substr($digits, 2);
        }

        if (! $international && ! str_starts_with($digits, '54') && strlen($digits) === 10) {
            $digits = '54'.$digits;
        }

        if (str_starts_with($digits, '549')) {
            $digits = '54'.substr($digits, 3);
        }

        return $digits;
    }

    /** Un número de WhatsApp en forma canónica: sin cero inicial y entre 8 y 15 dígitos (estándar E.164). */
    public static function isValid(string $canonical): bool
    {
        return preg_match('/^[1-9]\d{7,14}$/', $canonical) === 1;
    }

    /**
     * Formas en las que Meta puede traer el mismo número argentino: con 549 (celular) o con 54 (sin el 9).
     * El número se toma tal cual llega, sin agregar código de país.
     */
    public static function aliases(string $raw): array
    {
        $digits = preg_replace('/\D+/', '', $raw) ?? '';
        $aliases = [$digits];

        if (str_starts_with($digits, '549')) {
            $aliases[] = '54'.substr($digits, 3);
        } elseif (str_starts_with($digits, '54')) {
            $aliases[] = '549'.substr($digits, 2);
        }

        return array_values(array_unique(array_filter($aliases)));
    }

    /** Todas las formas con las que puede estar guardado el mismo número argentino. */
    public static function variants(string $canonical): array
    {
        if (! str_starts_with($canonical, '54')) {
            return [$canonical];
        }

        $local = substr($canonical, 2);

        return array_values(array_unique([$canonical, '549'.$local, $local]));
    }
}
