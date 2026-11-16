# Database: schema and sample data

> The database is **PostgreSQL**. Its schema is [backend/db/schema.sql](../../backend/db/schema.sql) plus [backend/db/migrations/](../../backend/db/migrations/); data is loaded with `python -m app.cli seed` (see [backend/README.md](../../backend/README.md)), which reads `sample-data.json` from this folder. (The earlier SQLite draft files were removed on 10/11/2026, D-74.)

| File | What it is |
|---|---|
| [sample-data.json](sample-data.json) | Sample rows for every table, for the PostgreSQL loader — **generated**, do not edit by hand |
| [make-sample.mjs](make-sample.mjs) | Generator for the sample file |

## Load it

```sh
cd backend
python -m app.cli --test seed --reset     # test database
```

Regenerate the sample (dates move to "today"): `node scripts/db/make-sample.mjs` — Node 18+, no packages.

## How the sample is made

The rows are not typed by hand. The generator runs the frontend's mock backend in Node, which uses the same business rules as the app (`frontend/public/src/lib/`, covered by the tests): rate lookup, half-up rounding, bill totals, deductions, advance installments, cycle dates, outbox rules. So every amount agrees with every other amount.

Dates are relative to the day it runs. All names, mobiles, UPI ids and UTRs are fictional; the one Aadhaar value is a random placeholder blob, not real ciphertext.

## What is in it (generated 2026-11-09 — history from 01/08, see D-50)

| Table | Rows | Covers |
|---|---|---|
| centers | 1 | आरग दूध संकलन केंद्र with all settings, website text, collection hours |
| users | 2 | मालक (PIN 1234) and ऑपरेटर १ (PIN 1111), PINs as scrypt hashes |
| sessions | 18 | 6 days of operator (morning + evening) and owner logins; one session never logged out; owner via tunnel |
| farmers | 12 | Cow, buffalo and both; 2 without WhatsApp (SMS); one with bank details + Aadhaar (last 4 = 4821) |
| rate_charts / rate_chart_cells | 3 / 2,373 | Cow and buffalo charts from 01/08, plus a "+₹1 cow" change from 05/11 (`source = 'adjust'`) |
| collections | 2,660 | 01/08 → today, both shifts, all 12 farmers; entries after 05/11 re-priced by the ₹1 change; one corrected |
| corrections | 2 | One approved (Fat typo), one pending (litres) |
| feed_items / feed_moves | 2 / 26 | Two items; opening stock + purchases; credit sales spread over the months (billed and not yet billed) |
| advances / advance_recoveries | 5 / 13 | Advances to 4 farmers; each recovered only from bills of periods on/after the day it was given |
| bill_cycles | 10 | 9 finalized (01/08 → 31/10, three per month); 01–10/11 open |
| bills | 108 | 9 per farmer: all paid except the latest period (1 part-paid, 1 unpaid) |
| payments | 107 | UPI (with UTR) for farmers with a UPI id, cash for the others, one part payment |
| dispatches | 400 | Milk sent to the dairy per date/shift/milk type (~0.4 % shrinkage, dairy pays ₹2/L more) |
| outbox_messages | 132 | Bill messages for every period and daily summaries, WhatsApp and SMS; sent and still queued |
| sms_counters | 1 | Today's SMS count |
| audit_log | 102 | Every write above, plus a failed PIN attempt |

### A few rows, readable

Farmers (part):

| code | name | village | milk | WhatsApp | UPI |
|---|---|---|---|---|---|
| 101 | रामचंद्र पाटील | आरग | cow | yes | farmer101@upi |
| 102 | सुनीता जाधव | आरग | buffalo | yes | farmer102@upi |
| 103 | विठ्ठल माने | बेडग | cow + buffalo | yes | farmer103@upi |
| 104 | शांताबाई कांबळे | आरग | cow | no (SMS) | — · Aadhaar XXXX 4821 |

Milk entries, 08/11 (stored values → meaning):

| shift | farmer | type | litres_x100 | fat_x10 | snf_x10 | rate_paise | amount_paise |
|---|---|---|---|---|---|---|---|
| morning | 101 | cow | 410 → 4.10 L | 42 → 4.2 | 83 → 8.3 | 3440 → ₹34.40 | 14104 → ₹141.04 |
| morning | 102 | buffalo | 400 → 4.00 L | 61 → 6.1 | 93 → 9.3 | 5050 → ₹50.50 | 20200 → ₹202.00 |
| evening | 101 | cow | 400 → 4.00 L | 43 → 4.3 | 84 → 8.4 | 3520 → ₹35.20 | 14080 → ₹140.80 |

Bills 21–31/10 (part) — numbers below are from the first, 19-day sample and are only an illustration of the format:

| bill_no | farmer | litres | avg Fat | gross | advance | payable | paid |
|---|---|---|---|---|---|---|---|
| 2026/10-C/101 | 101 | 109.70 | 4.08 | ₹3,653.08 | ₹500.00 | ₹3,153.08 | ₹3,153.08 (UPI) |
| 2026/10-C/104 | 104 | 112.70 | 4.11 | ₹3,782.54 | — | ₹3,782.54 | ₹1,891.00 (cash, part) |
| 2026/10-C/105 | 105 | 105.30 | 4.07 | ₹3,507.02 | ₹1,000.00 | ₹2,507.02 | ₹2,507.02 (UPI) |
| 2026/10-C/112 | 112 | 109.40 | 4.13 | ₹3,674.66 | — | ₹3,674.66 | unpaid |

Cow rate chart (from 01/10), a corner of the grid in ₹/L:

| Fat \ SNF | 8.0 | 8.5 | 9.0 |
|---|---|---|---|
| 3.0 | 26.50 | 28.00 | 29.50 |
| 4.0 | 31.50 | 33.00 | 34.50 |
| 5.0 | 36.50 | 38.00 | 39.50 |

## Checked

Loaded into PostgreSQL by the backend tests (`python -m pytest` in backend/), and these hold for every row:
entry amount = round-half-up(litres × rate) · bill gross = sum of its entries · bill paid = sum of its payments · bill advance = sum of its recoveries · bill feed = sum of its billed feed sales.

The database rejects: a duplicate entry (same farmer/date/shift/milk type), changing litres in a finalized period, a UPI payment without UTR, overpaying a bill, changing a final bill's amounts, a duplicate farmer code, and any edit or delete in the audit log.

### Data up to a chosen moment

`node scripts/db/make-sample.mjs --now=2026-11-11T10:00:00+05:30` builds the sample as if it were that moment: entries up to that shift, every earlier bill period billed and closed. Without `--now` it uses the real time. Then load it with `python -m app.cli seed --reset --yes` (in `backend/`). This rebuilds the database and replaces the audit log.

