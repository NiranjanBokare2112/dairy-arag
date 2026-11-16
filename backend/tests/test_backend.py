"""Backend tests — run against the TEST database (TEST_DATABASE_URL), never the main one.

    cd backend && python -m pytest -q

The test database is rebuilt from db/schema.sql and loaded with scripts/db/sample-data.json once per run.
"""
import os

os.environ["ARAG_DB"] = "test"  # before importing the app

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.cli import DEFAULT_SAMPLE
from app.db import TABLES, engine
from app.loader import apply_schema, load_file
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def sample_db():
    eng = engine("test")
    assert eng.url.database.endswith("_test"), "tests must only run on a *_test database"
    with eng.begin() as c:
        c.exec_driver_sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        apply_schema(c)
    report = load_file(DEFAULT_SAMPLE, target="test")
    return report


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


def test_loader_inserts_every_table(sample_db):
    assert set(sample_db["inserted"]) == set(TABLES)
    assert sample_db["inserted"]["collections"] > 400


def test_health(client):
    h = client.get("/api/health").json()
    assert h["ok"] and not h["missingTables"]


def test_farmers_never_expose_secrets(client):
    fs = client.get("/api/farmers").json()
    assert len(fs) == 12
    for f in fs:
        assert not {"pinHash", "aadhaarEnc", "tokenHash"} & set(f)
    import re
    assert all(re.fullmatch(r"XXXX XXXX \d{4}", f["aadhaarMasked"]) for f in fs)  # only the last 4 digits ever leave the database


def test_amounts_follow_the_rounding_rule():
    with engine("test").connect() as c:
        bad = c.execute(text("select count(*) from collections where amount_paise <> (litres_x100 * rate_paise + 50) / 100")).scalar()
        bills = c.execute(text("""select count(*) from bills b where gross_paise <>
                                  (select sum(amount_paise) from collections c where c.bill_id = b.id and not c.void)""")).scalar()
    assert bad == 0 and bills == 0


def test_bill_paid_is_kept_by_the_payment_trigger(client):
    bills = client.get("/api/bills").json()
    with engine("test").connect() as c:
        sums = dict(c.execute(text("select bill_id, sum(amount_paise) from payments where not void group by bill_id")).all())
    for b in bills:
        assert b["paidPaise"] == sums.get(b["id"], 0)


def test_collections_need_a_filter(client):
    assert client.get("/api/collections").status_code == 400
    assert client.get("/api/farmers/does-not-exist").status_code == 404


def _rejected(sql: str, **p) -> bool:
    """True if the database refuses the write (the transaction is always rolled back)."""
    with engine("test").connect() as c:
        tx = c.begin()
        try:
            c.execute(text(sql), p)
            return False
        except DBAPIError:
            return True
        finally:
            tx.rollback()


def test_database_guards():
    with engine("test").connect() as c:
        locked = c.execute(text("select id from collections where bill_id is not null limit 1")).scalar()
        dup = c.execute(text("select * from collections where not void and bill_id is null limit 1")).mappings().one()
        final_bill = c.execute(text("select id, farmer_id from bills where status = 'final' and paid_paise < payable_paise limit 1")).one()
    assert _rejected("update collections set litres_x100 = litres_x100 + 10 where id = :id", id=locked)         # finalized period
    assert _rejected("delete from collections where id = :id", id=dup["id"])                                     # never deleted
    assert _rejected("""insert into collections (id, center_id, farmer_id, date, shift, milk_type, litres_x100, fat_x10, snf_x10,
                        chart_id, rate_paise, amount_paise, created_by) values ('dup-1', :c, :f, :d, :s, :m, 500, 40, 85, :ch, 3000, 15000, :u)""",
                     c=dup["center_id"], f=dup["farmer_id"], d=dup["date"], s=dup["shift"], m=dup["milk_type"], ch=dup["chart_id"], u=dup["created_by"])
    assert _rejected("update bills set gross_paise = gross_paise + 1 where id = :id", id=final_bill[0])           # final bill locked
    assert _rejected("""insert into payments (center_id, bill_id, farmer_id, date, mode, amount_paise, upi_ref, created_by)
                        values ('arag', :b, :f, '2026-11-09', 'upi', 100, '', 'u-owner')""", b=final_bill[0], f=final_bill[1])  # UPI needs UTR
    assert _rejected("update audit_log set action = 'x' where id = 1")                                          # append-only
    assert _rejected("delete from audit_log where id = 1")


# ---- farmer login by code (D-47) ---------------------------------------------------------------
def test_farmer_login_and_own_details(client):
    r = client.post("/api/farmer/login", json={"code": 101})
    assert r.status_code == 200
    tok = r.json()["token"]
    me = client.get("/api/farmer/me", headers={"Authorization": f"Bearer {tok}"}).json()
    assert me["farmer"]["code"] == 101 and me["farmer"]["milkTypes"] == ["cow"]
    assert me["farmer"]["mobileMasked"].count("X") == 6 and "mobile" not in me["farmer"] and "upiId" not in me["farmer"]
    with engine("test").connect() as c:  # advance given − instalments recovered on final bills
        want = c.execute(text("""select coalesce((select sum(amount_paise) from advances where farmer_id = 'f101'), 0)
            - coalesce((select sum(r.amount_paise) from advance_recoveries r join bills b on b.id = r.bill_id where b.farmer_id = 'f101' and b.status = 'final'), 0)""")).scalar()
    assert me["balances"]["advanceOutstandingPaise"] == want > 0
    assert all(b["token"] for b in me["bills"] if b["status"] == "final")
    assert me["summary"]["litresX100"] > 0 and isinstance(me["farmer"]["hasWhatsapp"], bool)
    assert me["range"]["days"] == 30 and len(me["trend"]) == 30
    assert me["summary"]["litresX100"] == sum(e["litresX100"] for e in me["entries"]) == sum(x["litresX100"] for x in me["trend"])
    h = {"Authorization": f"Bearer {tok}"}
    every = client.get("/api/farmer/me?all=true", headers=h).json()
    assert every["range"]["from"] == every["firstDate"] and len(every["entries"]) >= len(me["entries"])
    one = client.get(f"/api/farmer/me?from={every['firstDate']}&to={every['firstDate']}", headers=h).json()
    assert one["range"]["days"] == 1 and all(e["date"] == every["firstDate"] for e in one["entries"])
    assert client.get("/api/farmer/me?from=2026-01-01&to=2099-01-01", headers=h).json()["range"]["to"] <= every["range"]["to"]
    with engine("test").connect() as c:
        assert c.execute(text("select count(*) from sessions where token_hash = :t"), {"t": tok}).scalar() == 0, "raw token never stored"
        assert c.execute(text("select count(*) from audit_log where action = 'login' and entity = 'farmer' and farmer_id = 'f101'")).scalar() >= 1
    assert client.post("/api/farmer/logout", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    assert client.get("/api/farmer/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_farmer_login_refuses_bad_codes_and_rate_limits(client):
    assert client.get("/api/farmer/me").status_code == 401
    assert client.get("/api/farmer/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401
    codes = [client.post("/api/farmer/login", json={"code": c}).status_code for c in ["999", "abc", "-1", "0"] + [str(900 + i) for i in range(6)]]
    assert codes == [404] * 10
    assert client.post("/api/farmer/login", json={"code": 101}).status_code == 429  # 10 wrong codes → paused


# ---- daily milk buyers (migration 001, D-51) -------------------------------------------------------
def test_buyer_tables_loaded_and_consistent():
    with engine("test").connect() as c:
        q = lambda s: c.execute(text(s)).scalar()
        assert q("select count(*) from milk_buyers") == 6 and q("select count(*) from buyer_sales") > 500
        assert q("select count(*) from buyer_sales where amount_paise <> (litres_x100 * rate_paise + 50) / 100") == 0
        assert q("select count(*) from schema_migrations where name = '001_milk_buyers.sql'") == 1


def test_buyer_guards():
    with engine("test").connect() as c:
        closed = c.execute(text("select s.id, s.buyer_id, s.date from buyer_sales s join buyer_months m on m.month = to_char(s.date, 'YYYY-MM') limit 1")).one()
        open_sale = c.execute(text("""select s.* from buyer_sales s where not exists (select 1 from buyer_months m where m.month = to_char(s.date, 'YYYY-MM')) limit 1""")).mappings().one()
        pay = c.execute(text("select id from buyer_payments limit 1")).scalar()
    assert _rejected("update buyer_sales set litres_x100 = litres_x100 + 50, amount_paise = ((litres_x100 + 50) * rate_paise + 50) / 100 where id = :id", id=closed[0])  # closed month
    assert _rejected("delete from buyer_sales where id = :id", id=closed[0])
    assert _rejected("update buyer_sales set amount_paise = amount_paise + 1 where id = :id", id=open_sale["id"])          # amount must follow the rate
    assert _rejected("""insert into buyer_sales (id, center_id, buyer_id, date, shift, milk_type, litres_x100, rate_paise, amount_paise, created_by)
                        values ('dup-b', 'arag', :b, :d, :s, :m, 100, 5000, 5000, 'u-op1')""", b=open_sale["buyer_id"], d=open_sale["date"], s=open_sale["shift"], m=open_sale["milk_type"])  # once per shift
    assert _rejected("delete from buyer_payments where id = :id", id=pay)                                                 # never deleted
    assert _rejected("""insert into buyer_payments (center_id, buyer_id, date, mode, amount_paise, created_by) values ('arag', 'g1', '2026-11-09', 'upi', 100, 'u-owner')""")  # UPI needs UTR
    assert not _rejected("update buyer_sales set litres_x100 = litres_x100 + 50, amount_paise = ((litres_x100 + 50) * rate_paise + 50) / 100 where id = :id", id=open_sale["id"])  # open month: fine


def test_counter_sales_loaded_and_guarded():
    """Walk-in (सुटी) sales, migration 002 (D-53)."""
    with engine("test").connect() as c:
        q = lambda s: c.execute(text(s)).scalar()
        assert q("select count(*) from counter_sales") > 100
        assert q("select count(*) from counter_sales where amount_paise <> (litres_x100 * rate_paise + 50) / 100") == 0
        assert q("select count(*) from schema_migrations where name = '002_counter_sales.sql'") == 1
        assert q("select counter_rate_cow_paise from centers where id = 'arag'") > 0
        closed = q("select s.id from counter_sales s join buyer_months m on m.month = to_char(s.date, 'YYYY-MM') limit 1")
        open_id = q("select s.id from counter_sales s where not exists (select 1 from buyer_months m where m.month = to_char(s.date, 'YYYY-MM')) and not s.void limit 1")
    assert _rejected("delete from counter_sales where id = :id", id=open_id)                                                   # never deleted
    assert _rejected("update counter_sales set litres_x100 = 50, amount_paise = (50 * rate_paise + 50) / 100 where id = :id", id=open_id)  # only void
    assert _rejected("update counter_sales set void = true, void_reason = 'x' where id = :id", id=closed)                     # closed month
    assert _rejected("update counter_sales set void = true where id = :id", id=open_id)                                       # void needs a reason
    assert _rejected("""insert into counter_sales (id, center_id, date, shift, milk_type, litres_x100, rate_paise, amount_paise, mode, created_by)
                        values ('cs-bad', 'arag', '2026-11-09', 'morning', 'cow', 25, 6000, 1600, 'cash', 'u-op1')""")      # ¼ L of ₹60 is ₹15
    assert not _rejected("""insert into counter_sales (id, center_id, date, shift, milk_type, litres_x100, rate_paise, amount_paise, mode, created_by)
                        values ('cs-ok', 'arag', '2026-11-09', 'morning', 'cow', 25, 6000, 1500, 'upi', 'u-op1')""")        # UPI ref optional
    assert not _rejected("update counter_sales set void = true, void_reason = 'चूक' where id = :id", id=open_id)


def test_schemes_notices_and_entry_messages():
    """Migration 003: schemes (D-71), notices (D-72), one message per milk entry (D-73)."""
    with engine("test").connect() as c:
        q = lambda s, **k: c.execute(text(s), k).scalar()
        assert q("select count(*) from schema_migrations where name = '003_schemes_notices_entry_messages.sql'") == 1
        e1 = q("select id from collections where not void and farmer_id in (select id from farmers where mobile <> '') order by date desc limit 1")
        f1 = q("select farmer_id from collections where id = :i", i=e1)
        mob = q("select mobile from farmers where id = :f", f=f1)
    def q2(sql, **k):
        with engine("test").connect() as c:
            return c.execute(text(sql), k).scalar()
    # schemes
    assert not _rejected("insert into schemes (center_id, title, summary, link) values ('arag', 'योजना', 'माहिती', 'https://example.gov.in/a')")
    assert _rejected("insert into schemes (center_id, title, summary) values ('arag', ' ', 'माहिती')")                 # name required
    assert _rejected("insert into schemes (center_id, title, summary, link) values ('arag', 'x', 'y', 'not a link')")   # bad link
    # notices (one committed row to test against; _rejected always rolls back)
    with engine("test").begin() as c:
        c.execute(text("insert into broadcasts (id, center_id, text, audience, created_by) values ('bc-1', 'arag', 'उद्या संकलन ८ वाजता', 'all', 'u-owner')"))
        c.execute(text("""insert into outbox_messages (center_id, farmer_id, kind, date, channel, to_mobile, body_json, collection_id)
                          values ('arag', :f, 'pour', '2026-11-10', 'whatsapp', :m, '{}'::jsonb, :c)"""), {"f": f1, "m": mob, "c": e1})
    assert _rejected("insert into broadcasts (center_id, text, audience, sms, created_by) values ('arag', :t, 'all', true, 'u-owner')", t="x" * 141)  # SMS ≤ 140
    assert _rejected("insert into broadcasts (center_id, text, audience, created_by) values ('arag', 'x', 'codes', 'u-owner')")                    # codes needed
    # per-entry messages: the same entry twice is refused; another entry of the same farmer on the same day is fine
    ins = """insert into outbox_messages (center_id, farmer_id, kind, date, channel, to_mobile, body_json, collection_id)
             values ('arag', :f, 'pour', '2026-11-10', 'whatsapp', :m, '{}'::jsonb, :c)"""
    assert _rejected(ins, f=f1, m=mob, c=e1)                                                                            # same entry twice
    other = q2("select id from collections where farmer_id = :f and id <> :e and not void limit 1", f=f1, e=e1)
    assert not _rejected(ins, f=f1, m=mob, c=other)                                                                    # second pour, same day
    assert _rejected("""insert into outbox_messages (center_id, farmer_id, kind, date, channel, to_mobile, body_json)
                        values ('arag', :f, 'pour', '2026-11-10', 'whatsapp', :m, '{}'::jsonb)""", f=f1, m=mob)          # pour needs its entry
    assert _rejected("""insert into outbox_messages (center_id, farmer_id, kind, date, channel, to_mobile, body_json, broadcast_id, no_sms)
                        values ('arag', :f, 'notice', '2026-11-10', 'sms', :m, '{}'::jsonb, 'bc-1', true)""", f=f1, m=mob)  # no_sms notice can't be SMS
    assert not _rejected("""insert into outbox_messages (center_id, farmer_id, kind, date, channel, to_mobile, body_json, broadcast_id, no_sms)
                        values ('arag', :f, 'notice', '2026-11-10', 'whatsapp', :m, '{}'::jsonb, 'bc-1', true)""", f=f1, m=mob)
    assert _rejected("update broadcasts set text = 'बदल' where id = 'bc-1'")                                             # notices are kept as sent
    assert _rejected("delete from broadcasts where id = 'bc-1'")                                                         # notices are kept



# ---------------------------------------------------------------------------------------------------------------
# WhatsApp (D-75): Meta's API is faked with httpx.MockTransport — nothing leaves this PC.
import hashlib
import hmac
import json as _json

import httpx

from app import whatsapp as wa


def _wa_env(monkeypatch, allowed, live=False):
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "111"); monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "tok-test")
    monkeypatch.setenv("WHATSAPP_ALLOWED_NUMBERS", ",".join(allowed)); monkeypatch.setenv("WHATSAPP_LIVE", "1" if live else "0")
    monkeypatch.setenv("WHATSAPP_VERIFY_TOKEN", "verify-me"); monkeypatch.setenv("WHATSAPP_APP_SECRET", "app-secret")


def _queue(kind, farmer_id, mobile, *, collection_id=None, broadcast_id=None, no_sms=False, date="2026-11-12"):
    with engine("test").begin() as c:
        return c.execute(text("""insert into outbox_messages (center_id, farmer_id, kind, date, channel, to_mobile, body_json, collection_id, broadcast_id, no_sms)
                                 values ('arag', :f, :k, :d, 'whatsapp', :m, '{}'::jsonb, :c, :b, :n) returning id"""),
                         {"f": farmer_id, "k": kind, "d": date, "m": mobile, "c": collection_id, "b": broadcast_id, "n": no_sms}).scalar()


def _quiet_outbox():
    """The sample data has some messages still queued; mark them sent so each worker test sees only its own rows."""
    with engine("test").begin() as c:
        c.execute(text("update outbox_messages set status = 'sent', sent_at = now() where status in ('queued', 'deferred')"))


def _row(mid):
    with engine("test").connect() as c:
        return dict(c.execute(text("select * from outbox_messages where id = :i"), {"i": mid}).mappings().one())


def test_whatsapp_rupees():
    assert wa._rupees(145000) == "1,450.00" and wa._rupees(21952) == "219.52" and wa._rupees(12345678) == "1,23,456.78"


def test_whatsapp_worker_sends_saved_figures_only_to_allowed_numbers(monkeypatch):
    _quiet_outbox()
    with engine("test").connect() as c:
        rows = c.execute(text("""select c.id, c.farmer_id, f.mobile, f.name, c.litres_x100, c.fat_x10, c.snf_x10, c.amount_paise
                                 from collections c join farmers f on f.id = c.farmer_id where not c.void and f.mobile <> ''
                                   and not exists (select 1 from outbox_messages o where o.collection_id = c.id)
                                 order by c.date desc limit 40""")).mappings().all()
    a = rows[0]; b = next(r for r in rows if r["mobile"] != a["mobile"])
    _wa_env(monkeypatch, [a["mobile"]])
    seen = []
    def handler(req):
        seen.append(req)
        return httpx.Response(200, json={"messages": [{"id": "wamid.TEST1"}]})
    monkeypatch.setattr(wa, "_transport", httpx.MockTransport(handler))
    ok_id = _queue("pour", a["farmer_id"], a["mobile"], collection_id=a["id"])
    blocked_id = _queue("pour", b["farmer_id"], b["mobile"], collection_id=b["id"])
    rep = wa.send_due(target="test")
    assert rep["sent"] == 1 and rep["notAllowed"] >= 1
    sent = _json.loads(seen[0].content)
    assert sent["to"] == "91" + a["mobile"] and sent["template"]["name"] == "milk_entry_mr_v1"
    vals = [p["text"] for p in sent["template"]["components"][0]["parameters"]]
    assert vals[0] == a["name"] and vals[4] == wa._x100(a["litres_x100"]) and vals[8] == wa._rupees(a["amount_paise"])
    assert seen[0].headers["authorization"] == "Bearer tok-test"
    r = _row(ok_id); assert r["status"] == "sent" and r["provider_message_id"] == "wamid.TEST1"
    assert _row(blocked_id)["status"] == "queued"  # never sent to a number that isn't allowed


def test_whatsapp_failures_fallback_and_stop(monkeypatch):
    _quiet_outbox()
    with engine("test").connect() as c:
        a = c.execute(text("""select c.id, c.farmer_id, f.mobile from collections c join farmers f on f.id = c.farmer_id
                              where not c.void and f.mobile <> '' and not exists (select 1 from outbox_messages o where o.collection_id = c.id)
                              order by c.date limit 1""")).mappings().one()
    _wa_env(monkeypatch, [a["mobile"]])
    with engine("test").begin() as c:
        c.execute(text("insert into broadcasts (id, center_id, text, audience, created_by) values ('bc-wa', 'arag', 'उद्या संकलन\nबंद', 'all', 'u-owner')"))
    code = {"v": 131026}
    monkeypatch.setattr(wa, "_transport", httpx.MockTransport(lambda req: httpx.Response(400, json={"error": {"code": code["v"], "message": "x"}})))
    pour = _queue("pour", a["farmer_id"], a["mobile"], collection_id=a["id"], date="2026-11-13")
    notice = _queue("notice", a["farmer_id"], a["mobile"], broadcast_id="bc-wa", no_sms=True, date="2026-11-13")
    wa.send_due(target="test")
    p, n = _row(pour), _row(notice)
    assert p["channel"] == "sms" and p["fell_back"] and p["status"] == "queued"         # not on WhatsApp → SMS
    assert n["channel"] == "whatsapp" and n["status"] == "failed"                       # notice not allowed on SMS
    # a setup problem (expired token) stops the run without touching the farmers' messages
    code["v"] = 190
    again = _queue("pour", a["farmer_id"], a["mobile"], collection_id=a["id"], date="2026-11-14")
    rep = wa.send_due(target="test")
    assert rep["stopped"].startswith("190") and _row(again)["attempts"] == 0 and _row(again)["status"] == "queued"


def test_whatsapp_webhook(monkeypatch, client):
    _wa_env(monkeypatch, [])
    assert client.get("/api/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42"}).text == "42"
    assert client.get("/api/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42"}).status_code == 403
    with engine("test").connect() as c:
        mid = c.execute(text("select id from outbox_messages where provider_message_id = 'wamid.TEST1'")).scalar()
    body = _json.dumps({"entry": [{"changes": [{"value": {"statuses": [{"id": "wamid.TEST1", "status": "delivered"}]}}]}]}).encode()
    assert client.post("/api/whatsapp/webhook", content=body).status_code == 403                       # unsigned: refused
    sig = "sha256=" + hmac.new(b"app-secret", body, hashlib.sha256).hexdigest()
    r = client.post("/api/whatsapp/webhook", content=body, headers={"X-Hub-Signature-256": sig})
    assert r.status_code == 200 and r.json()["delivered"] == 1
    assert _row(mid)["status"] == "delivered"


def test_dairy_rate_charts():
    """Migration 004 (D-80): farmer and dairy charts; entries are priced with farmer charts only."""
    with engine("test").connect() as c:
        q = lambda s, **k: c.execute(text(s), k).scalar()
        assert q("select count(*) from rate_charts where side = 'dairy'") >= 2
        assert q("select count(*) from collections c join rate_charts r on r.id = c.chart_id where r.side <> 'farmer'") == 0
        dairy = q("select id from rate_charts where side = 'dairy' limit 1")
        entry = q("select id from collections where not void limit 1")
        disp = q("select id from dispatches limit 1")
        farmer_chart = q("select id from rate_charts where side = 'farmer' limit 1")
    assert _rejected("update collections set chart_id = :d where id = :e", d=dairy, e=entry)          # never priced with the dairy chart
    assert _rejected("insert into rate_charts (center_id, side, milk_type, effective_from, fat_min_x10, fat_max_x10, snf_min_x10, snf_max_x10, created_by) values ('arag', 'shop', 'cow', '2026-11-01', 30, 60, 75, 95, 'u-owner')")
    assert _rejected("update dispatches set dairy_chart_id = :f where id = :i", f=farmer_chart, i=disp)  # must be a dairy chart
    assert not _rejected("update dispatches set dairy_chart_id = :d where id = :i", d=dairy, i=disp)


def test_doctors_table():
    """Migration 005 (D-83): doctors shown to farmers and on the website."""
    with engine("test").connect() as c:
        assert c.execute(text("select count(*) from doctors")).scalar() >= 2
    assert _rejected("insert into doctors (center_id, name) values ('arag', ' ')")                                  # name required
    assert _rejected("insert into doctors (center_id, name, mobile) values ('arag', 'डॉ. x', '12345')")             # bad mobile
    assert _rejected("insert into doctors (center_id, name, kind) values ('arag', 'डॉ. x', 'ayurved')")            # govt / private only
    assert not _rejected("insert into doctors (center_id, name, mobile, emergency) values ('arag', 'डॉ. x', '9876543210', true)")


def test_dashboard_operator_tabs_buyer_billing():
    """Migration 006 (D-85, D-86, D-87)."""
    with engine("test").connect() as c:
        q = lambda s, **k: c.execute(text(s), k).scalar()
        assert q("select count(*) from milk_buyers where start_date is null") == 0
        assert q("select count(*) from milk_buyers where bill_kind = 'day'") >= 1
        b = c.execute(text("select id, start_date from milk_buyers order by code limit 1")).mappings().one()
    assert _rejected("update users set pages = array['/collection','/billing'] where id = 'u-op1'")          # owner-only page
    assert _rejected("update users set pages = array['/collection'] where id = 'u-owner'")                    # owners have no limit
    assert not _rejected("update users set pages = array['/collection','/buyers'] where id = 'u-op1'")
    assert _rejected("update milk_buyers set bill_kind = 'day', bill_day = 31 where id = :i", i=b["id"])      # 1–28 only
    assert not _rejected("update milk_buyers set bill_kind = 'day', bill_day = 10 where id = :i", i=b["id"])
    assert _rejected("""insert into buyer_sales (id, center_id, buyer_id, date, shift, milk_type, litres_x100, rate_paise, amount_paise, created_by)
                        select 'pre', 'arag', id, start_date - 1, 'morning', milk_type, 100, rate_paise, rate_paise, 'u-op1' from milk_buyers where id = :i""", i=b["id"])  # before start
    assert not _rejected("update centers set dashboard = '{\"order\": [\"sales\"], \"off\": []}'::jsonb")



def test_scheme_details():
    """Migration 007 (D-92): longer scheme text and how_to; the sample carries the real Maharashtra schemes."""
    with engine("test").connect() as c:
        q = lambda s, **k: c.execute(text(s), k).scalar()
        assert q("select count(*) from schema_migrations where name = '007_scheme_details.sql'") == 1
        assert q("select count(*) from schemes where id = 'sch-cm-pashudhan-2026' and how_to <> ''") == 1
        assert q("select count(*) from schemes where title like '%(नमुना)'") == 0
    assert not _rejected("insert into schemes (center_id, title, summary, benefit, how_to) values ('arag', 'x', :s, :b, :h)", s="अ" * 800, b="ब" * 800, h="क" * 1000)
    assert _rejected("insert into schemes (center_id, title, summary) values ('arag', 'x', :s)", s="अ" * 801)
    assert _rejected("insert into schemes (center_id, title, summary, how_to) values ('arag', 'x', 'y', :h)", h="क" * 1001)


def test_upi_payouts():
    """Migration 008 (D-107): payout tables, payout payments before the bill, farmer's payment choice, overpaid bills."""
    with engine("test").connect() as c:
        q = lambda s, **k: c.execute(text(s), k).scalar()
        assert q("select count(*) from schema_migrations where name = '008_upi_payouts.sql'") == 1
        assert q("select count(*) from payouts where kind = 'verify' and status = 'success'") >= 5
        assert q("select count(*) from payout_runs where status = 'sent'") == 1
        # a payout paid milk of the open period: the payment has a period, no bill yet
        assert q("select count(*) from payments where source = 'payout' and bill_id is null and cycle_id is not null") >= 1
        f = q("select id from farmers where code = 106")
        b = q("select id from bills where status = 'final' order by end_date desc limit 1")
        po = q("select id from payouts where kind = 'payout' and status = 'success' limit 1")
    # farmer's choice: a fixed date needs a day 1..28; other choices none
    assert _rejected("update farmers set pay_kind = 'day', pay_day = null where id = :f", f=f)
    assert _rejected("update farmers set pay_kind = 'day', pay_day = 31 where id = :f", f=f)
    assert _rejected("update farmers set pay_kind = 'weekly' where id = :f", f=f)
    assert not _rejected("update farmers set pay_kind = 'day', pay_day = 5 where id = :f", f=f)
    # a manual payment still needs a final bill; a payout payment needs a payout and a bill or a period
    assert _rejected("insert into payments (center_id, bill_id, farmer_id, date, mode, amount_paise, created_by) values ('arag', null, :f, current_date, 'cash', 100, 'u-owner')", f=f)
    assert _rejected("""insert into payments (center_id, farmer_id, date, mode, amount_paise, upi_ref, source, created_by)
                        values ('arag', :f, current_date, 'upi', 100, 'X1', 'payout', 'u-owner')""", f=f)   # no payout, no period
    # ₹1 check rows are exactly ₹1 and outside runs; a success needs a bank reference
    assert _rejected("insert into payouts (center_id, kind, date, farmer_id, upi_id, amount_paise, credit_paise, status, ref) values ('arag', 'verify', current_date, :f, 'a@b', 200, 200, 'success', 'R')", f=f)
    assert _rejected("insert into payouts (center_id, kind, date, farmer_id, upi_id, amount_paise, credit_paise, status) values ('arag', 'verify', current_date, :f, 'a@b', 100, 100, 'success')", f=f)
    # payments stay un-editable, except linking a payout payment to its bill once
    assert _rejected("update payments set amount_paise = amount_paise + 1 where source = 'payout'")
    assert _rejected("update payments set bill_id = :b where source = 'manual'", b=b)
    # overpaid: carry forward = shortfall + overpaid; paid may exceed payable only by the overpaid amount
    assert _rejected("update bills set overpaid_paise = 1 where id = :b", b=b)
    assert po


def test_change_requests():
    """Migration 009 (D-108): operator / farmer changes wait for the owner."""
    with engine("test").connect() as c:
        q = lambda s, **k: c.execute(text(s), k).scalar()
        assert q("select count(*) from schema_migrations where name = '009_change_requests.sql'") == 1
        assert q("select count(*) from change_requests where status = 'pending' and requested_by_kind = 'operator'") >= 1
        assert q("select count(*) from change_requests where status = 'approved' and requested_by_kind = 'farmer' and decided_by is not null") >= 1
        f = q("select id from farmers where code = 110")
    ins = "insert into change_requests (center_id, entity_id, requested_by, requested_by_kind, fields, status, decided_at, decided_by) values ('arag', :f, :by, :kind, cast(:fields as jsonb), :st, :at, :dby)"
    ok = dict(f=f, by="u-op1", kind="operator", fields='{"mobile": {"before": "", "after": "9822000110"}}', st="pending", at=None, dby=None)
    assert not _rejected(ins, **ok)
    assert _rejected(ins, **{**ok, "fields": "{}"})                                   # nothing asked
    assert _rejected(ins, **{**ok, "st": "approved"})                                 # decided needs a time and who
    assert _rejected(ins, **{**ok, "kind": "farmer", "by": "farmer:someone-else"})    # a farmer asks only for themselves


def test_help_tickets():
    """Migration 010 (D-109): tickets, conversation, Bokare alerts, support role, reply messages to farmers."""
    with engine("test").connect() as c:
        q = lambda s, **k: c.execute(text(s), k).scalar()
        assert q("select count(*) from schema_migrations where name = '010_help_tickets.sql'") == 1
        assert q("select count(*) from users where role = 'support'") == 1
        assert q("select count(*) from tickets") == 2
        assert q("select count(*) from ticket_notifications where channel = 'email'") >= 2
        assert q("select count(*) from outbox_messages where kind = 'support' and ticket_message_id is not null") == 1
        tk = q("select id from tickets where reporter_kind = 'farmer'")
        f = q("select reporter_farmer_id from tickets where id = :t", t=tk)
    ins = "insert into tickets (center_id, no, reporter_kind, reporter_user_id, reporter_farmer_id, reporter_name, category, subject) values ('arag', :no, :k, :u, :f, 'x', :cat, :s)"
    assert not _rejected(ins, no="T-0099", k="farmer", u=None, f=f, cat="milk", s="विषय")
    assert _rejected(ins, no="T-0099", k="farmer", u="u-op1", f=f, cat="milk", s="विषय")      # a farmer's ticket has no staff user
    assert _rejected(ins, no="X-1", k="operator", u="u-op1", f=None, cat="milk", s="विषय")     # number format
    assert _rejected(ins, no="T-0098", k="operator", u="u-op1", f=None, cat="tea", s="विषय")   # category
    assert _rejected("insert into ticket_messages (ticket_id, author_kind, author_name, text, status) values (:t, 'support', 'B', 'hi', 'resolved')", t=tk)  # text or status, not both
    assert _rejected("insert into outbox_messages (center_id, farmer_id, kind, date, channel, to_mobile, body_json) values ('arag', :f, 'support', current_date, 'sms', '9822000000', '{}'::jsonb)", f=f)  # needs the reply


def test_payout_flow():
    """Migration 011 (D-110, D-111): UPI / bank, per-farmer approval, gateway statuses, unique references, payout messages."""
    with engine("test").connect() as c:
        q = lambda s, **k: c.execute(text(s), k).scalar()
        assert q("select count(*) from schema_migrations where name = '011_payout_flow.sql'") == 1
        assert q("select count(*) from payouts where kind = 'payout' and status = 'success' and txn_ref is not null and breakdown is not null") >= 1
        assert q("select count(*) from farmers where pay_approval") >= 1
        assert q("select count(*) from farmers where deduction_consent_at is not null and deduction_consent_by is not null") >= 1
        assert q("select count(*) from outbox_messages where kind = 'payout' and payout_status = 'success'") >= 1
        po = q("select id from payouts where kind = 'payout' and status = 'success' limit 1")
        ref = q("select txn_ref from payouts where id = :p", p=po)
        f = q("select id from farmers where code = 110")
    assert _rejected("update farmers set pay_method = 'cash' where id = :f", f=f)
    assert _rejected("update farmers set deduction_consent_at = now() where id = :f", f=f)               # needs who recorded it
    assert _rejected("update payouts set status = 'rejected' where id = :p", p=po)                        # a rejection needs a reason and who
    assert _rejected("update payouts set status = 'reversed' where id = :p", p=po)                        # a reversal needs its time
    assert not _rejected("update payouts set status = 'reversed', reversed_at = now() where id = :p", p=po)
    assert _rejected("""insert into payouts (center_id, run_id, kind, date, farmer_id, upi_id, amount_paise, credit_paise, status, txn_ref)
                        select center_id, run_id, kind, date, farmer_id, upi_id, amount_paise, credit_paise, 'processing', :r from payouts where id = :p""", r=ref, p=po)  # same reference twice


def test_farmer_english_name():
    """Migration 012 (D-118): English names (filled in for every farmer), learned name words on the centre."""
    with engine("test").connect() as c:
        q = lambda s, **k: c.execute(text(s), k).scalar()
        assert q("select count(*) from schema_migrations where name = '012_farmer_english_name.sql'") == 1
        assert q("select count(*) from farmers where name_en = ''") == 0
        assert q("select name_en from farmers where code = 103") == "Vitthal Mane"
        f = q("select id from farmers where code = 110")
    assert _rejected("update farmers set name_en = 'माने' where id = :f", f=f)          # English box: no Marathi letters
    assert not _rejected("update centers set name_words = '{\"jamdade\": \"जामदाडे\"}'::jsonb")



def test_expenses():
    """Migration 014 (D-126): expense types and expenses load; amounts, monthly period and removal reason are checked."""
    with engine("test").connect() as c:
        q = lambda s, **k: c.execute(text(s), k).scalar()
        assert q("select count(*) from schema_migrations where name = '014_expenses.sql'") == 1
        assert q("select count(*) from expense_categories") >= 9
        assert q("select count(*) from expenses where period = 'month'") > 0
        assert q("select msg_cost_paise from centers limit 1") == 13
        e = q("select id from expenses limit 1")
    assert _rejected("update expenses set amount_paise = 0 where id = :e", e=e)            # money must be > 0
    assert _rejected("update expenses set period = 'week' where id = :e", e=e)             # once | month only
    assert _rejected("update expenses set void = true, voided_at = now() where id = :e", e=e)  # removing needs a reason
    assert not _rejected("update expenses set void = true, voided_at = now(), void_reason = 'दोनदा नोंदले' where id = :e", e=e)
