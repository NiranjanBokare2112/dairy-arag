"""Settings, read from the repo-root .env (git-ignored). Nothing secret is hard-coded here.

ARAG_DB=test switches every command and the API to TEST_DATABASE_URL (used by the tests and for trying the
sample data without touching the main database). ARAG_DB=supabase uses SUPABASE_DATABASE_URL (the online copy, D-134).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    database_url: str
    test_database_url: str
    center_id: str
    target: str  # 'main' | 'test' | 'supabase'
    supabase_database_url: str = ''

    @property
    def url(self) -> str:
        return {'test': self.test_database_url, 'supabase': self.supabase_database_url}.get(self.target, self.database_url)


def get_settings(target: str | None = None) -> Settings:
    target = (target or os.getenv("ARAG_DB") or "main").lower()
    if target not in ("main", "test", "supabase"):
        raise SystemExit(f"ARAG_DB must be 'main', 'test' or 'supabase', not {target!r}")
    s = Settings(
        database_url=os.getenv("DATABASE_URL", ""),
        test_database_url=os.getenv("TEST_DATABASE_URL", ""),
        center_id=os.getenv("CENTER_ID") or "arag",
        target=target,
        supabase_database_url=os.getenv("SUPABASE_DATABASE_URL", ""),
    )
    if s.supabase_database_url:  # D-134: accept the URI exactly as Supabase shows it
        u = s.supabase_database_url.strip()
        for pre in ("postgresql://", "postgres://"):
            if u.startswith(pre): u = "postgresql+psycopg://" + u[len(pre):]
        if "sslmode=" not in u: u += ("&" if "?" in u else "?") + "sslmode=require"
        s = Settings(s.database_url, s.test_database_url, s.center_id, s.target, u)
    if not s.url:
        name = {"test": "TEST_DATABASE_URL", "supabase": "SUPABASE_DATABASE_URL"}.get(target, "DATABASE_URL")
        raise SystemExit(f"{name} is not set. Copy .env.example to .env (repo root) and fill it in.")
    return s
