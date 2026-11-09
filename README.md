# Scheduler

A group scheduling app built for everyday people. It is and will always be free.

## Features

- Registration, login, logout, email verification, and password recovery
- A dashboard of meetings organized or joined while signed in
- 1–14 meeting dates, an explicit timezone, and a 30–120 minute duration
- Guest participation with a name and email
- Keyboard, mouse drag, and touch availability selection
- A heatmap, responder list, and ranked full-duration times
- Organizer-only confirmation and rescheduling with individual email updates
- Private emailed links for editing guest responses across browsers
- Persistent MySQL storage and a durable email outbox

## Hosting

PHP, MySQL/MariaDB, and PHPMailer over authenticated SMTP run the production application. No Node.js process or build service is required on the hosting account.

Follow [CPANEL.md](CPANEL.md). Run `python tools/package.py` locally to create `artifacts/scheduler-cpanel.zip`, containing public files, private application files, SQL, and instructions.

The source is syntax-compatible with the PHP 7.4 environment used by the earlier Unify Jobs project. Use a supported PHP version such as 8.3 or newer for public deployment. Required extensions are PDO MySQL, JSON, OpenSSL, ctype, filter, and session.

## Development

The integration runner starts isolated PHP and MariaDB services on loopback and exercises the real HTTP API. Email is captured locally.

```sh
python test/integration.py --php /path/to/php.exe --mariadb-bin /path/to/mariadb/bin
```

Add `--serve --port 3001` for a persistent local preview. Its ignored `artifacts/preview` directory contains the database, private configuration, and captured emails. The preview imports the earlier SQLite prototype when present without modifying the source database. Older meetings retain participant editing keys. Meetings created before organizer credentials existed require a new account-owned meeting to use scheduling controls.

Production emails require private SMTP settings and a cPanel cron job. Preview emails are captured, not delivered to real inboxes. SMTP acceptance does not establish inbox delivery. Failed or interrupted deliveries are retained for inspection before a manual retry.

## Source

- `public/` contains the frontend and PHP API entry point.
- `private/app.php` handles accounts, authorization, validation, and database operations.
- `private/mail.php` and `private/send-mail.php` queue and send email.
- `private/config.example.php` defines settings without credentials.
- `schema.sql` defines the six prefixed InnoDB tables.
- `test/integration.py` tests the real PHP/MySQL service.
- `tools/package.py` packages only deployment files.

Passwords use PHP password hashing. Sessions use HTTP-only cookies, SameSite Lax, and HTTPS in production. Mutating API requests require CSRF tokens. Password-reset and verification tokens are hashed, expire, and work once. Password resets revoke existing sessions. SQL uses bound parameters. User content is escaped before rendering. Public meeting data excludes email addresses and editing keys.

All participants use the meeting's chosen timezone. Results update using the refresh button. Anyone with a meeting link can see names and availability. Guest email addresses are supplied by participants. There is currently no account or meeting deletion screen.

## Attribution

Developed with AI assistance. The availability workflow was inspired by LettuceMeet. The application and interface were created for this project. PHPMailer 7.2.0 is bundled under its LGPL-2.1 license in `private/vendor/PHPMailer/LICENSE`.
