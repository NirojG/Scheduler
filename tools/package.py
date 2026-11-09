"""Build the cPanel upload package from an explicit file allowlist."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
output = root / 'artifacts' / 'scheduler-cpanel.zip'
output.parent.mkdir(exist_ok=True)
files = [root / name for name in ['schema.sql', 'CPANEL.md', 'README.md']]
files += [path for path in (root / 'public').rglob('*') if path.is_file()]
files += [root / 'private' / name for name in ['app.php', 'mail.php', 'send-mail.php', 'config.example.php']]
files += [path for path in (root / 'private/vendor/PHPMailer').iterdir() if path.is_file()]
manifest = {}
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(files):
        name = path.relative_to(root).as_posix()
        archive.write(path, name)
        manifest[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    archive.writestr('manifest.json', json.dumps(manifest, indent=2))
print(f'Created {output} with {len(files)} source files and a checksum manifest.')
