# Backend — FastAPI + PostgreSQL

Status: **first slice** — database connection, schema, data loader, read-only API, tests. Login/roles and the write endpoints of [docs/api-contract.md](../docs/api-contract.md) come next.

## Setup

1. PostgreSQL 18 running locally, with databases `arag_dudh` and `arag_dudh_test` owned by `arag_app`.
2. Repo-root `.env` (copy `.env.example`, fill in the password — never commit `.env`):
   ```
   DATABASE_URL=postgresql+psycopg://arag_app:<password>@localhost:5432/arag_dudh
   TEST_DATABASE_URL=postgresql+psycopg://arag_app:<password>@localhost:5432/arag_dudh_test
   CENTER_ID=arag
   ```
3. `pip install -r requirements.txt` (Python 3.12+).

## Commands (run in `backend/`)

| Command | What it does |
|---|---|
| `python -m app.cli check` | Connects and prints server, tables and row count per table |
| `python -m app.cli init-db` | Creates all tables, functions and triggers from `db/schema.sql` — only on an **empty** database |
| `python -m app.cli seed` | Loads `scripts/db/sample-data.json` (refuses if the database already has data) |
| `python -m app.cli seed FILE.json` | Loads your own rows (same JSON shape: `{"tables": {"farmers": [{...}], ...}}`) |
| `python -m app.cli seed --reset` | Deletes **all** rows first, then loads (on the main DB also needs `--yes`) |
| `uvicorn app.main:app --host 127.0.0.1 --port 8010` | Starts the API; docs at http://127.0.0.1:8010/docs |
| `python -m pytest -q` | Tests (rebuild and use the **test** database only) |

Add `--test` to any `app.cli` command (or set `ARAG_DB=test`) to use the test database.

## Feeding data

The loader inserts everything in **one transaction** (all or nothing), in the order the database's guard triggers allow — the same order real use follows: masters → bill cycles/bills as draft → milk entries, feed sales, recoveries → bills final and period finalized → payments (the `payments_sync_bill` trigger fills `bills.paid_paise`, checked against the file) → messages and audit log. Column names are the table columns (`snake_case`); money in paise, litres ×100, Fat/SNF ×10, dates `YYYY-MM-DD`. Booleans may be `true/false` or `1/0`; JSON columns take objects; binary takes `{"$hex": "…"}`.

## API (first slice, read-only)

`GET /api/health` · `/api/center` · `/api/farmers` · `/api/farmers/{id}` (with balances) · `/api/collections?date=|from=&to=|farmerId=` · `/api/bills?cycleId=&farmerId=` · `/api/summary?date=`

**Farmer login (code only, D-47)** — `app/farmer.py`:
`POST /api/farmer/login {"code": 101}` → bearer token (12 h; only its SHA-256 is stored in `sessions`) ·
`GET /api/farmer/me` → the farmer's own profile (mobile/UPI masked), today, last 10 days, last 30 days, last 7 bills (with public bill link), balances ·
`POST /api/farmer/logout`. Read-only. 10 wrong codes from one address in 10 minutes → `429` for the rest of the window. Logins, wrong codes and logouts go to `audit_log`.

JSON is camelCase in the frontend's units. `pin_hash`, `token_hash` and `aadhaar_enc` are never returned; Aadhaar shows as `XXXX XXXX 1234`.

> **No staff login yet — keep the API on 127.0.0.1.** The staff endpoints above are open; do not expose the API on the LAN or through the Cloudflare Tunnel until staff PIN login and roles are added. (Farmer endpoints already require their token.)

## Files

| Path | What |
|---|---|
| `db/schema.sql` | The live PostgreSQL schema (`pg_dump --schema-only` of `arag_dudh`): 19 tables, checks, indexes, guard triggers. Source of truth for the database. |
| `app/config.py` | Reads `.env`; `ARAG_DB=test` switch |
| `app/db.py` | Engine (SQLAlchemy 2 + psycopg 3), connection status |
| `app/loader.py` | `init-db` and the data loader |
| `app/cli.py` | Command line |
| `app/main.py` | FastAPI app |
| `tests/` | API, loader, rounding, payment trigger and guard-trigger tests |
