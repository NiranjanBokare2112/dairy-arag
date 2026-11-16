"""Farmer login by code (D-47 — the owner chose code only, no PIN) and the farmer's own read-only details.

POST /api/farmer/login {"code": 101}  → {"token": "...", "expiresAt": "...", "farmer": {...}}
GET  /api/farmer/me     (Authorization: Bearer <token>) → profile (mobile/UPI masked), today, last 30 days,
                        open bill period, last 7 bills, balances.
POST /api/farmer/logout (Authorization: Bearer <token>)

Safeguards that don't slow the farmer down: read-only; session token stored only as a SHA-256 hash and valid
12 hours; 10 wrong codes from one address in 10 minutes → 429 for the rest of the window; every login, wrong
code and logout is written to audit_log; secrets (pin_hash, aadhaar_enc, token_hash) never leave the server.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import secrets
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text

from .config import get_settings
from .db import engine

router = APIRouter(prefix="/api/farmer", tags=["farmer"])
SESSION_HOURS = 12
MAX_FAILED, WINDOW_MIN = 10, 10


class LoginIn(BaseModel):
    code: int | str


def _ip(request: Request) -> str | None:
    host = request.client.host if request.client else None
    try:
        return str(ipaddress.ip_address(host)) if host else None
    except ValueError:  # e.g. the test client's "testclient"
        return None


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _mask_mobile(m: str) -> str:
    return m[:2] + "XXXXXX" + m[-2:] if m and len(m) >= 10 else ""


def _mask_upi(u: str) -> str:
    if not u:
        return ""
    name, _, dom = u.partition("@")
    return name[:2] + "•••" + ("@" + dom if dom else "")


def _audit(c, action: str, entity_id: str | None, after: dict, ip: str | None, farmer_id: str | None = None):
    c.execute(text("""insert into audit_log (center_id, user_id, farmer_id, action, entity, entity_id, after_json, ip)
                      values (:c, null, :f, :a, 'farmer', :e, cast(:j as jsonb), cast(:ip as inet))"""),
              {"c": get_settings().center_id, "f": farmer_id, "a": action, "e": entity_id, "j": json.dumps(after, ensure_ascii=False), "ip": ip})


@router.post("/login")
def login(body: LoginIn, request: Request, user_agent: str | None = Header(None)):
    center, ip = get_settings().center_id, _ip(request)
    code = str(body.code).strip()
    with engine().begin() as c:
        fails = c.execute(text("""select count(*) from audit_log where center_id = :c and action = 'farmer-login-failed'
                                  and at > now() - make_interval(mins => :w) and ip is not distinct from cast(:ip as inet)"""),
                          {"c": center, "w": WINDOW_MIN, "ip": ip}).scalar()
        if fails >= MAX_FAILED:
            raise HTTPException(429, detail={"code": "too-many-attempts"})
        f = None
        if code.isdigit() and 0 < int(code) < 2**31:
            f = c.execute(text("select id, code, name from farmers where center_id = :c and code = :code and active"),
                          {"c": center, "code": int(code)}).mappings().first()
        if f:
            token = secrets.token_urlsafe(32)
            expires = datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)
            c.execute(text("""insert into sessions (center_id, farmer_id, token_hash, expires_at, user_agent, ip)
                              values (:c, :f, :h, :exp, :ua, cast(:ip as inet))"""),
                      {"c": center, "f": f["id"], "h": _hash(token), "exp": expires, "ua": (user_agent or "")[:300], "ip": ip})
            _audit(c, "login", f["id"], {"code": f["code"], "name": f["name"]}, ip, f["id"])
        else:
            # record the wrong code and COMMIT it (raising inside the transaction would roll it back,
            # and then wrong codes would never be counted or shown in the audit log)
            _audit(c, "farmer-login-failed", code[:12], {"code": code[:12], "ua": (user_agent or "")[:200]}, ip)
    if not f:
        raise HTTPException(404, detail={"code": "farmer-code-not-found"})
    return {"token": token, "expiresAt": expires.isoformat(), "farmer": {"id": f["id"], "code": f["code"], "name": f["name"]}}


def _farmer_from(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail={"code": "unauthenticated"})
    with engine().begin() as c:
        row = c.execute(text("""update sessions set last_seen_at = now()
                                where token_hash = :h and farmer_id is not null and logout_at is null and expires_at > now()
                                returning farmer_id"""), {"h": _hash(authorization[7:].strip())}).first()
    if not row:
        raise HTTPException(401, detail={"code": "unauthenticated"})
    return row[0]


@router.post("/logout")
def logout(request: Request, authorization: str | None = Header(None)):
    fid = _farmer_from(authorization)
    with engine().begin() as c:
        c.execute(text("update sessions set logout_at = now() where token_hash = :h"), {"h": _hash(authorization[7:].strip())})
        _audit(c, "logout", fid, {}, _ip(request), fid)
    return {"ok": True}


def _camel(d: dict) -> dict:
    out = {}
    for k, v in d.items():
        head, *rest = k.split("_")
        key = head + "".join(w.capitalize() for w in rest)
        out[key] = v.isoformat() if hasattr(v, "isoformat") else (int(v) if isinstance(v, Decimal) and v == v.to_integral_value() else v)
    return out


@router.get("/me")
def me(authorization: str | None = Header(None), date_from: date | None = Query(None, alias="from"),
       date_to: date | None = Query(None, alias="to"), all_dates: bool = Query(False, alias="all")):
    """The farmer's own details. Dates (D-48): default the last 30 days; ?from=&to= a range (never past today);
    ?all=true since the farmer's first entry. Today, balances and the open period are always "now"."""
    fid = _farmer_from(authorization)
    with engine().connect() as c:
        q = lambda sql, **p: [_camel(dict(r)) for r in c.execute(text(sql), {"f": fid, **p}).mappings()]
        f = q("""select id, code, name, village, mobile, upi_id, has_whatsapp, milk_cow, milk_buffalo, aadhaar_last4 from farmers where id = :f""")[0]
        center = q("""select name, mobile, morning_from, morning_to, evening_from, evening_to, cycle_days, cycle_anchor from centers where id = :c""", c=get_settings().center_id)[0]
        today = c.execute(text("select (now() at time zone 'Asia/Kolkata')::date")).scalar()
        first = c.execute(text("select min(date) from collections where farmer_id = :f and not void"), {"f": fid}).scalar() or today
        if all_dates:
            a, b = first, today
        else:
            b = min(date_to or today, today)
            a = date_from or (b - timedelta(days=29))
            if a > b:
                a, b = b, a
        entries = q("""select date, shift, milk_type, litres_x100, fat_x10, snf_x10, rate_paise, amount_paise from collections
                       where farmer_id = :f and not void and date between :a and :b order by date desc, shift desc, milk_type""", a=a, b=b)
        summary = q("""select count(*) as entries, count(distinct date) as milk_days, coalesce(sum(litres_x100), 0) as litres_x100,
                        coalesce(sum(amount_paise), 0) as amount_paise,
                        coalesce(round(sum(litres_x100) * 1.0 / nullif(count(distinct date), 0)), 0) as avg_per_day_x100,
                        coalesce(round(sum(fat_x10 * litres_x100) * 10.0 / nullif(sum(litres_x100), 0)), 0) as avg_fat_x100,
                        coalesce(round(sum(snf_x10 * litres_x100) * 10.0 / nullif(sum(litres_x100), 0)), 0) as avg_snf_x100
                      from collections where farmer_id = :f and not void and date between :a and :b""", a=a, b=b)[0]
        trend = q("""select d::date as date, coalesce(sum(c.litres_x100), 0) as litres_x100,
                        coalesce(sum(c.litres_x100) filter (where c.milk_type = 'cow'), 0) as cow_x100,
                        coalesce(sum(c.litres_x100) filter (where c.milk_type = 'buffalo'), 0) as buffalo_x100
                      from generate_series(cast(:a as date), cast(:b as date), interval '1 day') d
                      left join collections c on c.farmer_id = :f and not c.void and c.date = d::date
                      group by d order by d""", a=a, b=b)
        today_rows = q("""select date, shift, milk_type, litres_x100, fat_x10, snf_x10, rate_paise, amount_paise from collections
                          where farmer_id = :f and not void and date = :t order by shift desc, milk_type""", t=today)
        bills = q("""select b.id, b.bill_no, b.start_date, b.end_date, b.litres_x100, b.avg_fat_x100, b.avg_snf_x100, b.gross_paise,
                        b.feed_paise, b.advance_paise, b.previous_dues_paise, b.carry_forward_dues_paise, b.total_deduct_paise,
                        b.payable_paise, b.paid_paise, b.status, case when b.status = 'final' then b.token end as token,
                        (select max(p.date) from payments p where p.bill_id = b.id and not p.void) as last_payment_date,
                        (select p.mode from payments p where p.bill_id = b.id and not p.void order by p.date desc, p.created_at desc limit 1) as last_payment_mode
                      from bills b where b.farmer_id = :f and b.end_date >= :a and b.start_date <= :b order by b.start_date desc""", a=a, b=b)
        balances = q("""select
            coalesce((select sum(amount_paise) from advances where farmer_id = :f), 0)
              - coalesce((select sum(r.amount_paise) from advance_recoveries r join bills b on b.id = r.bill_id where b.farmer_id = :f and b.status = 'final'), 0)
                                                                                   as advance_outstanding_paise,
            coalesce((select sum(amount_paise) from feed_moves where farmer_id = :f and type = 'sale' and bill_id is null), 0) as feed_unbilled_paise,
            coalesce((select sum(payable_paise - paid_paise) from bills where farmer_id = :f and status = 'final'), 0) as unpaid_paise""")[0]
    profile = {"id": f["id"], "code": f["code"], "name": f["name"], "village": f["village"],
               "milkTypes": [m for m, on in (("cow", f["milkCow"]), ("buffalo", f["milkBuffalo"])) if on],
               "hasWhatsapp": f["hasWhatsapp"], "mobileMasked": _mask_mobile(f["mobile"]), "upiMasked": _mask_upi(f["upiId"]),
               "aadhaarLast4": f["aadhaarLast4"]}
    return {"farmer": profile, "center": center, "today": today_rows, "balances": balances, "firstDate": first.isoformat(),
            "range": {"from": a.isoformat(), "to": b.isoformat(), "days": (b - a).days + 1, "all": all_dates},
            "summary": summary, "trend": trend, "entries": entries, "bills": bills}
