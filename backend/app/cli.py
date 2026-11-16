"""Command line: run from backend/.

  python -m app.cli check                       connection + row count per table
  python -m app.cli init-db                     create tables/functions/triggers from db/schema.sql + migrations (empty DB only)
  python -m app.cli migrate                     apply new db/migrations/*.sql (additive, recorded in schema_migrations)
  python -m app.cli wa-check | wa-templates [--submit] | wa-test MOBILE | wa-send [--dry-run]   WhatsApp (app/whatsapp.py)
  python -m app.cli backup                      back up the main database to backups/ (+ off-site copy); see app/backup.py
  python -m app.cli restore-check [FILE]        restore a backup into the TEST database and compare row counts
  python -m app.cli restore FILE --yes-replace-main   put a backup back into the main database (safety backup first)
  python -m app.cli seed [FILE] [--reset]       load rows (default: ../scripts/db/sample-data.json);
                                                --reset rebuilds the schema first (keeps the center row)

Add --test to any command to use TEST_DATABASE_URL instead of DATABASE_URL (same as ARAG_DB=test).
"""
from __future__ import annotations

import argparse
import json
import sys

from sqlalchemy import text

from .config import REPO_ROOT, get_settings
from .db import engine, safe_url, status
from .loader import apply_migrations, apply_schema, load_file

DEFAULT_SAMPLE = REPO_ROOT / "scripts" / "db" / "sample-data.json"


def main(argv: list[str] | None = None) -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(prog="python -m app.cli", description="Arag backend: database commands")
    p.add_argument("--test", action="store_true", help="use TEST_DATABASE_URL")
    p.add_argument("--supabase", action="store_true", help="use SUPABASE_DATABASE_URL (the online copy, D-134)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check", help="test the connection and count rows")
    sub.add_parser("init-db", help="create the schema in an empty database")
    sub.add_parser("migrate", help="apply new db/migrations/*.sql (additive; safe to run again)")
    sub.add_parser("wa-check", help="WhatsApp: is the token valid, which number, template approval status (sends nothing)")
    wt = sub.add_parser("wa-templates", help="WhatsApp: list our templates' status, or --submit them to Meta for approval")
    wt.add_argument("--submit", action="store_true")
    wx = sub.add_parser("wa-test", help="WhatsApp: send Meta's hello_world template to one allowed number")
    wx.add_argument("mobile")
    ws = sub.add_parser("wa-send", help="WhatsApp: send due outbox messages (only to allowed numbers until WHATSAPP_LIVE=1)")
    ws.add_argument("--limit", type=int, default=50)
    ws.add_argument("--dry-run", action="store_true", help="show what would be sent, send nothing")
    sub.add_parser("backup", help="back up the database (main, or --test) to backups/ and the off-site folder")
    rc = sub.add_parser("restore-check", help="restore a main-database backup into the TEST database and compare")
    rc.add_argument("file", nargs="?")
    rs = sub.add_parser("restore", help="replace the MAIN database with a backup (takes a safety backup first)")
    rs.add_argument("file")
    rs.add_argument("--yes-replace-main", action="store_true", help="confirm: everything in the main database is replaced")
    s = sub.add_parser("seed", help="load rows from a JSON file")
    s.add_argument("file", nargs="?", default=str(DEFAULT_SAMPLE))
    s.add_argument("--reset", action="store_true", help="rebuild: drop ALL tables and rows (incl. the audit log), keep the center row, re-create from db/schema.sql, then load")
    s.add_argument("--yes", action="store_true", help="confirm --reset on the main database")
    a = p.parse_args(argv)
    target = "test" if a.test else "supabase" if a.supabase else None
    settings = get_settings(target)
    print(f"database: {safe_url(target)}  ({settings.target})")

    if a.cmd == "check":
        print(json.dumps(status(target), ensure_ascii=False, indent=1))
    elif a.cmd == "init-db":
        with engine(target).begin() as c:
            n = c.execute(text("select count(*) from information_schema.tables where table_schema = 'public'")).scalar()
            if n:
                print(f"Refusing: the database already has {n} tables. init-db only runs on an empty database.")
                return 1
            apply_schema(c)
        print("schema created:", status(target)["tables"], "tables")
    elif a.cmd == "migrate":
        with engine(target).begin() as c:
            done = apply_migrations(c)
        print("applied:", ", ".join(done) if done else "nothing new")
    elif a.cmd.startswith("wa-"):
        from . import whatsapp as wa
        if a.cmd == "wa-check":
            print(json.dumps(wa.check_account(), ensure_ascii=False, indent=1))
        elif a.cmd == "wa-templates":
            print(json.dumps(wa.submit_templates() if a.submit else wa.template_status(), ensure_ascii=False, indent=1))
        elif a.cmd == "wa-test":
            print("sent, message id:", wa.send_template(a.mobile, "hello_world", [], lang="en_US"))
        elif a.cmd == "wa-send":
            print(json.dumps(wa.send_due(target=target, limit=a.limit, dry_run=a.dry_run), ensure_ascii=False, indent=1))
    elif a.cmd == "backup":
        from .backup import backup
        print(json.dumps(backup(settings.target), ensure_ascii=False, indent=1))
    elif a.cmd == "restore-check":
        from .backup import restore_check
        print(json.dumps(restore_check(a.file), ensure_ascii=False, indent=1))
    elif a.cmd == "restore":
        from .backup import backup, restore
        if settings.target == "main" and not a.yes_replace_main:
            print("Refusing: restore replaces EVERYTHING in the main database. Add --yes-replace-main if you really mean it.")
            return 1
        safety = backup(settings.target, note="before-restore")
        print("safety backup:", safety["file"])
        print(json.dumps(restore(a.file, settings.target), ensure_ascii=False, indent=1))
    elif a.cmd == "seed":
        if a.reset and settings.target == "main" and not a.yes:
            print("Refusing: --reset on the MAIN database deletes every row. Add --yes if you really mean it.")
            return 1
        report = load_file(a.file, target=target, reset=a.reset)
        print(json.dumps(report, ensure_ascii=False, indent=1))
        print("rows now:", json.dumps(status(target)["rows"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
