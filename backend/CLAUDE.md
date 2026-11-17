# Backend — working rules (read with the root CLAUDE.md)

FastAPI + PostgreSQL. Commands from `backend/`: `python -m app.cli <command>` (check, init-db, migrate, backup, restore-check, restore, seed, wa-check, wa-templates, wa-test, wa-send).

## Three databases (`.env`, never printed)
| Option | Variable | What it is |
|---|---|---|
| (none) | `DATABASE_URL` | PostgreSQL on this PC (`arag_dudh`) — development copy |
| `--test` | `TEST_DATABASE_URL` | `arag_dudh_test` — the tests rebuild it every run; safe to use |
| `--supabase` | `SUPABASE_DATABASE_URL` | Supabase (Mumbai, Session pooler) — the **main live database** (D-135) |

The option goes **before** the command: `python -m app.cli --supabase check`.

## Safety rules
- **Ask before** any write to the PC database or Supabase: `migrate`, `seed`, `restore`, `init-db`. Take `python -m app.cli backup` first for the PC database.
- After any rebuild of Supabase tables (`seed --reset`, `init-db`), switch **Row Level Security on for every table** in `public` (no policies) — otherwise Supabase's public Data API exposes them.
- Never print passwords, the WhatsApp token or the app secret; mask URLs (`postgres:****@`). The user fills secrets in `.env` themselves.
- WhatsApp: `WHATSAPP_LIVE=0` + `WHATSAPP_ALLOWED_NUMBERS` until the owner says go live.

## Schema changes
- Only additive migrations: new file `db/migrations/NNN_name.sql` (next number), safe to run twice (`IF NOT EXISTS`, drop/add constraints).
- Add new tables to `TABLES` in `app/db.py` and the insert order in `app/loader.py`; export them in `scripts/db/make-sample.mjs`; add a test in `tests/test_backend.py`.
- `scripts/db/sample-data.json` is the standard sample the tests expect — keep it. Test data up to a date: `node scripts/db/make-sample.mjs --until=YYYY-MM-DD --out=scripts/db/test-data-until-YYYY-MM-DD.json` (not committed).

## Checks
- `python -m pytest -q` (uses only the test database) — all must pass.
- Plan for the real API: `docs/go-live-plan.md`; operations and shapes: `docs/api-contract.md`.
