<?php

namespace App\Http\Controllers;

use App\Models\AgendaContact;
use Illuminate\Http\Request;
use Inertia\Inertia;

class AgendaContactController extends Controller
{
    public function index()
    {
        return Inertia::render('AgendaPanel');
    }

    public function apiIndex(Request $request)
    {
        $query = trim((string) $request->query('q', ''));
        $includeTrashed = filter_var($request->query('trashed', false), FILTER_VALIDATE_BOOLEAN);

        $contacts = AgendaContact::query()
            ->when($includeTrashed, fn ($builder) => $builder->onlyTrashed())
            ->when($query !== '', function ($builder) use ($query) {
                $normalizedPhone = preg_replace('/\D+/', '', $query);
                $builder->where(function ($nested) use ($query, $normalizedPhone) {
                    $nested
                        ->where('formatted_name', 'like', "%{$query}%")
                        ->orWhere('first_name', 'like', "%{$query}%")
                        ->orWhere('last_name', 'like', "%{$query}%")
                        ->orWhere('organization', 'like', "%{$query}%")
                        ->orWhere('title', 'like', "%{$query}%");

                    if ($normalizedPhone !== '') {
                        $nested->orWhere('phone', 'like', "%{$normalizedPhone}%");
                    }
                });
            })
            ->orderBy('formatted_name')
            ->limit(200)
            ->get();

        return response()->json(['contacts' => $contacts]);
    }

    public function store(Request $request)
    {
        $data = $this->validatedData($request);
        $contact = AgendaContact::create($data);

        return response()->json(['contact' => $contact], 201);
    }

    public function update(Request $request, AgendaContact $agendaContact)
    {
        $agendaContact->update($this->validatedData($request, $agendaContact->id));

        return response()->json(['contact' => $agendaContact->refresh()]);
    }

    public function destroy(AgendaContact $agendaContact)
    {
        $agendaContact->delete();

        return response()->json(['ok' => true]);
    }

    public function restore(int $id)
    {
        $contact = AgendaContact::onlyTrashed()->findOrFail($id);
        $contact->restore();

        return response()->json(['contact' => $contact->refresh()]);
    }

    public function forceDestroy(int $id)
    {
        $contact = AgendaContact::onlyTrashed()->findOrFail($id);
        $contact->forceDelete();

        return response()->json(['ok' => true]);
    }

    private function validatedData(Request $request, ?int $currentId = null): array
    {
        $data = $request->validate([
            'first_name' => ['nullable', 'string', 'max:80'],
            'last_name' => ['nullable', 'string', 'max:80'],
            'formatted_name' => ['nullable', 'string', 'max:160'],
            'phone' => ['required', 'string', 'max:32'],
            'organization' => ['nullable', 'string', 'max:120'],
            'title' => ['nullable', 'string', 'max:120'],
        ]);

        $firstName = trim((string) ($data['first_name'] ?? ''));
        $lastName = trim((string) ($data['last_name'] ?? ''));
        $formattedName = trim((string) ($data['formatted_name'] ?? ''));

        if ($formattedName === '') {
            $formattedName = trim($firstName . ' ' . $lastName);
        }

        $phone = preg_replace('/[^\d+]/', '', (string) $data['phone']);

        $exists = AgendaContact::withTrashed()
            ->where('phone', $phone)
            ->when($currentId, fn ($query) => $query->where('id', '!=', $currentId))
            ->exists();

        if ($exists) {
            abort(response()->json([
                'message' => 'Ya existe un contacto en la agenda con ese teléfono.',
            ], 422));
        }

        return [
            'first_name' => $firstName !== '' ? $firstName : null,
            'last_name' => $lastName !== '' ? $lastName : null,
            'formatted_name' => $formattedName !== '' ? $formattedName : 'Contacto',
            'phone' => $phone,
            'organization' => trim((string) ($data['organization'] ?? '')) ?: null,
            'title' => trim((string) ($data['title'] ?? '')) ?: null,
        ];
    }
}
