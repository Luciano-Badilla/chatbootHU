<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class LocationController extends Controller
{
    public function webchatSearch(Request $request)
    {
        $data = $request->validate([
            'q' => ['required', 'string', 'min:3', 'max:255'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:8'],
        ]);

        $params = [
            'q' => $data['q'],
            'limit' => $data['limit'] ?? 6,
        ];
        $cacheKey = 'webchat.location.photon.' . md5(json_encode($params));

        try {
            $features = Cache::remember($cacheKey, now()->addDay(), function () use ($params) {
                $response = Http::timeout(8)
                    ->acceptJson()
                    ->get('https://photon.komoot.io/api', $params);

                if (!$response->ok()) {
                    throw new \RuntimeException('Photon search failed with status ' . $response->status());
                }

                return $response->json('features', []);
            });

            $results = collect($features)->map(function ($feature, $index) {
                $properties = $feature['properties'] ?? [];
                $coordinates = $feature['geometry']['coordinates'] ?? [];
                $longitude = $coordinates[0] ?? null;
                $latitude = $coordinates[1] ?? null;

                $name = trim((string) ($properties['name'] ?? $properties['street'] ?? $properties['city'] ?? 'Ubicación'));
                $address = collect([
                    $properties['street'] ?? null,
                    $properties['housenumber'] ?? null,
                    $properties['district'] ?? null,
                    $properties['city'] ?? null,
                    $properties['state'] ?? null,
                    $properties['country'] ?? null,
                ])->filter(fn ($part) => filled($part))->implode(', ');

                return [
                    'id' => (string) ($properties['osm_id'] ?? $index) . '-' . $latitude . '-' . $longitude,
                    'latitude' => is_numeric($latitude) ? (float) $latitude : null,
                    'longitude' => is_numeric($longitude) ? (float) $longitude : null,
                    'name' => $name,
                    'address' => $address ?: $name,
                ];
            })->filter(fn ($result) => is_numeric($result['latitude']) && is_numeric($result['longitude']))->values();

            return response()->json(['ok' => true, 'data' => $results]);
        } catch (\Throwable $e) {
            Log::warning('Photon webchat search failed', ['message' => $e->getMessage(), 'query' => $data['q']]);

            return response()->json([
                'ok' => false,
                'message' => 'No se pudo buscar la ubicación en este momento.',
            ], 503);
        }
    }

    public function search(Request $request)
    {
        $data = $request->validate([
            'q' => ['required', 'string', 'min:3', 'max:255'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:10'],
        ]);

        try {
            $params = [
                'format' => 'jsonv2',
                'addressdetails' => 1,
                'limit' => $data['limit'] ?? 6,
                'q' => $data['q'],
            ];
            $cacheKey = 'location.search.' . md5(json_encode($params));

            $results = Cache::remember($cacheKey, now()->addDay(), function () use ($params) {
                $response = $this->callNominatim('https://nominatim.openstreetmap.org/search', $params);

                if (!$response->ok()) {
                    throw new \RuntimeException('Nominatim search failed with status ' . $response->status());
                }

                return $response->json();
            });

            return response()->json([
                'ok' => true,
                'data' => $results,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Nominatim search failed', [
                'message' => $e->getMessage(),
                'query' => $data['q'],
            ]);

            return response()->json([
                'ok' => false,
                'message' => 'El buscador de direcciones esta temporalmente limitado. Proba de nuevo en unos segundos.',
            ], 429);
        }
    }

    public function reverse(Request $request)
    {
        $data = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lon' => ['required', 'numeric', 'between:-180,180'],
        ]);

        try {
            $params = [
                'format' => 'jsonv2',
                'lat' => round((float) $data['lat'], 6),
                'lon' => round((float) $data['lon'], 6),
            ];
            $cacheKey = 'location.reverse.' . md5(json_encode($params));

            $result = Cache::remember($cacheKey, now()->addDay(), function () use ($params) {
                $response = $this->callNominatim('https://nominatim.openstreetmap.org/reverse', $params);

                if (!$response->ok()) {
                    throw new \RuntimeException('Nominatim reverse failed with status ' . $response->status());
                }

                return $response->json();
            });

            return response()->json([
                'ok' => true,
                'data' => $result,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Nominatim reverse failed', [
                'message' => $e->getMessage(),
                'lat' => $data['lat'],
                'lon' => $data['lon'],
            ]);

            return response()->json([
                'ok' => false,
                'message' => 'No se pudo resolver la ubicacion en este momento.',
            ], 429);
        }
    }

    private function callNominatim(string $url, array $params)
    {
        $lastRequestAt = (float) Cache::get('location.nominatim.last_request_at', 0);
        $elapsedMicroseconds = (microtime(true) - $lastRequestAt) * 1000000;
        $minimumGapMicroseconds = 1200000;

        if ($elapsedMicroseconds > 0 && $elapsedMicroseconds < $minimumGapMicroseconds) {
            usleep((int) ($minimumGapMicroseconds - $elapsedMicroseconds));
        }

        $response = $this->nominatim()->get($url, $params);
        Cache::put('location.nominatim.last_request_at', microtime(true), now()->addMinute());

        return $response;
    }

    private function nominatim()
    {
        $appUrl = config('app.url');

        return Http::timeout(8)
            ->acceptJson()
            ->withHeaders([
                'User-Agent' => 'chatbot-location-search/1.0 (' . $appUrl . ')',
                'Referer' => $appUrl,
            ]);
    }
}
