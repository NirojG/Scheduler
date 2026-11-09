"""Exercise the actual PHP/MySQL app and capture email locally without sending it."""
import argparse
import http.cookiejar
import json
import os
from pathlib import Path
import re
import shutil
import socket
import sqlite3
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def ready(port, process):
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError('Local service stopped. Inspect the test logs.')
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=.2):
                return
        except OSError:
            time.sleep(.1)
    raise RuntimeError('Local service did not start.')


class Client:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.csrf = ''
        self.call('/auth/session')

    def call(self, path, data=None, expected=200, csrf=None):
        request = urllib.request.Request(self.base + '/api.php?path=' + urllib.parse.quote(path),
            data=json.dumps(data).encode() if data is not None else None,
            headers={'Content-Type':'application/json','X-CSRF-Token':self.csrf if csrf is None else csrf})
        try:
            with self.opener.open(request, timeout=20) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read()
        result = json.loads(raw)
        assert status == expected, (path, status, result, expected)
        if 'csrf' in result:
            self.csrf = result['csrf']
        return result


class Environment:
    def __init__(self, args):
        self.args = args
        self.directory = ROOT / 'artifacts' / ('preview' if args.serve else 'test-' + uuid.uuid4().hex[:8])
        self.directory.mkdir(parents=True, exist_ok=True)
        self.database = self.directory / 'database'
        self.private = self.directory / 'private'
        shutil.copytree(ROOT / 'private', self.private, dirs_exist_ok=True)
        self.mysql_port = free_port()
        self.php_port = args.port or free_port()
        self.base = f'http://127.0.0.1:{self.php_port}'
        self.hidden = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        self.processes = []
        self.logs = []
        self.php_command = [str(args.php), '-d', 'extension_dir=' + str(args.php.parent / 'ext'), '-d', 'extension=pdo_mysql', '-d', 'display_errors=0']

    def sql(self, statement):
        result = subprocess.run([str(self.args.mariadb_bin / 'mysql.exe'), '--protocol=TCP', '--host=127.0.0.1', '--port='+str(self.mysql_port), '--user=root', '--batch', '--skip-column-names'], input=statement.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=self.hidden)
        if result.returncode:
            raise RuntimeError(result.stderr.decode(errors='replace'))
        return result.stdout.decode().strip()

    def start(self):
        log = (self.directory / 'mysql.log').open('a')
        self.logs.append(log)
        if not self.database.exists():
            subprocess.run([str(self.args.mariadb_bin / 'mariadb-install-db.exe'), '--datadir='+str(self.database), '--port='+str(self.mysql_port), '--silent'], check=True, stdout=log, stderr=log, creationflags=self.hidden)
        database = subprocess.Popen([str(self.args.mariadb_bin / 'mysqld.exe'), '--defaults-file='+str(self.database / 'my.ini'), '--port='+str(self.mysql_port), '--bind-address=127.0.0.1', '--console'], stdout=log, stderr=log, creationflags=self.hidden)
        self.processes.append(database)
        ready(self.mysql_port, database)
        self.sql('CREATE DATABASE IF NOT EXISTS scheduler_test CHARACTER SET utf8mb4; USE scheduler_test;\n' + (ROOT / 'schema.sql').read_text())
        config = {'dsn':f'mysql:host=127.0.0.1;port={self.mysql_port};dbname=scheduler_test;charset=utf8mb4', 'db_user':'root', 'db_password':'', 'app_url':self.base, 'allow_loopback_http':True, 'mail_mode':'test', 'test_mail_file':str(self.directory / 'mail.jsonl')}
        config_json = self.directory / 'config.json'
        config_json.write_text(json.dumps(config), encoding='utf-8')
        # All local settings and email captures remain in the ignored artifacts directory.
        config_path = str(config_json).replace('\\','/').replace("'","\\'")
        (self.private / 'config.php').write_text("<?php return json_decode(file_get_contents('" + config_path + "'),true);",encoding='utf-8')
        env = dict(os.environ, SCHEDULER_PRIVATE_DIR=str(self.private))
        log = (self.directory / 'php.log').open('a')
        self.logs.append(log)
        php = subprocess.Popen(self.php_command + ['-S',f'127.0.0.1:{self.php_port}','-t',str(ROOT / 'public'),str(ROOT / 'test/router.php')],env=env,stdout=log,stderr=log,creationflags=self.hidden)
        self.processes.append(php)
        ready(self.php_port,php)

    def mail(self):
        result = subprocess.run(self.php_command+[str(self.private/'send-mail.php')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=self.hidden)
        assert result.returncode == 0, result.stderr.decode()
        path = self.directory/'mail.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def import_prototype(self):
        source = ROOT/'data/scheduler.db'
        if not source.exists():
            return
        def literal(value):
            if value is None:
                return 'NULL'
            return 'CONVERT(0x'+str(value).encode().hex()+' USING utf8mb4)' if str(value) else "''"
        with sqlite3.connect('file:'+source.as_posix()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row
            for table, columns in [('meetings',['id','title','description','zone','dates','start','end','duration','organizer_secret','organizer_email','scheduled_date','scheduled_start']),('responses',['id','meeting','name','secret','slots','email'])]:
                for row in db.execute('SELECT * FROM '+table):
                    values=[literal(row[column]) if column in row.keys() else 'NULL' for column in columns]
                    self.sql('USE scheduler_test; INSERT IGNORE INTO scheduler_'+table+' ('+','.join('`'+column+'`' for column in columns)+') VALUES ('+','.join(values)+');')

    def close(self):
        for process in reversed(self.processes):
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for log in self.logs:
            log.close()


def check_app(env):
    owner, guest, stranger = Client(env.base), Client(env.base), Client(env.base)
    owner.call('/auth/register',{'name':'Organizer','email':'owner@example.test','password':'a secure test password'},csrf='wrong',expected=403)
    owner.call('/auth/register',{'name':'Organizer','email':'owner@example.test','password':'a secure test password'})
    owner.call('/auth/login',{'email':'owner@example.test','password':'wrong'},expected=401)
    session = owner.call('/auth/session')
    assert session['user']['name'] == 'Organizer'
    fields={'title':'Study group <script>','description':'Plan together','zone':'Europe/Helsinki','dates':['2026-12-01','2026-12-02'],'start':18,'end':26,'duration':2}
    guest.call('/meetings',fields,expected=401)
    owner.call('/meetings',dict(fields,dates=['2026-02-30']),expected=400)
    meeting = owner.call('/meetings',fields)
    path='/meetings/'+meeting['id']
    public=guest.call(path)
    assert public['canOrganize'] is False
    assert 'organizer_email' not in public and 'organizer_secret' not in public
    assert owner.call(path)['canOrganize'] is True
    response={'name':'Participant','email':'person@example.test','secret':'c'*48,'slots':['2026-12-01/18','2026-12-01/19']}
    participant=guest.call(path+'/responses',response)
    guest.call(path+'/responses',dict(response,email='bad'),expected=400)
    guest.call(path+'/responses',dict(response,slots=['2026-12-01/99']),expected=400)
    guest.call(path+'/responses',dict(response,slots=['2026-12-01/20','2026-12-01/21']))
    public=guest.call(path)
    assert len(public['responses'])==1 and 'email' not in public['responses'][0] and 'secret' not in public['responses'][0]
    assert public['responses'][0]['id']==participant['id']
    stranger.call(path+'/identity',{'secret':'wrong'},expected=404)
    recovered=stranger.call(path+'/identity',{'secret':'c'*48})
    assert recovered['email']=='person@example.test'
    stranger.call(path+'/schedule',{'date':'2026-12-01','start':20},expected=403)
    owner.call(path+'/schedule',{'date':'2026-12-01','start':25},expected=400)
    owner.call(path+'/schedule',{'date':'2026-12-01','start':20})
    owner.call(path+'/schedule',{'date':'2026-12-01','start':20})
    assert guest.call(path)['scheduled_start']==20
    emails=env.mail()
    schedules=[mail for mail in emails if mail['subject'].startswith('Meeting time confirmed')]
    assert len(schedules)==2, 'Duplicate schedule requests must not send duplicate mail'
    assert {mail['recipient'] for mail in schedules}=={'owner@example.test','person@example.test'}
    assert all('10:00' in mail['body'] and 'Europe/Helsinki' in mail['body'] for mail in schedules)
    edit_mail=next(mail for mail in emails if mail['subject'].startswith('Your availability'))
    assert '#edit='+response['secret'] in edit_mail['body']
    verification=next(mail for mail in emails if mail['subject'].startswith('Verify'))
    token=re.search(r'#verify=([a-f0-9]+)',verification['body'])[1]
    owner.call('/auth/verify',{'token':token})
    owner.call('/auth/verify',{'token':token},expected=400)
    assert owner.call('/auth/session')['user']['verified'] is True
    owner.call(path+'/schedule',{'date':'2026-12-02','start':22})
    assert len([m for m in env.mail() if m['subject'].startswith('Meeting time confirmed')])==4
    guest.call('/auth/forgot',{'email':'owner@example.test'})
    reset=next(m for m in env.mail() if m['subject'].startswith('Reset'))
    token=re.search(r'#reset=([a-f0-9]+)',reset['body'])[1]
    guest.call('/auth/reset',{'token':token,'password':'another secure password'})
    owner.call('/dashboard',expected=401)
    owner.call('/auth/login',{'email':'owner@example.test','password':'another secure password'})
    assert len(owner.call('/dashboard')['meetings'])==1
    owner.call('/auth/logout',{})
    assert owner.call('/auth/session')['user'] is None
    guest.call('/auth/reset',{'token':token,'password':'another secure password'},expected=400)
    assert len(env.mail())==7, 'Repeated worker execution must not resend successful messages'
    print('PASS: registration, login, logout, CSRF, account verification, reset and session revocation',flush=True)
    print('PASS: meeting ownership, dates, availability editing, privacy and cross-browser edit links',flush=True)
    print('PASS: scheduling, rescheduling, recipient isolation, durable outbox and duplicate suppression',flush=True)
    print('Emails were captured locally. No external messages were sent.',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--php',type=Path,required=True)
    parser.add_argument('--mariadb-bin',type=Path,required=True)
    parser.add_argument('--serve',action='store_true')
    parser.add_argument('--port',type=int)
    args=parser.parse_args()
    args.php=args.php.resolve();args.mariadb_bin=args.mariadb_bin.resolve()
    environment=Environment(args)
    try:
        environment.start()
        if args.serve:
            environment.import_prototype()
            print('Scheduler PHP/MySQL preview: '+environment.base,flush=True)
            print('Local test email capture: '+str(environment.directory/'mail.jsonl'),flush=True)
            while True:
                environment.mail()
                time.sleep(5)
        else:
            check_app(environment)
    finally:
        environment.close()
