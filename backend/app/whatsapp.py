"""WhatsApp Cloud API (Meta) — the center's own account, no middleman (CLAUDE.md §3).

What is here:
  * templates      the Marathi message templates Meta must approve (TEMPLATES) and a submit / status command
  * send           one template message to one mobile number
  * worker         send_due(): takes due WhatsApp messages from outbox_messages, fills the approved template with
                   figures read from the database at send time, sends, and records the result (retry, SMS fallback)
  * webhook        Meta's delivery reports (sent / delivered / read / failed), see router below

SAFETY: until WHATSAPP_LIVE=1, messages go ONLY to numbers in WHATSAPP_ALLOWED_NUMBERS (the owner's own phones).
The demo / sample farmers have made-up mobiles that may belong to real strangers; nothing is sent to them.

.env keys:  WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN (secret), WHATSAPP_BUSINESS_ACCOUNT_ID,
            WHATSAPP_VERIFY_TOKEN (any random string, also typed in Meta's webhook setup), WHATSAPP_APP_SECRET (secret,
            Meta app → Settings → Basic), WHATSAPP_API_VERSION (default below), WHATSAPP_ALLOWED_NUMBERS, WHATSAPP_LIVE
The access token and app secret are never printed, logged or returned.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import text

from .db import engine

GRAPH = "https://graph.facebook.com"
DEFAULT_VERSION = "v23.0"  # Meta retires versions about 2 years after release; set WHATSAPP_API_VERSION to move on
LANG = "mr"
ATTEMPTS_BEFORE_SMS = 3   # same rule as frontend/public/src/lib/outbox.js
MAX_ATTEMPTS = 6
# Meta error codes (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)
NOT_ON_WHATSAPP = {131026}                      # recipient can't receive: go straight to SMS
STOP_THE_RUN = {190, 131030, 131031, 132000, 132001, 132005, 132007, 132015, 132016, 100, 10, 200, 131005}
#   190 token invalid/expired · 131030 recipient not in the test allow-list · 131031 account locked ·
#   1320xx template missing / not approved / paused / disabled / wrong params · 100/10/200 permissions


# ---------------------------------------------------------------------------------------------------------------
# settings

@dataclass(frozen=True)
class WaConfig:
    phone_number_id: str
    token: str
    waba_id: str
    verify_token: str
    app_secret: str
    version: str
    allowed: frozenset[str]
    live: bool

    @property
    def ready(self) -> bool:
        return bool(self.phone_number_id and self.token)


def config() -> WaConfig:
    allowed = {n[-10:] for n in (x.strip().replace(" ", "").replace("+", "") for x in os.getenv("WHATSAPP_ALLOWED_NUMBERS", "").split(",")) if len(n) >= 10}
    return WaConfig(
        phone_number_id=os.getenv("WHATSAPP_PHONE_NUMBER_ID", "").strip(),
        token=os.getenv("WHATSAPP_ACCESS_TOKEN", "").strip(),
        waba_id=os.getenv("WHATSAPP_BUSINESS_ACCOUNT_ID", "").strip(),
        verify_token=os.getenv("WHATSAPP_VERIFY_TOKEN", "").strip(),
        app_secret=os.getenv("WHATSAPP_APP_SECRET", "").strip(),
        version=os.getenv("WHATSAPP_API_VERSION", "").strip() or DEFAULT_VERSION,
        allowed=frozenset(allowed),
        live=os.getenv("WHATSAPP_LIVE", "").strip() in ("1", "true", "yes"),
    )


def may_send_to(cfg: WaConfig, mobile: str) -> bool:
    return cfg.live or mobile[-10:] in cfg.allowed


# tests replace this with an httpx.MockTransport
_transport: httpx.BaseTransport | None = None


def _client(cfg: WaConfig) -> httpx.Client:
    return httpx.Client(base_url=f"{GRAPH}/{cfg.version}", headers={"Authorization": f"Bearer {cfg.token}"},
                        timeout=20, transport=_transport)


class WaError(Exception):
    def __init__(self, code: int | None, message: str, http: int = 0):
        super().__init__(message)
        self.code, self.message, self.http = code, message, http


def _check(r: httpx.Response) -> dict:
    try:
        body = r.json()
    except ValueError:
        body = {}
    if r.status_code >= 400 or "error" in body:
        err = body.get("error", {}) if isinstance(body, dict) else {}
        raise WaError(err.get("code"), (err.get("error_user_msg") or err.get("message") or r.text[:200]), r.status_code)
    return body


# ---------------------------------------------------------------------------------------------------------------
# templates (Marathi, submitted to Meta for approval). Rules: a body may not start or end with a variable, and a
# variable's value may not contain new lines — so every value below is one line.

TEMPLATES = {
    "milk_entry_mr_v1": {
        "category": "UTILITY",
        "body": "नमस्कार {{1}},\n{{2}} {{3}} · {{4}} दूध\n{{5}} ली · फॅट {{6}} · SNF {{7}}\nदर ₹{{8}} · रक्कम ₹{{9}}\nधन्यवाद.",
        "example": ["रामचंद्र पाटील", "10/11/2026", "सकाळ", "गाय", "6.40", "4.2", "8.6", "34.30", "219.52"],
        "footer": "आरग दूध संकलन केंद्र",
    },
    "milk_correction_mr_v1": {
        "category": "UTILITY",
        "body": "नमस्कार {{1}},\n{{2}} {{3}} · {{4}} दुधाच्या नोंदीत दुरुस्ती झाली आहे:\n{{5}}\nधन्यवाद.",
        "example": ["रामचंद्र पाटील", "10/11/2026", "सकाळ", "गाय", "आता 7.00 ली · फॅट 4.1 · SNF 8.5 · रक्कम ₹240.10"],
        "footer": "आरग दूध संकलन केंद्र",
    },
    "center_notice_mr_v1": {
        # news / updates to everyone: Meta will most likely class this as marketing (dearer than utility)
        "category": "MARKETING",
        "body": "आरग दूध संकलन केंद्राकडून सूचना:\n{{1}}\nधन्यवाद.",
        "example": ["उद्या सकाळचे संकलन ७ ऐवजी ८ वाजता सुरू होईल."],
        "footer": "आरग दूध संकलन केंद्र",
    },
    "support_reply_mr_v1": {
        # D-109: a reply to the farmer's help ticket (service / account message)
        "category": "UTILITY",
        "body": "नमस्कार {{1}},\nतुमच्या तक्रार क्र. {{2}} (\"{{3}}\") ला उत्तर आले आहे.\nतुमच्या लॉगिनमध्ये \"मदत\" मध्ये पहा.",
        "example": ["विठ्ठल माने", "T-0002", "कालचे दूध दिसत नाही"],
        "footer": "आरग दूध संकलन केंद्र",
    },
    "payout_status_mr_v1": {
        # D-110: payout status after the gateway confirms it (success / failed / reversed) — account message
        "category": "UTILITY",
        "body": "नमस्कार {{1}},\n{{2}}\nरक्कम: ₹{{3}} · संदर्भ: {{4}}",
        "example": ["विठ्ठल माने", "तुमच्या UPI वर पैसे जमा झाले.", "2,396.68", "SIM1511978422"],
        "footer": "आरग दूध संकलन केंद्र",
    },
    # bill_mr_v1 (PDF bill as a document header) is added once the server makes the PDF bills.
}
KIND_TEMPLATE = {"pour": "milk_entry_mr_v1", "pour-fix": "milk_correction_mr_v1", "notice": "center_notice_mr_v1", "support": "support_reply_mr_v1", "payout": "payout_status_mr_v1"}


def template_payload(name: str) -> dict:
    t = TEMPLATES[name]
    comps = [{"type": "BODY", "text": t["body"], "example": {"body_text": [t["example"]]}}]
    if t.get("footer"):
        comps.append({"type": "FOOTER", "text": t["footer"]})
    return {"name": name, "language": LANG, "category": t["category"], "components": comps}


def template_status(cfg: WaConfig | None = None) -> list[dict]:
    cfg = cfg or config()
    if not cfg.waba_id:
        raise SystemExit("WHATSAPP_BUSINESS_ACCOUNT_ID is not set in .env")
    with _client(cfg) as c:
        body = _check(c.get(f"/{cfg.waba_id}/message_templates", params={"fields": "name,status,category,language,rejected_reason", "limit": 200}))
    return body.get("data", [])


def submit_templates(cfg: WaConfig | None = None) -> list[dict]:
    """Submit every template in TEMPLATES that Meta doesn't have yet. Returns what happened per template."""
    cfg = cfg or config()
    have = {(t["name"], t.get("language")) for t in template_status(cfg)}
    out = []
    with _client(cfg) as c:
        for name in TEMPLATES:
            if (name, LANG) in have:
                out.append({"name": name, "result": "already submitted"})
                continue
            try:
                b = _check(c.post(f"/{cfg.waba_id}/message_templates", json=template_payload(name)))
                out.append({"name": name, "result": "submitted", "status": b.get("status"), "category": b.get("category")})
            except WaError as e:
                out.append({"name": name, "result": "refused", "error": f"{e.code}: {e.message}"})
    return out


# ---------------------------------------------------------------------------------------------------------------
# sending

def send_template(to_mobile: str, name: str, params: list[str], *, lang: str = LANG, cfg: WaConfig | None = None) -> str:
    """Send one template message; returns Meta's message id (wamid…). Raises WaError."""
    cfg = cfg or config()
    if not cfg.ready:
        raise SystemExit("WhatsApp is not set up: fill WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env")
    if not may_send_to(cfg, to_mobile):
        raise SystemExit(f"Refusing: {to_mobile[-10:-4]}XXXX is not in WHATSAPP_ALLOWED_NUMBERS and WHATSAPP_LIVE is off")
    for p in params:
        if "\n" in p or "\t" in p or "    " in p:
            raise ValueError("template values must be one line")
    tpl: dict = {"name": name, "language": {"code": lang}}
    if params:
        tpl["components"] = [{"type": "body", "parameters": [{"type": "text", "text": p} for p in params]}]
    body = {"messaging_product": "whatsapp", "recipient_type": "individual", "to": "91" + to_mobile[-10:], "type": "template", "template": tpl}
    with _client(cfg) as c:
        res = _check(c.post(f"/{cfg.phone_number_id}/messages", json=body))
    return res["messages"][0]["id"]


def check_account(cfg: WaConfig | None = None) -> dict:
    """Is the token valid and which number is it? (no message is sent)"""
    cfg = cfg or config()
    if not cfg.ready:
        return {"ready": False, "missing": [k for k, v in (("WHATSAPP_PHONE_NUMBER_ID", cfg.phone_number_id), ("WHATSAPP_ACCESS_TOKEN", cfg.token)) if not v]}
    with _client(cfg) as c:
        num = _check(c.get(f"/{cfg.phone_number_id}", params={"fields": "display_phone_number,verified_name,quality_rating,code_verification_status,name_status"}))
    out = {"ready": True, "apiVersion": cfg.version, "number": num.get("display_phone_number"), "displayName": num.get("verified_name"),
           "nameStatus": num.get("name_status"), "quality": num.get("quality_rating"), "live": cfg.live,
           "allowedNumbers": [n[:6] + "XXXX" for n in sorted(cfg.allowed)],
           "webhookReady": bool(cfg.verify_token and cfg.app_secret)}
    if cfg.waba_id:
        try:
            out["templates"] = {t["name"]: t.get("status") for t in template_status(cfg) if t["name"] in TEMPLATES}
        except WaError as e:
            out["templates"] = f"could not read: {e.code}: {e.message}"
    return out


# ---------------------------------------------------------------------------------------------------------------
# outbox worker

SHIFT = {"morning": "सकाळ", "evening": "संध्याकाळ"}
MILK = {"cow": "गाय", "buffalo": "म्हैस"}


def _rupees(paise: int) -> str:
    """Indian grouping, 2 decimals: 145000 → '1,450.00'."""
    neg = paise < 0
    r, p = divmod(abs(int(paise)), 100)
    s = str(r)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:]); head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups + [tail])
    return ("-" if neg else "") + f"{s}.{p:02d}"


def _x100(v: int) -> str:
    return f"{v // 100}.{v % 100:02d}"


def _x10(v: int) -> str:
    return f"{v // 10}.{v % 10}"


def _one_line(s: str) -> str:
    return " · ".join(part.strip() for part in str(s).replace("\t", " ").splitlines() if part.strip())


def params_for(conn, m: dict) -> list[str] | None:
    """Template values for one outbox row, read from the database now (so figures are always the saved ones)."""
    kind = m["kind"]
    if kind == "pour":
        r = conn.execute(text("""select f.name, c.date, c.shift, c.milk_type, c.litres_x100, c.fat_x10, c.snf_x10, c.rate_paise, c.amount_paise
                                 from collections c join farmers f on f.id = c.farmer_id where c.id = :id"""), {"id": m["collection_id"]}).mappings().first()
        if not r:
            return None
        return [r["name"], r["date"].strftime("%d/%m/%Y"), SHIFT[r["shift"]], MILK[r["milk_type"]], _x100(r["litres_x100"]),
                _x10(r["fat_x10"]), _x10(r["snf_x10"]), _rupees(r["rate_paise"]), _rupees(r["amount_paise"])]
    if kind == "pour-fix":
        r = conn.execute(text("""select f.name, c.date, c.shift, c.milk_type, c.litres_x100, c.fat_x10, c.snf_x10, c.amount_paise, c.void
                                 from corrections k join collections c on c.id = k.collection_id join farmers f on f.id = c.farmer_id
                                 where k.id = :id"""), {"id": m["correction_id"]}).mappings().first()
        if not r:
            return None
        now = "ही नोंद रद्द केली आहे" if r["void"] else \
            f"आता {_x100(r['litres_x100'])} ली · फॅट {_x10(r['fat_x10'])} · SNF {_x10(r['snf_x10'])} · रक्कम ₹{_rupees(r['amount_paise'])}"
        return [r["name"], r["date"].strftime("%d/%m/%Y"), SHIFT[r["shift"]], MILK[r["milk_type"]], now]
    if kind == "notice":
        t = conn.execute(text("select text from broadcasts where id = :id"), {"id": m["broadcast_id"]}).scalar()
        return [_one_line(t)] if t else None
    if kind == "support":
        r = conn.execute(text("""select f.name, k.no, k.subject from tickets k join farmers f on f.id = k.reporter_farmer_id
                                 where k.id = :id"""), {"id": m["ticket_id"]}).mappings().first()
        return [r["name"], r["no"], _one_line(r["subject"])] if r else None
    if kind == "payout":
        r = conn.execute(text("""select f.name, p.credit_paise, p.method, coalesce(p.ref, p.txn_ref, '') as ref
                                 from payouts p join farmers f on f.id = p.farmer_id where p.id = :id"""), {"id": m["payout_id"]}).mappings().first()
        if not r:
            return None
        where = "बँक खात्यात" if r["method"] == "bank" else "UPI वर"
        line = {"success": f"तुमच्या {where} पैसे जमा झाले.", "reversed": "पेमेंट बँकेने परत केले; रक्कम तुमच्या नावे बाकी आहे.",
                "failed": "पेमेंट आत्ता जाऊ शकले नाही; रक्कम तुमच्या नावे बाकी आहे."}.get(m.get("payout_status"), "")
        return [r["name"], line, _rupees(r["credit_paise"]), r["ref"] or "—"]
    return None  # daily / bill / payment: template not ready yet (bill needs the PDF)


def _after_failure(m: dict, err: WaError, now: datetime) -> dict:
    attempts = (m["attempts"] or 0) + 1
    upd = {"attempts": min(attempts, MAX_ATTEMPTS), "last_error": f"{err.code}: {err.message}"[:300]}
    to_sms = not m["no_sms"] and (err.code in NOT_ON_WHATSAPP or attempts >= ATTEMPTS_BEFORE_SMS)
    if to_sms:
        return {**upd, "channel": "sms", "attempts": 0, "status": "queued", "fell_back": True, "next_attempt_at": now}
    if attempts >= MAX_ATTEMPTS or err.code in NOT_ON_WHATSAPP:
        return {**upd, "status": "failed", "next_attempt_at": None}
    return {**upd, "status": "queued", "next_attempt_at": now + timedelta(minutes=min(60, 2 ** (attempts - 1)))}


def send_due(*, target: str | None = None, limit: int = 50, dry_run: bool = False, cfg: WaConfig | None = None) -> dict:
    """Send due WhatsApp messages from the outbox. Returns counts; never prints the token."""
    cfg = cfg or config()
    report = {"sent": 0, "failed": 0, "toSms": 0, "notAllowed": 0, "templateNotReady": 0, "stopped": None, "dryRun": dry_run, "would": []}
    if not cfg.ready and not dry_run:
        raise SystemExit("WhatsApp is not set up: fill WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env")
    now = datetime.now(timezone.utc)
    with engine(target).connect() as conn:
        due = [dict(r) for r in conn.execute(text("""select * from outbox_messages where channel = 'whatsapp' and status in ('queued', 'deferred')
              and (next_attempt_at is null or next_attempt_at <= now()) order by created_at limit :n"""), {"n": limit}).mappings()]
        for m in due:
            if m["kind"] not in KIND_TEMPLATE:
                report["templateNotReady"] += 1; continue
            if not may_send_to(cfg, m["to_mobile"]):
                report["notAllowed"] += 1; continue
            params = params_for(conn, m)
            if params is None:
                report["templateNotReady"] += 1; continue
            name = KIND_TEMPLATE[m["kind"]]
            if dry_run:
                report["would"].append({"to": m["to_mobile"][:6] + "XXXX", "template": name, "values": params}); continue
            try:
                wamid = send_template(m["to_mobile"], name, params, cfg=cfg)
                upd = {"status": "sent", "provider_message_id": wamid, "sent_at": now, "attempts": (m["attempts"] or 0) + 1,
                       "template": name, "last_error": None, "next_attempt_at": None}
                report["sent"] += 1
            except WaError as e:
                if e.code in STOP_THE_RUN or e.http in (401, 403):
                    report["stopped"] = f"{e.code}: {e.message}"  # setup problem: don't burn the farmers' attempts
                    break
                upd = _after_failure(m, e, now)
                report["toSms" if upd.get("channel") == "sms" else "failed"] += 1
            except httpx.HTTPError as e:  # no internet: try again later, attempts unchanged
                report["stopped"] = f"network: {type(e).__name__}"
                break
            with engine(target).begin() as w:
                sets = ", ".join(f"{k} = :{k}" for k in upd)
                w.execute(text(f"update outbox_messages set {sets} where id = :id"), {**upd, "id": m["id"]})
    if not dry_run:
        del report["would"]
    return report


# ---------------------------------------------------------------------------------------------------------------
# webhook: Meta calls this through the Cloudflare Tunnel (only this path should be exposed)

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])


@router.get("/webhook", response_class=PlainTextResponse)
def verify(mode: str = Query("", alias="hub.mode"), token: str = Query("", alias="hub.verify_token"), challenge: str = Query("", alias="hub.challenge")):
    cfg = config()
    if mode == "subscribe" and cfg.verify_token and hmac.compare_digest(token, cfg.verify_token):
        return challenge
    raise HTTPException(403)


def signature_ok(raw: bytes, header: str, secret: str) -> bool:
    if not secret or not header.startswith("sha256="):
        return False
    want = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, header[7:])


def apply_statuses(payload: dict, *, target: str | None = None) -> dict:
    """Update outbox rows from Meta's status reports. delivered/read → delivered; failed → retry path / SMS."""
    done = {"delivered": 0, "failed": 0, "unknown": 0, "replies": 0}
    now = datetime.now(timezone.utc)
    with engine(target).begin() as c:
        for entry in payload.get("entry", []):
            for ch in entry.get("changes", []):
                v = ch.get("value", {})
                done["replies"] += len(v.get("messages", []))  # farmer replies: shown on संदेश later
                for st in v.get("statuses", []):
                    m = c.execute(text("select * from outbox_messages where provider_message_id = :id"), {"id": st.get("id")}).mappings().first()
                    if not m:
                        done["unknown"] += 1; continue
                    s = st.get("status")
                    if s in ("delivered", "read") and m["status"] != "delivered":
                        c.execute(text("update outbox_messages set status = 'delivered', delivered_at = coalesce(delivered_at, :t) where id = :id"), {"t": now, "id": m["id"]})
                        done["delivered"] += 1
                    elif s == "failed":
                        e = (st.get("errors") or [{}])[0]
                        upd = _after_failure(dict(m), WaError(e.get("code"), e.get("title") or e.get("message") or "failed"), now)
                        upd.pop("provider_message_id", None)
                        c.execute(text("update outbox_messages set " + ", ".join(f"{k} = :{k}" for k in upd) + " where id = :id"), {**upd, "id": m["id"]})
                        done["failed"] += 1
    return done


@router.post("/webhook")
async def receive(request: Request):
    raw = await request.body()
    if not signature_ok(raw, request.headers.get("x-hub-signature-256", ""), config().app_secret):
        raise HTTPException(403)  # not from Meta (or WHATSAPP_APP_SECRET missing): ignore
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(400)
    return {"ok": True, **apply_statuses(payload)}
