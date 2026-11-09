<?php
$path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);
if ($path==='/api.php') { require __DIR__.'/../public/api.php'; return true; }
if (in_array($path,['/app.js','/style.css'],true)) return false;
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
header('Referrer-Policy: no-referrer');
readfile(__DIR__.'/../public/index.html');
