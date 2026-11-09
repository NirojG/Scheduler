<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__.'/app.php';
echo 'Messages sent: '.process_outbox().PHP_EOL;
