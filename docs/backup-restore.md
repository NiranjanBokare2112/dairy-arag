# Backup and restore

The center's data lives in PostgreSQL (`arag_dudh`) on the center's desktop. It is protected in two places:

1. **Local backup**, every night, in `backups\` on the desktop (the newest 30 are kept).
2. **Off-site copy** of the same file, in a folder that a free cloud drive keeps in sync (Google Drive for desktop or OneDrive), set as `BACKUP_DESTINATION` in `.env`.

A backup is one file, e.g. `backups\arag-arag_dudh-20261110-233000.dump` (PostgreSQL custom format, compressed; about 300 KB for 3 months of data).

## Set up (once)

1. In `.env` (repo root), set the off-site folder:
   ```
   BACKUP_DESTINATION=C:\Users\<owner>\Google Drive\Arag backups
   ```
   The cloud drive must belong to the center owner. Backups are not encrypted, so do not share that folder.
   If PostgreSQL's tools are not found automatically, also set `PG_BIN=C:\Program Files\PostgreSQL\18\bin`.
2. Install the nightly task (23:30, after the evening shift):
   ```
   powershell -ExecutionPolicy Bypass -File scripts\windows\install-backup-task.ps1
   ```
3. Run it once now and check the result:
   ```
   Start-ScheduledTask -TaskName 'Arag Dudh - daily backup'
   ```
   Then open `backups\backup-log.txt`: the last entry must say **OK** and show the off-site path.

If the PC was off at 23:30, the task runs as soon as it is back on.

## Take a backup by hand

```
cd backend
python -m app.cli backup
```
Do this before any big change (software update, moving to a new PC).

## Check that backups really work (monthly)

```
cd backend
python -m app.cli restore-check
```
It restores the newest backup into the **test** database (`arag_dudh_test`) and compares the row counts with the live database. The result must show `"ok": true`. The live database is not touched.

## Restore after a problem

Use this only when the live data is lost or damaged, e.g. the disk failed or a wrong bulk change was made.

1. Stop the app, so nobody enters milk during the restore.
2. Pick the backup: the newest file in `backups\`, or copy one from the off-site folder into `backups\` if the PC was replaced.
3. Restore:
   ```
   cd backend
   python -m app.cli restore ..\backups\arag-arag_dudh-20261110-233000.dump --yes-replace-main
   ```
   Before replacing anything, this takes a safety backup of the current state (`...-before-restore.dump`), so a restore can itself be undone.
4. Start the app and check today's entries and the latest bills on the dashboard.

Anything entered after the backup was taken has to be entered again (from the operator's paper notes or receipts).

## On a new PC

1. Install PostgreSQL 18 and Python, copy the project folder, and fill in `.env` (see `backend/README.md`).
2. Create the empty database user and database as in `backend/README.md`.
3. Copy the newest backup from the off-site folder into `backups\` and run the restore command above.
4. Install the nightly task again (step 2 of "Set up").

## Tested

On 10/11/2026: backup of `arag_dudh`, then restore into `arag_dudh_test`, gave identical row counts for every table. The off-site copy and the keep-30 pruning were checked with a test folder.
