<?php
declare(strict_types=1);
$config = require __DIR__ . '/config.php';
$db = new PDO($config['dsn'], $config['db_user'], $config['db_password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
require_once __DIR__ . '/mail.php';

function query($sql, $values = []) {
    global $db;
    $statement = $db->prepare($sql);
    $statement->execute($values);
    return $statement;
}
function fail($message, $status = 400) { throw new RuntimeException($message, $status); }
function require_value($condition, $message) { if (!$condition) fail($message); }
function identifier() { return bin2hex(random_bytes(24)); }
function email_value($value) {
    require_value(is_string($value) && strlen($value) <= 254 && filter_var($value, FILTER_VALIDATE_EMAIL), 'Enter a valid email address.');
    return strtolower(trim($value));
}
function text_value($value, $max, $label, $required = true) {
    require_value(is_string($value) && strlen($value) <= $max && (!$required || trim($value) !== ''), 'Enter a valid ' . $label . '.');
    return trim($value);
}
function atomic($action) {
    global $db;
    $db->beginTransaction();
    try { $result = $action(); $db->commit(); return $result; }
    catch (Throwable $error) { $db->rollBack(); throw $error; }
}
function rate_limit($category, $limit, $seconds = 900) {
    $bucket = hash('sha256', $category . '|' . ($_SERVER['REMOTE_ADDR'] ?? 'cli') . '|' . floor(time() / $seconds));
    query('INSERT INTO scheduler_limits(bucket,hits,expires_at) VALUES(?,1,?) ON DUPLICATE KEY UPDATE hits=hits+1', [$bucket, time()+$seconds]);
    if ((int)query('SELECT hits FROM scheduler_limits WHERE bucket=?', [$bucket])->fetchColumn() > $limit) fail('Too many attempts. Please try again later.', 429);
}
function current_user() {
    if (empty($_SESSION['user'])) return null;
    $user = query('SELECT id,name,email,verified,session_version FROM scheduler_users WHERE id=?', [$_SESSION['user']])->fetch();
    if (!$user || (int)$user['session_version'] !== ($_SESSION['version'] ?? 0)) { unset($_SESSION['user']); return null; }
    unset($user['session_version']);
    $user['verified'] = (bool)$user['verified'];
    return $user;
}
function require_user() { $user = current_user(); if (!$user) fail('Please log in to continue.', 401); return $user; }
function log_in($user) {
    session_regenerate_id(true);
    $_SESSION['user'] = $user['id'];
    $_SESSION['version'] = (int)$user['session_version'];
    $_SESSION['csrf'] = identifier();
}
function account_token($user, $purpose) {
    $token = identifier();
    query('DELETE FROM scheduler_tokens WHERE user_id=? AND purpose=?', [$user['id'], $purpose]);
    query('INSERT INTO scheduler_tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,?,?)', [hash('sha256',$token), $user['id'], $purpose, time()+($purpose === 'reset' ? 3600 : 86400)]);
    return $token;
}
function account_email($user, $purpose) {
    $token = account_token($user, $purpose);
    $label = $purpose === 'reset' ? 'Reset your password' : 'Verify your email';
    queue_email($user['email'], $label . ' · Scheduler', 'Hello ' . $user['name'] . ",\n\n" . $label . ': ' . app_link('/' . $purpose . '#' . $purpose . '=' . $token) . "\n\nIf you did not request this, you can ignore this email.");
}
function meeting_record($id, $lock = false) {
    $row = query('SELECT * FROM scheduler_meetings WHERE id=?' . ($lock ? ' FOR UPDATE' : ''), [$id])->fetch();
    if (!$row) fail('This meeting could not be found.', 404);
    foreach (['start','end','duration','revision'] as $field) $row[$field] = (int)$row[$field];
    if ($row['scheduled_start'] !== null) $row['scheduled_start'] = (int)$row['scheduled_start'];
    $row['dates'] = json_decode($row['dates'], true);
    return $row;
}
function owns_meeting($meeting, $input = []) {
    $user = current_user();
    if ($user && $meeting['owner_id'] === $user['id']) return true;
    return !empty($meeting['organizer_secret']) && isset($input['organizerKey']) && is_string($input['organizerKey']) && hash_equals($meeting['organizer_secret'], hash('sha256', $input['organizerKey']));
}
function public_meeting($meeting) {
    $meeting['canOrganize'] = owns_meeting($meeting);
    $meeting['hasOrganizer'] = (bool)($meeting['owner_id'] || $meeting['organizer_secret']);
    unset($meeting['owner_id'], $meeting['organizer_secret'], $meeting['organizer_email']);
    $meeting['responses'] = query('SELECT id,name,slots FROM scheduler_responses WHERE meeting=? ORDER BY id', [$meeting['id']])->fetchAll();
    foreach ($meeting['responses'] as &$response) $response['slots'] = json_decode($response['slots'], true);
    $meeting['emailEnabled'] = mail_enabled();
    global $config;
    $meeting['emailPreview'] = ($config['mail_mode'] ?? '') === 'test';
    return $meeting;
}
function scheduled_text($meeting) {
    if (!$meeting['scheduled_date']) return 'The organizer has not confirmed a time yet.';
    return 'Scheduled for ' . $meeting['scheduled_date'] . ', ' . slot_time($meeting['scheduled_start']) . '–' . slot_time($meeting['scheduled_start']+$meeting['duration']) . ' (' . $meeting['zone'] . ').';
}
function slot_time($slot) { return sprintf('%02d:%02d', intdiv($slot,2), $slot % 2 ? 30 : 0); }
function run_api() {
    global $config;
    $local = PHP_SAPI === 'cli-server' && !empty($config['allow_loopback_http']) && in_array($_SERVER['REMOTE_ADDR'], ['127.0.0.1','::1'], true);
    if (($config['mail_mode'] ?? '') !== 'test') {
        require_value(strpos($config['app_url'] ?? '', 'https://') === 0, 'Set the public application URL to its HTTPS address.');
    }
    if (!$local && (empty($_SERVER['HTTPS']) || $_SERVER['HTTPS'] === 'off')) fail('Please use HTTPS.', 403);
    session_name('scheduler_session');
    ini_set('session.use_strict_mode','1');
    ini_set('session.use_only_cookies','1');
    session_set_cookie_params(['lifetime'=>0,'path'=>'/','secure'=>!$local,'httponly'=>true,'samesite'=>'Lax']);
    session_start();
    if (isset($_SESSION['last_seen']) && time()-$_SESSION['last_seen'] > 86400) $_SESSION = [];
    $_SESSION['last_seen'] = time();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = identifier();
    $method = $_SERVER['REQUEST_METHOD'];
    $path = $_GET['path'] ?? '';
    $input = [];
    if ($method === 'POST') {
        require_value(strpos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') === 0, 'JSON required.');
        $csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!hash_equals($_SESSION['csrf'],$csrf)) fail('Your session changed. Refresh this page and try again.',403);
        if (!empty($_SERVER['HTTP_ORIGIN']) && rtrim($_SERVER['HTTP_ORIGIN'],'/') !== rtrim($config['app_url'],'/')) fail('Origin rejected.',403);
        $raw = file_get_contents('php://input', false, null, 0, 50001);
        require_value(strlen($raw) <= 50000, 'Request too large.');
        $input = json_decode($raw,true);
        require_value(is_array($input), 'Invalid request.');
    }
    $result = route($method, $path, $input);
    echo json_encode($result, JSON_UNESCAPED_SLASHES);
}
function route($method, $path, $input) {
    if ($path === '/auth/session' && $method === 'GET') {
        global $config;
        return ['user'=>current_user(),'csrf'=>$_SESSION['csrf'],'emailEnabled'=>mail_enabled(),'emailPreview'=>($config['mail_mode'] ?? '') === 'test'];
    }
    if ($path === '/auth/register' && $method === 'POST') {
        rate_limit('register',10,3600);
        $email = email_value($input['email'] ?? null);
        $name = text_value($input['name'] ?? null,60,'name');
        $password = $input['password'] ?? '';
        require_value(is_string($password) && strlen($password)>=12 && strlen($password)<=72, 'Use a password of 12–72 characters.');
        if (query('SELECT id FROM scheduler_users WHERE email=?',[$email])->fetch()) fail('An account already uses this email. Log in or reset your password.');
        $id = identifier();
        atomic(function() use ($id,$name,$email,$password) {
            query('INSERT INTO scheduler_users(id,name,email,password_hash) VALUES(?,?,?,?)',[$id,$name,$email,password_hash($password,PASSWORD_DEFAULT)]);
            if (mail_enabled()) account_email(['id'=>$id,'name'=>$name,'email'=>$email],'verify');
        });
        log_in(query('SELECT * FROM scheduler_users WHERE id=?',[$id])->fetch());
        return ['user'=>current_user(),'csrf'=>$_SESSION['csrf'],'emailEnabled'=>mail_enabled()];
    }
    if ($path === '/auth/login' && $method === 'POST') {
        rate_limit('login',20);
        $email = email_value($input['email'] ?? null);
        $user = query('SELECT * FROM scheduler_users WHERE email=?',[$email])->fetch();
        $password = $input['password'] ?? '';
        require_value(is_string($password) && strlen($password)<=72, 'Invalid email or password.');
        $hash = $user ? $user['password_hash'] : '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
        if (!password_verify($password,$hash) || !$user) fail('Invalid email or password.',401);
        log_in($user);
        return ['user'=>current_user(),'csrf'=>$_SESSION['csrf']];
    }
    if ($path === '/auth/logout' && $method === 'POST') { $_SESSION=[]; session_regenerate_id(true); $_SESSION['csrf']=identifier(); return ['csrf'=>$_SESSION['csrf']]; }
    if ($path === '/auth/forgot' && $method === 'POST') {
        rate_limit('forgot',5);
        require_value(mail_enabled(),'Email delivery must be configured before password recovery is available.');
        $email=email_value($input['email'] ?? null);
        $user=query('SELECT * FROM scheduler_users WHERE email=?',[$email])->fetch();
        if ($user) atomic(function() use ($user) { account_email($user,'reset'); });
        return ['message'=>'If this email has an account, a password reset link will arrive shortly.'];
    }
    if ($path === '/auth/resend' && $method === 'POST') {
        $user=require_user(); rate_limit('verify',5);
        require_value(mail_enabled(),'Email delivery has not been configured yet.');
        if (!$user['verified']) atomic(function() use ($user) { account_email($user,'verify'); });
        return ['message'=>'Verification email queued.'];
    }
    if (in_array($path,['/auth/verify','/auth/reset'],true) && $method === 'POST') {
        rate_limit('token',20);
        $purpose=substr($path,6);
        $token=text_value($input['token'] ?? null,100,'link');
        atomic(function() use ($token,$purpose,$input) {
            $row=query('SELECT * FROM scheduler_tokens WHERE token_hash=? AND purpose=? FOR UPDATE',[hash('sha256',$token),$purpose])->fetch();
            require_value($row && (int)$row['expires_at']>=time(),'This link has expired or has already been used.');
            if ($purpose === 'verify') query('UPDATE scheduler_users SET verified=1 WHERE id=?',[$row['user_id']]);
            else {
                $password=$input['password'] ?? '';
                require_value(is_string($password) && strlen($password)>=12 && strlen($password)<=72,'Use a password of 12–72 characters.');
                query('UPDATE scheduler_users SET password_hash=?,session_version=session_version+1 WHERE id=?',[password_hash($password,PASSWORD_DEFAULT),$row['user_id']]);
            }
            query('DELETE FROM scheduler_tokens WHERE token_hash=?',[$row['token_hash']]);
        });
        return ['message'=>$purpose === 'verify' ? 'Email verified. You can now receive updates.' : 'Password updated. Log in with your new password.'];
    }
    if ($path === '/dashboard' && $method === 'GET') {
        $user=require_user();
        return ['meetings'=>query('SELECT DISTINCT m.id,m.title,m.scheduled_date,m.scheduled_start,m.zone,m.created_at,m.owner_id FROM scheduler_meetings m LEFT JOIN scheduler_responses r ON r.meeting=m.id WHERE m.owner_id=? OR r.user_id=? ORDER BY m.created_at DESC',[$user['id'],$user['id']])->fetchAll()];
    }
    if ($path === '/meetings' && $method === 'POST') return create_meeting($input);
    if (preg_match('~^/meetings/([a-zA-Z0-9_-]{32,48})(/responses|/identity|/schedule)?$~',$path,$match)) {
        $meeting=meeting_record($match[1]);
        $action=$match[2] ?? '';
        if ($method==='GET' && $action==='') return public_meeting($meeting);
        if ($method==='POST' && $action==='/responses') return save_response($meeting,$input);
        if ($method==='POST' && $action==='/schedule') return schedule_meeting($meeting,$input);
        if ($method==='POST' && $action==='/identity') {
            $user=current_user();
            $secret=is_string($input['secret'] ?? null) ? $input['secret'] : '';
            $row=query('SELECT id,name,email,slots FROM scheduler_responses WHERE meeting=? AND (secret=? OR user_id=?)',[$meeting['id'],hash('sha256',$secret),$user['id'] ?? null])->fetch();
            if (!$row) fail('No saved response was found for this editing link.',404);
            $row['slots']=json_decode($row['slots'],true);
            return $row;
        }
    }
    fail('Not found.',404);
}
function create_meeting($input) {
    $user=require_user(); rate_limit('meetings',30,3600);
    $title=text_value($input['title'] ?? null,100,'meeting title');
    $description=text_value($input['description'] ?? '',1000,'description',false);
    $zone=$input['zone'] ?? '';
    require_value(is_string($zone) && in_array($zone,timezone_identifiers_list(),true),'Choose a valid timezone.');
    $dates=$input['dates'] ?? [];
    require_value(is_array($dates) && count($dates)>0 && count($dates)<=14,'Choose 1–14 dates.');
    foreach ($dates as $date) {
        require_value(is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/',$date),'Choose a valid date.');
        $parsed=DateTimeImmutable::createFromFormat('!Y-m-d',$date);
        require_value($parsed && $parsed->format('Y-m-d')===$date,'Choose a valid date.');
    }
    $dates=array_values(array_unique($dates)); sort($dates);
    $start=$input['start'] ?? null; $end=$input['end'] ?? null; $duration=$input['duration'] ?? null;
    require_value(is_int($start) && is_int($end) && $start>=0 && $end<=48 && $end>$start,'Choose a valid time window.');
    require_value(in_array($duration,[1,2,3,4],true) && $duration <= $end-$start,'Choose a duration within the time window.');
    $id=identifier();
    query('INSERT INTO scheduler_meetings(id,owner_id,title,description,zone,dates,start,end,duration,organizer_email) VALUES(?,?,?,?,?,?,?,?,?,?)',[$id,$user['id'],$title,$description,$zone,json_encode($dates),$start,$end,$duration,$user['email']]);
    return ['id'=>$id,'emailEnabled'=>mail_enabled()];
}
function save_response($meeting,$input) {
    rate_limit('responses',100);
    $name=text_value($input['name'] ?? null,60,'name');
    $email=email_value($input['email'] ?? null);
    $secret=$input['secret'] ?? '';
    require_value(is_string($secret) && preg_match('/^[a-zA-Z0-9_-]{32,100}$/',$secret),'Invalid editing key.');
    $slots=$input['slots'] ?? null;
    require_value(is_array($slots) && count($slots)<=672,'Invalid availability.');
    foreach ($slots as $slot) {
        require_value(is_string($slot),'Invalid availability.');
        $parts=explode('/',$slot);
        require_value(count($parts)===2 && in_array($parts[0],$meeting['dates'],true) && ctype_digit($parts[1]) && (int)$parts[1]>=$meeting['start'] && (int)$parts[1]<$meeting['end'],'Invalid availability.');
    }
    $user=current_user();
    return atomic(function() use ($meeting,$name,$email,$secret,$slots,$user) {
        $meeting=meeting_record($meeting['id'],true);
        $row=query('SELECT * FROM scheduler_responses WHERE meeting=? AND (secret=? OR user_id=?)',[$meeting['id'],hash('sha256',$secret),$user['id'] ?? null])->fetch();
        $count=(int)query('SELECT COUNT(*) FROM scheduler_responses WHERE meeting=?',[$meeting['id']])->fetchColumn();
        require_value($row || $count<200,'This meeting has reached 200 participants.');
        $id=$row ? $row['id'] : identifier();
        if ($row) query('UPDATE scheduler_responses SET name=?,email=?,slots=?,secret=? WHERE id=?',[$name,$email,json_encode(array_values(array_unique($slots))),hash('sha256',$secret),$id]);
        else query('INSERT INTO scheduler_responses(id,meeting,user_id,name,email,secret,slots) VALUES(?,?,?,?,?,?,?)',[$id,$meeting['id'],$user['id'] ?? null,$name,$email,hash('sha256',$secret),json_encode(array_values(array_unique($slots)))]);
        if (!$row || $row['email']!==$email || $row['secret']!==hash('sha256',$secret)) queue_email($email,'Your availability · '.$meeting['title'],"Hello $name,\n\nYour availability is saved. ".scheduled_text($meeting)."\n\nKeep this private link to edit your availability:\n".app_link('/m/'.$meeting['id'].'#edit='.$secret)."\n\nYou will receive an update when the organizer confirms or changes the time.",$meeting['id']);
        return ['id'=>$id,'emailEnabled'=>mail_enabled()];
    });
}
function schedule_meeting($meeting,$input) {
    if (!owns_meeting($meeting,$input)) fail('Only the organizer can confirm the meeting time.',403);
    rate_limit('schedule',30,3600);
    return atomic(function() use ($meeting,$input) {
        $meeting=meeting_record($meeting['id'],true);
        $date=$input['date'] ?? null; $start=$input['start'] ?? null;
        require_value(in_array($date,$meeting['dates'],true) && is_int($start) && $start>=$meeting['start'] && $start+$meeting['duration']<=$meeting['end'],'Choose a time inside the meeting window.');
        if ($date!==$meeting['scheduled_date'] || $start!==$meeting['scheduled_start']) {
            query('UPDATE scheduler_meetings SET scheduled_date=?,scheduled_start=?,revision=revision+1 WHERE id=?',[$date,$start,$meeting['id']]);
            $meeting['scheduled_date']=$date; $meeting['scheduled_start']=$start;
            $emails=query('SELECT email FROM scheduler_responses WHERE meeting=? AND email IS NOT NULL',[$meeting['id']])->fetchAll(PDO::FETCH_COLUMN);
            if ($meeting['organizer_email']) $emails[]=$meeting['organizer_email'];
            foreach (array_unique($emails) as $email) queue_email($email,'Meeting time confirmed · '.$meeting['title'],scheduled_text($meeting)."\n\nView the meeting: ".app_link('/m/'.$meeting['id'])."\n\nTo edit your availability, log in or use your original private edit link.",$meeting['id']);
        }
        return ['emailEnabled'=>mail_enabled()];
    });
}
