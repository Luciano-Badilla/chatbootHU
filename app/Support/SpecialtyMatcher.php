<?php

namespace App\Support;

use Illuminate\Support\Str;

/**
 * Matches the different ways people may refer to a medical specialty.
 */
class SpecialtyMatcher
{
    private const STOP_WORDS = [
        'buenas', 'buenos', 'como', 'consulta', 'consultar', 'con', 'de', 'del', 'dia', 'dias',
        'doctor', 'doctora', 'doctores', 'especialidad', 'especialidades', 'favor',
        'hola', 'la', 'las', 'los', 'medica', 'medico', 'necesito', 'para', 'pedir', 'quiero',
        'sacar', 'turno', 'turnos', 'una', 'uno', 'ver',
    ];

    public static function normalize(string $value): string
    {
        $value = mb_strtolower(self::ascii($value));
        $tokens = preg_split('/[^a-z0-9]+/u', $value, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $tokens = array_map(fn (string $token) => self::normalizeToken($token), $tokens);

        return implode(' ', $tokens);
    }

    public static function matches(string $query, string $specialty): bool
    {
        $query = mb_strtolower(self::ascii($query));
        $candidateTokens = self::meaningfulTokens($specialty);
        if ($query === '' || $candidateTokens === []) {
            return false;
        }

        // A message can mention more than one specialty, e.g. "traumatologo o cardiologo".
        $clauses = preg_split('/\b(?:o|u|y)\b|[,;\/]+/u', $query, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        foreach ($clauses as $clause) {
            foreach (self::meaningfulTokens($clause) as $queryToken) {
                foreach ($candidateTokens as $candidateToken) {
                    if (self::tokensMatch($queryToken, $candidateToken)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    private static function meaningfulTokens(string $value): array
    {
        $tokens = preg_split('/[^a-z0-9]+/u', mb_strtolower(self::ascii($value)), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $stopWords = array_flip(self::STOP_WORDS);

        return array_values(array_filter(
            array_map(fn (string $token) => self::normalizeToken($token), $tokens),
            fn (string $token) => mb_strlen($token) >= 3 && ! isset($stopWords[$token]),
        ));
    }

    private static function normalizeToken(string $token): string
    {
        // Unifica nombres de áreas en -logía con el profesional en -ólogo/-óloga:
        // cardiología/cardiólogo -> cardiolog, traumatología/traumatólogo -> traumatolog.
        return preg_replace('/olog(?:ia|ias|o|os|a|as)$/u', 'olog', $token) ?? $token;
    }

    private static function ascii(string $value): string
    {
        // Some iconv transliterators emit apostrophes for accented vowels.
        return str_replace(["'", '’', '`', '´'], '', Str::ascii(trim($value)));
    }

    private static function tokensMatch(string $query, string $candidate): bool
    {
        if ($query === $candidate) {
            return true;
        }

        $shorterLength = min(mb_strlen($query), mb_strlen($candidate));
        if ($shorterLength >= 4 && (
            str_starts_with($query, $candidate)
            || str_starts_with($candidate, $query)
            || str_contains($query, $candidate)
            || str_contains($candidate, $query)
        )) {
            return true;
        }

        // Tolerate small spelling/gender variations such as "pediatra"/"pediatría"
        // and a one-character typo, without accepting broadly unrelated words.
        $distance = levenshtein($query, $candidate);
        $maximumDistance = $shorterLength >= 12 ? 2 : 1;

        return $shorterLength >= 6 && $distance <= $maximumDistance;
    }
}
