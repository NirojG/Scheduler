<?php
declare(strict_types=1);
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$private = getenv('SCHEDULER_PRIVATE_DIR') ?: '/home/ghantior/scheduler-private';
try {
    require $private . '/app.php';
    run_api();
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    $status = $error instanceof InvalidArgumentException ? 400 : 503;
    if ($error instanceof RuntimeException && $error->getCode() >= 400 && $error->getCode() <= 499) $status = $error->getCode();
    http_response_code($status);
    if ($status >= 500) error_log('Scheduler request failed: ' . get_class($error));
    echo json_encode(['error' => $status < 500 ? $error->getMessage() : 'The service is unavailable. Please check the private hosting configuration or try again shortly.']);
}
