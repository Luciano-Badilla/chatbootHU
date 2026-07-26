<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'mailgun' => [
        'domain' => env('MAILGUN_DOMAIN'),
        'secret' => env('MAILGUN_SECRET'),
        'endpoint' => env('MAILGUN_ENDPOINT', 'api.mailgun.net'),
        'scheme' => 'https',
    ],

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'alephoo_v3' => [
        'base_url' => env('ALEPHOO_V3_BASE_URL', 'https://universitario.alephoo.com/api/v3'),
        'username' => env('ALEPHOO_V3_USERNAME'),
        'password' => env('ALEPHOO_V3_PASSWORD'),
        'timeout' => env('ALEPHOO_V3_TIMEOUT', 30),
        'timezone' => env('ALEPHOO_V3_TIMEZONE', 'America/Argentina/Buenos_Aires'),
    ],

    'alephoo_cancel' => [
        'key' => env('ALEPHOO_CANCEL_KEY', env('TURNO_KEY')),
        'iv' => env('ALEPHOO_CANCEL_IV', env('TURNO_IV')),
    ],

];
