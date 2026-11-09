# cPanel deployment

Prepared for the Babal.host cPanel environment documented in the earlier Unify Jobs project. Scheduler needs its own domain or subdomain, database, database user, and private directory. The exact Scheduler domain and credentials have not been configured.

## Prepare the hosting account

1. Create the Scheduler domain or subdomain in cPanel Domains and note its actual document root.
2. Select a supported PHP version, preferably 8.3 or newer. Confirm PDO MySQL, OpenSSL, JSON, ctype, filter, and session support.
3. Enable HTTPS using SSL/TLS Status and AutoSSL, then enable Force HTTPS Redirect for this domain.
4. Create a new MySQL database and user. Import `schema.sql` using phpMyAdmin. There are six prefixed Scheduler tables. Use a separate database from Unify Jobs.
5. Create or choose the domain mailbox that should send Scheduler emails. In Email Accounts → Connect Devices, note the SMTP host, username, port, and encryption.

## Place the files

Upload the contents of `public/`, including `.htaccess`, into only the Scheduler domain's document root. `index.html` and `api.php` belong directly inside that root. Enable Show Hidden Files in File Manager.

Place the contents of `private/` in `/home/ghantior/scheduler-private`, outside all public document roots. This account-home path comes from the earlier project and should be confirmed in File Manager. If it differs, update the path in `public/api.php`.

Copy `private/config.example.php` to `private/config.php`. Fill in the MySQL DSN, database user, password, and `app_url` with the exact HTTPS origin. Configure the SMTP host, port, encryption (`ssl` on 465 or `tls` on 587), username, password, and `mail_from` with your domain mailbox.

Keep `mail_mode` set to `smtp` and `allow_loopback_http` set to `false`. Use the narrowest permissions readable by your PHP user, typically 700 for the private directory and 600 for configuration. Keep credentials, SQL dumps, test data, archives, and the private directory outside public document roots.

The ZIP includes PHPMailer and its license, so Composer is not required on the server. The app expects the root of a domain or subdomain.

## Enable queued email

Add a cPanel Cron Job running every minute. Confirm the PHP CLI path with Babal.host. A typical command is:

```sh
/usr/local/bin/php /home/ghantior/scheduler-private/send-mail.php
```

Use the CLI binary matching your supported PHP version. The worker sends up to 25 pending messages per run and locks against overlapping workers. Each message goes to one recipient. Successfully submitted messages are marked sent and their message bodies are cleared.

Failed messages remain `failed`. Interrupted sends become `uncertain`. Inspect the SMTP provider logs and queue status in phpMyAdmin before retrying. After confirming that a message was not delivered, an administrator can reset that individual item's status to `pending`. SMTP cannot guarantee exactly-once delivery after an interrupted network connection.

Configure SPF and DKIM in cPanel Email Deliverability. Check the host's sending limits before inviting larger groups.

## Verify the deployed site

- Check that the HTTPS landing page, `/register`, `/login`, `/new`, and meeting links load directly.
- Register, receive the verification email, and verify your address.
- Log out, log in, request a password reset, and confirm that the reset link works once.
- Create a meeting and submit availability from a second browser using an address you control.
- Open the emailed edit link and update the response.
- Confirm a time and check both inboxes for the correct date, time, and timezone.
- Change the time and verify a second update. Reconfirming the same time should not enqueue duplicates.
- Confirm that a participant cannot schedule the meeting or read another participant's email through the public API.

Local tests do not verify Babal.host's SMTP, DNS, TLS, cron path, filesystem permissions, or selected PHP version. Verify these on the actual account before announcing the site.

## Data and updates

Back up the Scheduler database and private configuration before updates. `CREATE TABLE IF NOT EXISTS` supports reimporting the initial schema but does not migrate future changes. Keep passwords out of GitHub.

The earlier SQLite prototype is imported into the local preview only. It is excluded from the release ZIP. Production begins with the new MySQL schema.
