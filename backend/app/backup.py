"""Backups (CLAUDE.md §2): a daily local backup on the desktop + one off-site copy, and a tested restore.

    python -m app.cli backup                    dump the main database to backups/ (keeps the newest 30)
                                                and copy it to BACKUP_DESTINATION (off-site folder) if set
    python -m app.cli restore-check [FILE]      restore a backup (default: the newest) into the TEST database and
                                                compare row counts with the main database — proves the backup works
    python -m app.cli restore FILE --yes-replace-main
                                                put a backup back into the MAIN database (takes a safety backup first)

Uses PostgreSQL's own pg_dump / pg_restore (custom format, compressed). The password goes to them through the
PGPASSWORD environment variable only; it is never printed or written to a file. Found via PG_BIN in .env, the PATH,
or C:\\Program Files\\PostgreSQL\\<version>\\bin.

Off-site copy: set BACKUP_DESTINATION to a folder that a free cloud drive keeps in sync (Google Drive for desktop,
OneDrive). Backups are not encrypted by this script; the cloud folder must belong to the center owner.
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from sqlalchemy import text

from .db import TABLES, engine

ROOT = Path(__file__).resolve().parents[2]
BACKUP_DIR = Path(os.getenv("BACKUP_DIR") or ROOT / "backups")
KEEP = int(os.getenv("BACKUP_KEEP") or 30)


def _tool(name: str) -> str:
    exe = name + (".exe" if os.name == "nt" else "")
    candidates = []
    if os.getenv("PG_BIN"):
        candidates.append(Path(os.environ["PG_BIN"]) / exe)
    found = shutil.which(name)
    if found:
        candidates.append(Path(found))
    for d in sorted(glob.glob(r"C:\Program Files\PostgreSQL\*\bin"), reverse=True):
        candidates.append(Path(d) / exe)
    for c in candidates:
        if c.is_file():
            return str(c)
    raise SystemExit(f"{name} not found. Set PG_BIN in .env to PostgreSQL's bin folder.")


def _conn_args(target: str) -> tuple[list[str], dict]:
    u = engine(target).url
    args = ["-h", u.host or "localhost", "-p", str(u.port or 5432), "-U", u.username or "postgres"]
    env = {**os.environ, "PGPASSWORD": u.password or "", "PGCLIENTENCODING": "UTF8"}
    return args, env


def _counts(target: str) -> dict:
    with engine(target).connect() as c:
        present = {r[0] for r in c.execute(text("select table_name from information_schema.tables where table_schema='public'"))}
        return {t: c.execute(text(f'select count(*) from "{t}"')).scalar() for t in TABLES if t in present}


def backup(target: str = "main", note: str = "") -> dict:
    """Dump `target` to backups/arag-<db>-<time>.dump; prune to the newest KEEP; copy off-site if configured."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    db = engine(target).url.database
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = BACKUP_DIR / f"arag-{db}-{stamp}{('-' + note) if note else ''}.dump"
    args, env = _conn_args(target)
    r = subprocess.run([_tool("pg_dump"), *args, "-d", db, "-F", "c", "-Z", "6", "--no-owner", "-f", str(out)],
                       env=env, capture_output=True, text=True)
    if r.returncode != 0 or not out.is_file() or out.stat().st_size == 0:
        out.unlink(missing_ok=True)
        raise SystemExit("pg_dump failed: " + (r.stderr.strip() or "no output"))
    report = {"file": str(out), "sizeKB": round(out.stat().st_size / 1024), "rows": _counts(target)}
    # keep the newest KEEP backups of this database (safety backups taken before a restore are kept too)
    mine = sorted(BACKUP_DIR.glob(f"arag-{db}-*.dump"))
    regular = [p for p in mine if "-before-restore" not in p.name]
    for old in regular[:-KEEP]:
        old.unlink()
    report["kept"] = len(list(BACKUP_DIR.glob(f"arag-{db}-*.dump")))
    dest = os.getenv("BACKUP_DESTINATION", "").strip()
    if dest:
        try:
            Path(dest).mkdir(parents=True, exist_ok=True)
            shutil.copy2(out, Path(dest) / out.name)
            for old in sorted(Path(dest).glob(f"arag-{db}-*.dump"))[:-KEEP]:
                old.unlink()
            report["offsite"] = str(Path(dest) / out.name)
        except OSError as e:  # the local backup is still good; report the off-site problem
            report["offsiteError"] = str(e)
    else:
        report["offsite"] = "not set (BACKUP_DESTINATION in .env)"
    return report


def newest(db_name: str | None = None) -> Path:
    db_name = db_name or engine("main").url.database
    files = sorted(BACKUP_DIR.glob(f"arag-{db_name}-*.dump"))
    if not files:
        raise SystemExit(f"No backups in {BACKUP_DIR}. Run:  python -m app.cli backup")
    return files[-1]


def restore(file: str | Path, target: str) -> dict:
    """Replace everything in `target` with the backup. The schema is dropped and recreated from the file."""
    file = Path(file)
    if not file.is_file():
        raise SystemExit(f"Backup not found: {file}")
    db = engine(target).url.database
    with engine(target).begin() as c:  # protected tables (audit log) can't be emptied row by row; drop the schema
        c.exec_driver_sql("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
    engine(target).dispose()
    args, env = _conn_args(target)
    r = subprocess.run([_tool("pg_restore"), *args, "-d", db, "--no-owner", "--exit-on-error", "-1", str(file)],
                       env=env, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("pg_restore failed: " + r.stderr.strip())
    return {"restored": str(file), "into": db, "rows": _counts(target)}


def restore_check(file: str | Path | None = None) -> dict:
    """Restore a main-database backup into the TEST database and compare row counts with the backup's report."""
    test_db = engine("test").url.database
    if not test_db.endswith("_test"):
        raise SystemExit("restore-check only restores into a *_test database")
    file = Path(file) if file else newest()
    got = restore(file, "test")
    main_now = _counts("main")
    diff = {t: (main_now.get(t), got["rows"].get(t)) for t in set(main_now) | set(got["rows"]) if main_now.get(t) != got["rows"].get(t)}
    return {**got, "ok": bool(got["rows"]) and all(v > 0 for k, v in got["rows"].items() if k in ("centers", "users")),
            "differsFromMainNow": diff or "none (backup matches the main database as it is now)"}
