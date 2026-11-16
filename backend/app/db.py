"""Database connection (SQLAlchemy 2 + psycopg 3, PostgreSQL)."""
from __future__ import annotations

from functools import lru_cache

from sqlalchemy import Engine, create_engine, text

from .config import get_settings

# Tables in dependency order (parents first). Matches backend/db/schema.sql.
TABLES = [
    "centers", "users", "farmers", "sessions", "rate_charts", "rate_chart_cells", "feed_items", "advances",
    "bill_cycles", "bills", "collections", "corrections", "feed_moves", "advance_recoveries", "payments",
    "dispatches", "outbox_messages", "sms_counters", "audit_log",
    "milk_buyers", "buyer_sales", "buyer_payments", "buyer_months",  # migration 001 (D-51)
    "counter_sales",  # migration 002 (D-53)
    "schemes", "broadcasts",  # migration 003 (D-71, D-72)
    "doctors",  # migration 005 (D-83)
    "payout_runs", "payouts",  # migration 008 (D-107)
    "change_requests",  # migration 009 (D-108)
    "tickets", "ticket_messages", "ticket_notifications",  # migration 010 (D-109)
    "expense_categories", "expenses",  # migration 014 (D-126)
]


@lru_cache(maxsize=2)
def engine(target: str | None = None) -> Engine:
    s = get_settings(target)
    return create_engine(s.url, pool_pre_ping=True, connect_args={"connect_timeout": 5, "options": "-c timezone=Asia/Kolkata"})


def safe_url(target: str | None = None) -> str:
    """The connection URL with the password hidden, for messages."""
    return engine(target).url.render_as_string(hide_password=True)


def status(target: str | None = None) -> dict:
    """Connection check: server version, database, and row count per table."""
    with engine(target).connect() as c:
        row = c.execute(text("select current_user, current_database(), current_setting('server_version')")).one()
        present = {r[0] for r in c.execute(text("select table_name from information_schema.tables where table_schema = 'public'"))}
        counts = {t: c.execute(text(f'select count(*) from "{t}"')).scalar() for t in TABLES if t in present}
    return {"ok": True, "user": row[0], "database": row[1], "server": f"PostgreSQL {row[2]}",
            "tables": len(present), "missingTables": [t for t in TABLES if t not in present], "rows": counts}
