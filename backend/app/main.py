"""HTTP API (FastAPI). First slice: health + read-only endpoints over the PostgreSQL data.

Run (from backend/):   uvicorn app.main:app --host 127.0.0.1 --port 8010
                       ARAG_DB=test uvicorn app.main:app ...   (test database)

IMPORTANT: login/roles are not built yet, so these endpoints are open. Bind to 127.0.0.1 only (as above) —
never 0.0.0.0 or the Cloudflare Tunnel — until auth (PIN login + sessions, docs/api-contract.md) is added.

JSON uses camelCase, money in paise, litres ×100, Fat/SNF ×10, dates 'YYYY-MM-DD' (the frontend's contract).
Secrets (pin_hash, token_hash, aadhaar_enc) are never returned.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import FastAPI, HTTPException, Query
from sqlalchemy import text

from .config import get_settings
from .db import engine, status
from .farmer import router as farmer_router
from .whatsapp import router as whatsapp_router

app = FastAPI(title="Arag Dudh Sankalan Kendra API", version="0.2.0")
app.include_router(farmer_router)  # farmer login by code + own details (D-47)
app.include_router(whatsapp_router)  # Meta delivery reports (D-75); only this path goes through the tunnel
HIDDEN = {"pin_hash", "token_hash", "aadhaar_enc"}


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(w.capitalize() for w in rest)


def _json(v):
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def _rows(sql: str, **params) -> list[dict]:
    with engine().connect() as c:
        res = c.execute(text(sql), params)
        return [{_camel(k): _json(v) for k, v in m.items() if k not in HIDDEN} for m in res.mappings()]


def _center() -> str:
    return get_settings().center_id


@app.get("/api/health")
def health():
    try:
        return status()
    except Exception as e:  # report, don't crash
        raise HTTPException(503, detail={"ok": False, "error": type(e).__name__}) from e


@app.get("/api/center")
def center():
    rows = _rows("select * from centers where id = :c", c=_center())
    if not rows:
        raise HTTPException(404, "center not found")
    return rows[0]


@app.get("/api/farmers")
def farmers(include_inactive: bool = Query(False, alias="includeInactive")):
    return _rows("""select f.*, case when f.aadhaar_last4 <> '' then 'XXXX XXXX ' || f.aadhaar_last4 else '' end as aadhaar_masked
                    from farmers f where center_id = :c and (active or :all) order by code""", c=_center(), all=include_inactive)


@app.get("/api/farmers/{farmer_id}")
def farmer(farmer_id: str):
    rows = _rows("select * from farmers where center_id = :c and id = :id", c=_center(), id=farmer_id)
    if not rows:
        raise HTTPException(404, "farmer not found")
    f = rows[0]
    bal = _rows("""select
        coalesce((select sum(a.amount_paise) from advances a where a.farmer_id = :id), 0)
          - coalesce((select sum(r.amount_paise) from advance_recoveries r join bills b on b.id = r.bill_id
                      where b.farmer_id = :id and b.status = 'final'), 0)               as advance_outstanding_paise,
        coalesce((select sum(m.amount_paise) from feed_moves m where m.farmer_id = :id and m.type = 'sale' and m.bill_id is null), 0)
                                                                                         as feed_unbilled_paise,
        coalesce((select sum(b.payable_paise - b.paid_paise) from bills b where b.farmer_id = :id and b.status = 'final'), 0)
                                                                                         as unpaid_paise""", id=farmer_id)[0]
    return {**f, "balances": bal}


@app.get("/api/collections")
def collections(day: date | None = Query(None, alias="date"), shift: str | None = None, farmer_id: str | None = Query(None, alias="farmerId"),
                date_from: date | None = Query(None, alias="from"), date_to: date | None = Query(None, alias="to")):
    if not (day or date_from or farmer_id):
        raise HTTPException(400, "give date, from/to or farmerId")
    return _rows("""select * from collections where center_id = :c and not void
        and (cast(:day as date) is null or date = :day) and (cast(:shift as text) is null or shift = :shift)
        and (cast(:fid as text) is null or farmer_id = :fid)
        and (cast(:f as date) is null or date >= :f) and (cast(:t as date) is null or date <= :t)
        order by date, shift, farmer_id, milk_type""", c=_center(), day=day, shift=shift, fid=farmer_id, f=date_from, t=date_to)


@app.get("/api/bills")
def bills(cycle_id: str | None = Query(None, alias="cycleId"), farmer_id: str | None = Query(None, alias="farmerId")):
    return _rows("""select b.*, f.code as farmer_code, f.name as farmer_name from bills b join farmers f on f.id = b.farmer_id
        where b.center_id = :c and (cast(:cy as text) is null or b.cycle_id = :cy) and (cast(:fid as text) is null or b.farmer_id = :fid)
        order by b.start_date desc, f.code""", c=_center(), cy=cycle_id, fid=farmer_id)


@app.get("/api/summary")
def summary(day: date = Query(..., alias="date")):
    """One day by shift and milk type: entries, litres, amount, litre-weighted Fat/SNF (×100)."""
    return _rows("""select shift, milk_type, count(*) as entries, sum(litres_x100) as litres_x100, sum(amount_paise) as amount_paise,
            round(sum(fat_x10 * litres_x100) * 10.0 / sum(litres_x100)) as avg_fat_x100,
            round(sum(snf_x10 * litres_x100) * 10.0 / sum(litres_x100)) as avg_snf_x100
        from collections where center_id = :c and not void and date = :d group by shift, milk_type order by shift desc, milk_type""",
                 c=_center(), d=day)
