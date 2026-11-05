<?php

/*
 * Mensajes por defecto de los nodos del bot, por tipo de nodo.
 *
 * Es la única fuente de verdad: el backend los usa cuando el nodo no tiene el mensaje
 * guardado (o lo tiene vacío) y el panel de flujos los muestra como valor inicial,
 * de modo que lo que ve el operador es exactamente lo que recibe el paciente.
 */

return [
    'input' => [
        'error_message' => 'Valor inválido, por favor revisá el formato e intentá de nuevo.',
        // Respuestas de botones/lista que no coinciden con ninguna opción.
        'invalid_option_message' => 'Elegí una opción válida.',
    ],

    'person_lookup' => [
        'not_found_message' => 'No encontramos datos personales para el DNI ingresado.',
        'error_message' => 'No pudimos consultar tus datos en este momento.',
    ],

    'person_create' => [
        'already_exists_message' => 'Ya existe un paciente registrado con ese DNI.',
        'invalid_message' => 'No pudimos registrar al paciente porque algunos datos no son validos.',
        'error_message' => 'No pudimos registrar al paciente en este momento.',
    ],

    'appointment_lookup' => [
        'invalid_message' => 'Selecciona el boton Cancelar del turno que quieras cancelar.',
        'not_found_message' => 'No encontramos turnos pendientes próximos.',
        'error_message' => 'No pudimos consultar tus turnos en este momento.',
    ],

    'appointment_create' => [
        'unavailable_message' => 'Es posible que alguno de los datos, como la edad, la obra social u otros requisitos de la especialidad, no coincida con los parámetros necesarios para otorgar el turno.',
        'error_message' => 'No pudimos confirmar el turno en este momento.',
    ],

    'appointment_cancel' => [
        'unavailable_message' => 'El turno ya no esta disponible o fue cancelado anteriormente.',
        'error_message' => 'No pudimos cancelar el turno en este momento.',
    ],

    'health_insurance_select' => [
        'empty_message' => 'No encontramos obras sociales disponibles.',
        'invalid_message' => 'Elegi una obra social de la lista.',
        'error_message' => 'No pudimos consultar las obras sociales en este momento.',
    ],

    'health_insurance_plan_select' => [
        'empty_message' => 'No encontramos planes disponibles para esa obra social.',
        'invalid_message' => 'Elegi un plan de la lista.',
        'error_message' => 'No pudimos consultar los planes en este momento.',
    ],

    'specialty_search' => [
        'empty_message' => 'No encontramos especialidades que coincidan. Proba con otra palabra.',
        'invalid_message' => 'Elegi una especialidad de la lista.',
        'error_message' => 'No pudimos consultar las especialidades en este momento.',
    ],

    'doctor_select' => [
        'empty_message' => 'No encontramos profesionales disponibles para esa especialidad.',
        'invalid_message' => 'Elegi un profesional de la lista.',
        'error_message' => 'No pudimos consultar los profesionales en este momento.',
    ],

    'availability_select' => [
        'empty_message' => 'No encontramos turnos disponibles para ese profesional.',
        'invalid_message' => 'Elegi una fecha y horario de la lista.',
        'error_message' => 'No pudimos consultar los turnos en este momento.',
    ],
];
