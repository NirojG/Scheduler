<?php
function app_link($path) { global $config; return rtrim($config['app_url'],'/') . $path; }
function mail_enabled() {
    global $config;
    if (($config['mail_mode'] ?? '')==='test') return PHP_SAPI==='cli' || (PHP_SAPI==='cli-server' && !empty($config['allow_loopback_http']));
    return !empty($config['smtp_host']) && !empty($config['smtp_user']) && !empty($config['smtp_password']) && !empty($config['mail_from']);
}
function queue_email($recipient,$subject,$body,$meeting=null) {
    if (!mail_enabled()) return;
    query('INSERT INTO scheduler_outbox(id,meeting,recipient,subject,body) VALUES(?,?,?,?,?)',[identifier(),$meeting,$recipient,str_replace(["\r","\n"],' ',$subject),$body]);
}
function deliver_email($row) {
    global $config;
    if (($config['mail_mode'] ?? '')==='test') {
        if (!mail_enabled()) throw new RuntimeException('Test email is available only in local development.');
        file_put_contents($config['test_mail_file'],json_encode($row)."\n",FILE_APPEND|LOCK_EX);
        return;
    }
    require_once __DIR__.'/vendor/PHPMailer/Exception.php';
    require_once __DIR__.'/vendor/PHPMailer/SMTP.php';
    require_once __DIR__.'/vendor/PHPMailer/PHPMailer.php';
    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    $mail->isSMTP();
    $mail->Host=$config['smtp_host'];
    $mail->Port=(int)$config['smtp_port'];
    $mail->SMTPSecure=$config['smtp_encryption'];
    $mail->SMTPAuth=true;
    $mail->Username=$config['smtp_user'];
    $mail->Password=$config['smtp_password'];
    $mail->Timeout=20;
    $mail->CharSet='UTF-8';
    $mail->setFrom($config['mail_from'],$config['mail_name'] ?? 'Scheduler');
    $mail->addAddress($row['recipient']);
    $mail->Subject=$row['subject'];
    $mail->Body=$row['body'];
    $mail->MessageID='<'.$row['id'].'@'.parse_url($config['app_url'],PHP_URL_HOST).'>';
    $mail->send();
}
function process_outbox() {
    if (!mail_enabled()) return 0;
    if (!(int)query("SELECT GET_LOCK('scheduler_mail_worker',0)")->fetchColumn()) return 0;
    $sent=0;
    try {
        // Interrupted SMTP deliveries need inspection, because the server may have accepted them.
        query("UPDATE scheduler_outbox SET status='uncertain',last_error='Worker interrupted during delivery' WHERE status='sending'");
        $rows=query("SELECT * FROM scheduler_outbox WHERE status='pending' AND next_attempt<=? ORDER BY created_at LIMIT 25",[time()])->fetchAll();
        foreach ($rows as $row) {
            query("UPDATE scheduler_outbox SET status='sending',attempts=attempts+1 WHERE id=?",[$row['id']]);
            try {
                deliver_email($row);
                query("UPDATE scheduler_outbox SET status='sent',body='',last_error=NULL WHERE id=?",[$row['id']]);
                $sent++;
            } catch (Throwable $error) {
                // Avoid automatically duplicating email after an ambiguous SMTP failure.
                query("UPDATE scheduler_outbox SET status='failed',last_error='SMTP delivery failed; inspect private server logs before retrying' WHERE id=?",[$row['id']]);
                error_log('Scheduler mail delivery failed for queue item '.$row['id']);
            }
        }
        query('DELETE FROM scheduler_limits WHERE expires_at<?',[time()]);
        query('DELETE FROM scheduler_tokens WHERE expires_at<?',[time()]);
    } finally { query("SELECT RELEASE_LOCK('scheduler_mail_worker')"); }
    return $sent;
}
