# Scripts

## Ready now

- [windows/backup.ps1](windows/backup.ps1) — nightly backup of the database (local + off-site copy), with a log in `backups\backup-log.txt`.
- [windows/install-backup-task.ps1](windows/install-backup-task.ps1) — installs the nightly backup as a Windows scheduled task (23:30).
- [db/](db/) — sample data for the PostgreSQL database and its generator. See [db/README.md](db/README.md).

Backup, restore and the monthly restore check are explained in [docs/backup-restore.md](../docs/backup-restore.md).

## Still to come (with the backend server)

- Run the app as a Windows service (start at boot, restart on failure). This needs the backend to serve the app and its full API first.
- Cloudflare Tunnel setup for the owner dashboard and the WhatsApp status callbacks.
