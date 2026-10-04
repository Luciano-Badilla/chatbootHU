<?php

header('Content-Type: application/json');

echo json_encode([
    'pid' => getmypid(),
    'app_env' => getenv('APP_ENV') ?: null,
    'db_username' => getenv('DB_USERNAME') ?: null,
    'db_database' => getenv('DB_DATABASE') ?: null,
]);
