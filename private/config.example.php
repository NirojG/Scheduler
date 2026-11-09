<?php
// Place this directory outside every public document root.
return [
    'dsn' => 'mysql:host=localhost;dbname=YOUR_CPANEL_DATABASE;charset=utf8mb4',
    'db_user' => 'YOUR_CPANEL_DATABASE_USER',
    'db_password' => '',
    'app_url' => 'https://YOUR_SCHEDULER_DOMAIN',
    'allow_loopback_http' => false,
    'mail_mode' => 'smtp',
    'smtp_host' => '',
    'smtp_port' => 465,
    'smtp_encryption' => 'ssl', // ssl on 465, tls on 587
    'smtp_user' => '',
    'smtp_password' => '',
    'mail_from' => '',
    'mail_name' => 'Scheduler',
];
