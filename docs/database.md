# Database design — Arag Dudh Sankalan Kendra

> **Update 2026-11-09:** the database is **PostgreSQL 18** with a **Python (FastAPI + SQLAlchemy) backend** (D-46). The live schema is
> [backend/db/schema.sql](../backend/db/schema.sql) — the source of truth. It follows this design and adds: farmer PIN login
> (`farmers.pin_hash`, farmer sessions, `sessions.expires_at`), payment void/replace (`payments.void`, `void_reason`,
> `replaces_payment_id`) and payment messages, `audit_log.farmer_id` with an identity id, native types (DATE, TIME,
> TIMESTAMPTZ, BOOLEAN, JSONB, INET, BYTEA) and stricter checks/guard triggers. The SQLite notes below (§1, §7) are superseded, and the SQLite draft files in `scripts/db/` were removed (D-74). New tables since: migrations 001–003 in `backend/db/migrations/`.

Status: **proposed** (2026-11-08). Backend not started; the frontend runs on an in-browser mock (`frontend/public/src/api/mock.js`) whose records match these tables field for field. Engine and backend language are not decided yet — see [§1](#1-engine-proposal).

Contents
1. [Engine (proposal)](#1-engine-proposal)
2. [Conventions used in every table](#2-conventions)
3. [Table list and relationships](#3-table-list-and-relationships)
4. [Tables in detail](#4-tables-in-detail) — 19 tables
5. [Business rules the database enforces](#5-business-rules-the-database-enforces)
6. [Size estimate](#6-size-estimate)
7. [Backup and restore notes](#7-backup-and-restore-notes)
8. [Open questions](#8-open-questions)

---

## 1. Engine (proposal)

**SQLite 3** (single file, WAL mode) on the center's Windows desktop.

| Need (from `CLAUDE.md`) | Why SQLite fits |
|---|---|
| Old desktop, 4 GB RAM, Windows 10/11 | No database server to install or run; a few MB of RAM. |
| Works offline on the LAN | The file lives on the desktop; the API server is the only process that opens it. |
| Daily local backup + one off-site copy | One file; `VACUUM INTO` / the online backup API make a consistent copy while the app runs. |
| Product for other centers later | Every business table already carries `center_id`. The schema below uses only portable types, so moving to PostgreSQL later is a type-mapping exercise, not a redesign. |
| Lean dependencies | Built into Python (`sqlite3`) and available for Node (`better-sqlite3`). |

PRAGMAs at connection open: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.

> Needs your confirmation: SQLite as the database, and the backend language (FastAPI/Python or Node.js). Neither is recorded in `docs/decisions.md` yet.

---

## 2. Conventions

| Item | Rule | Example |
|---|---|---|
| Primary key | `id TEXT` — UUID v4 (client-generated for collection entries, so retries are idempotent) | `'7f3c…'` |
| Center scope | Every business table has `center_id TEXT NOT NULL REFERENCES centers(id)`. The server takes it from the session, never from the request body. | `'arag'` |
| Money | `INTEGER` paise. Never REAL. | ₹33.54 → `3354` |
| Litres | `INTEGER` litres × 100 (2 decimals) | 12.50 L → `1250` |
| Fat / SNF | `INTEGER` value × 10 (1 decimal). Averages are stored × 100. | Fat 4.2 → `42`; avg 4.12 → `412` |
| Business dates | `TEXT 'YYYY-MM-DD'`, IST calendar date | `'2026-11-08'` |
| Timestamps | `TEXT` ISO-8601 UTC with `Z` | `'2026-11-08T15:04:05.123Z'` |
| Booleans | `INTEGER` 0/1 with `CHECK (x IN (0,1))` | |
| Enums | `TEXT` with a `CHECK (… IN (…))` list | `shift IN ('morning','evening')` |
| Who/when | `created_at`, `created_by` (user id) on every row that a person creates | |
| Deleting | No hard deletes of business data. Farmers/users/items use `active = 0`; collection entries use `void = 1` through an approved correction. | |
| Names in the API | Columns are `snake_case`; the JSON API uses `camelCase` (`litres_x100` ↔ `litresX100`). | |
| Audit | Every write that matters adds a row to `audit_log` with before/after JSON, in the same transaction. | |

Rounding (rule R1, half-up) happens in the application before values are written; the database stores the rounded integers.

---

## 3. Table list and relationships

| # | Table | What it holds | Approx. rows / year (1 center, 200 farmers) |
|---|---|---|---|
| 1 | `centers` | The collection center and all its settings | 1 |
| 2 | `users` | Owner and operators (PIN login) | < 10 |
| 3 | `sessions` | Logins: device, login/last seen/logout times | ~1,500 |
| 4 | `farmers` | Farmer master | 200 |
| 5 | `rate_charts` | Rate chart versions (header) per milk type | ~20 |
| 6 | `rate_chart_cells` | Fat × SNF → rate grid of each version | ~20 × 600 |
| 7 | `collections` | Milk entries, one per farmer/date/shift/milk type | ~150,000 |
| 8 | `corrections` | Requests to change/void an entry, with approval | ~500 |
| 9 | `feed_items` | Cattle-feed items and sale price | < 20 |
| 10 | `feed_moves` | Stock in, credit sales to farmers, adjustments | ~3,000 |
| 11 | `advances` | Advances (उचल) given to farmers | ~300 |
| 12 | `bill_cycles` | 7/10-day billing periods and their state | 36–52 |
| 13 | `bills` | One bill per farmer per cycle with totals | ~7,000 |
| 14 | `advance_recoveries` | Installment taken from each bill against each advance | ~1,500 |
| 15 | `payments` | Cash/UPI payments against bills | ~7,500 |
| 16 | `dispatches` | Milk sent to the dairy per date/shift/milk type | ~1,460 |
| 17 | `outbox_messages` | WhatsApp/SMS queue with retries and status | ~80,000 |
| 18 | `sms_counters` | SMS sent per day (daily cap) | 365 |
| 19 | `audit_log` | Who changed what, when, before/after | ~200,000 |

Relationships (all also carry `center_id`):

```
centers ─┬─< users ─< sessions
         ├─< farmers ─┬─< collections >── rate_charts ─< rate_chart_cells
         │            ├─< feed_moves >── feed_items
         │            ├─< advances ─< advance_recoveries >── bills
         │            ├─< bills >── bill_cycles
         │            ├─< payments >── bills
         │            └─< outbox_messages
         ├─< corrections >── collections
         ├─< dispatches
         ├─< sms_counters
         └─< audit_log >── users
```
`A ─< B` = one A has many B. `B >── A` = B points to A.

---

## 4. Tables in detail

Column legend: **PK** primary key · **FK** foreign key · **NN** not null · **U** unique.

### 4.1 `centers`

One row per collection center. Holds the settings the owner edits in सेटिंग्ज and the text for the public website.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | Short id, e.g. `arag` |
| `name` | TEXT | NN | | Marathi name — आरग दूध संकलन केंद्र |
| `name_en` | TEXT | | | English name |
| `address` | TEXT | NN | | Printed on bills |
| `mobile` | TEXT | NN | | Center mobile, 10 digits |
| `dairy_name` | TEXT | | `''` | Buying dairy (not decided yet) |
| `cycle_days` | INTEGER | NN | `10` | `CHECK (cycle_days IN (7,10))` |
| `cycle_anchor` | TEXT | NN | | Start date for 7-day cycles (`YYYY-MM-DD`) |
| `rate_rule` | TEXT | NN | `'nearest-lower'` | In-between Fat/SNF rule: `exact` / `nearest-lower` / `nearest` |
| `daily_summary_time` | TEXT | NN | `'20:30'` | `HH:MM` IST; when the daily WhatsApp summary goes out |
| `sms_cap` | INTEGER | NN | `95` | Max SMS per day from the SIM |
| `marathi_digits_on_bill` | INTEGER | NN | `0` | 1 = print Marathi digits on bills |
| `public_base_url` | TEXT | | `''` | Tunnel domain for bill links, e.g. `https://arag.in`; empty = current address |
| `morning_from` / `morning_to` | TEXT | NN | `'07:00'` / `'10:00'` | Collection hours shown on the website |
| `evening_from` / `evening_to` | TEXT | NN | `'18:00'` / `'21:00'` | |
| `owner_name` | TEXT | | `''` | Website "आमचे ध्येय" section |
| `owner_title` | TEXT | | `''` | |
| `owner_message` | TEXT | | `''` | |
| `owner_photo_path` | TEXT | | `''` | File path under the uploads folder (not a blob in the DB) |
| `created_at` | TEXT | NN | | |
| `updated_at` | TEXT | NN | | |

Secrets (WhatsApp token, SMS gateway password, Aadhaar key) are **not** stored here — only in `.env`.

### 4.2 `users`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | e.g. `u-owner` |
| `center_id` | TEXT | FK NN | | → `centers.id` |
| `name` | TEXT | NN | | Shown on the login screen |
| `role` | TEXT | NN | | `CHECK (role IN ('owner','operator'))` |
| `pin_hash` | TEXT | NN | | Slow salted hash (Argon2id, bcrypt or scrypt — sample data uses `scrypt$N$r$p$salt$hash`) of the 4–6 digit PIN. The PIN itself is never stored. |
| `pin_length` | INTEGER | NN | | 4–6; lets the keypad submit when complete |
| `mobile` | TEXT | | `''` | |
| `active` | INTEGER | NN | `1` | 0 = cannot log in; open sessions are ended |
| `created_at` | TEXT | NN | | |
| `updated_at` | TEXT | NN | | |

Rules: the owner cannot be deactivated. Failed PIN attempts are read from `audit_log` (`action = 'login-failed'`): 5 failures in 10 minutes → locked for 10 minutes.

### 4.3 `sessions`

Login history shown on the कर्मचारी page.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | Session id (also the cookie/token reference) |
| `center_id` | TEXT | FK NN | | |
| `user_id` | TEXT | FK NN | | → `users.id` |
| `token_hash` | TEXT | U NN | | SHA-256 of the session token sent to the browser |
| `login_at` | TEXT | NN | | |
| `last_seen_at` | TEXT | NN | | Updated at most once a minute |
| `logout_at` | TEXT | | NULL | NULL = still logged in (or closed without logout) |
| `user_agent` | TEXT | | | Device shown as "Android फोन / Windows संगणक" |
| `ip` | TEXT | | | LAN or tunnel client address |
| `via_tunnel` | INTEGER | NN | `0` | 1 = remote login through Cloudflare Tunnel |

Index: `(center_id, user_id, login_at DESC)`.

### 4.4 `farmers`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | |
| `center_id` | TEXT | FK NN | | |
| `code` | INTEGER | NN | | Farmer code typed at collection; **unique per center** |
| `name` | TEXT | NN | | |
| `village` | TEXT | | `''` | |
| `mobile` | TEXT | | `''` | 10 digits, starts 6–9 |
| `has_whatsapp` | INTEGER | NN | `1` | 0 → messages go by SMS |
| `consent` | INTEGER | NN | `0` | Agreed to receive account messages (required before any SMS/WhatsApp) |
| `consent_at` | TEXT | | NULL | When consent was recorded |
| `milk_cow` | INTEGER | NN | `0` | Pours cow milk |
| `milk_buffalo` | INTEGER | NN | `0` | Pours buffalo milk. `CHECK (milk_cow + milk_buffalo >= 1)` |
| `upi_id` | TEXT | | `''` | |
| `bank_name` | TEXT | | `''` | Optional |
| `bank_account` | TEXT | | `''` | Optional |
| `bank_ifsc` | TEXT | | `''` | Optional |
| `aadhaar_enc` | BLOB | | NULL | Aadhaar encrypted with AES-256-GCM (key in `.env`); only if a subsidy scheme needs it |
| `aadhaar_last4` | TEXT | | `''` | The only Aadhaar part the UI ever sees (`XXXX XXXX 1234`) |
| `active` | INTEGER | NN | `1` | Inactive farmers can't pour or get bills |
| `created_at` | TEXT | NN | | |
| `updated_at` | TEXT | NN | | |

Unique: `(center_id, code)`. Index: `(center_id, active, name)`.
API note: the mock uses `milkTypes: ['cow','buffalo']`; the API maps it to the two flags.

### 4.5 `rate_charts`

One row per chart **version**. Never edited in place; a price change saves a new version.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | |
| `center_id` | TEXT | FK NN | | |
| `milk_type` | TEXT | NN | | `cow` / `buffalo` |
| `effective_from` | TEXT | NN | | First day this chart applies |
| `effective_to` | TEXT | | NULL | Last day ("that day only"); NULL = until a newer chart starts. After it, the previous chart applies again. |
| `fat_min_x10` / `fat_max_x10` | INTEGER | NN | | Grid range, e.g. 30–60 |
| `snf_min_x10` / `snf_max_x10` | INTEGER | NN | | e.g. 75–95 |
| `source` | TEXT | NN | `'manual'` | `manual` / `excel` / `adjust` (quick ±₹ change) |
| `adjust_paise` | INTEGER | | NULL | For `adjust`: paise added to every cell of the previous chart |
| `note` | TEXT | | `''` | e.g. "डेअरीचे नवीन दर" |
| `created_at` | TEXT | NN | | |
| `created_by` | TEXT | FK NN | | → `users.id` (owner) |

Index: `(center_id, milk_type, effective_from DESC)`.
Chart lookup for a date: the newest chart of that milk type with `effective_from <= date` and (`effective_to IS NULL` or `effective_to >= date`).

### 4.6 `rate_chart_cells`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `chart_id` | TEXT | FK NN | | → `rate_charts.id` (ON DELETE CASCADE) |
| `fat_x10` | INTEGER | NN | | |
| `snf_x10` | INTEGER | NN | | |
| `rate_paise` | INTEGER | NN | | Price per litre. `CHECK (rate_paise > 0)` |

PK: `(chart_id, fat_x10, snf_x10)`. A full grid is (fat steps × SNF steps), e.g. 31 × 21 = 651 rows.
Alternative considered: one JSON column with the whole grid. Cells are easier to import from Excel, validate and query, and the row count is small.

### 4.7 `collections`

The core table: one milk entry.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | **Client-generated UUID**; resending the same id returns the stored row (idempotent) |
| `center_id` | TEXT | FK NN | | |
| `farmer_id` | TEXT | FK NN | | → `farmers.id` |
| `date` | TEXT | NN | | IST collection date |
| `shift` | TEXT | NN | | `morning` / `evening` (सकाळ / संध्याकाळ) |
| `milk_type` | TEXT | NN | | `cow` / `buffalo`; must be one the farmer pours |
| `litres_x100` | INTEGER | NN | | `CHECK (litres_x100 > 0)` |
| `fat_x10` | INTEGER | NN | | |
| `snf_x10` | INTEGER | NN | | |
| `chart_id` | TEXT | FK NN | | Chart version used to price it |
| `rate_paise` | INTEGER | NN | | Rate per litre at entry time |
| `amount_paise` | INTEGER | NN | | `round_half_up(litres_x100 × rate_paise / 100)` |
| `void` | INTEGER | NN | `0` | 1 = removed by an approved correction (kept for audit) |
| `bill_id` | TEXT | FK | NULL | → `bills.id`; set when a bill includes it, cleared if a draft is regenerated |
| `repriced_at` | TEXT | | NULL | Set when a later rate change re-priced this entry (open cycles only) |
| `created_at` | TEXT | NN | | |
| `created_by` | TEXT | FK NN | | Operator who entered it |
| `device_id` | TEXT | | | Phone/tablet that sent it (for sync troubleshooting) |

Unique (duplicate-entry rule): `(center_id, farmer_id, date, shift, milk_type) WHERE void = 0`.
Indexes: `(center_id, date, shift)` for the collection screen and dashboard · `(center_id, farmer_id, date)` for farmer profile and bills · `(bill_id)`.
Entries in a finalized cycle cannot be inserted or changed (checked in the API; see §5).

### 4.8 `corrections`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | |
| `center_id` | TEXT | FK NN | | |
| `collection_id` | TEXT | FK NN | | → `collections.id` |
| `reason` | TEXT | NN | | Required |
| `before_json` | TEXT | NN | | `{litresX100, fatX10, snfX10, amountPaise}` before |
| `after_json` | TEXT | NN | | New values, or `{"void": true}` |
| `status` | TEXT | NN | `'pending'` | `pending` / `approved` / `rejected` |
| `requested_at` | TEXT | NN | | |
| `requested_by` | TEXT | FK NN | | |
| `decided_at` | TEXT | | NULL | |
| `decided_by` | TEXT | FK | NULL | Owner only |

Unique: at most one pending correction per entry — `(collection_id) WHERE status = 'pending'`. An owner's own request is approved immediately.

### 4.9 `feed_items`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | |
| `center_id` | TEXT | FK NN | | |
| `name` | TEXT | NN | | पशुखाद्य (५० किलो पोती) |
| `unit` | TEXT | NN | | पोती / पाकीट |
| `price_paise` | INTEGER | NN | | Current sale price per unit |
| `active` | INTEGER | NN | `1` | |
| `created_at` / `updated_at` | TEXT | NN | | |

Stock is not stored; it is `SUM` of `feed_moves` (in − sale ± adjust), so it can never drift.

### 4.10 `feed_moves`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | |
| `center_id` | TEXT | FK NN | | |
| `item_id` | TEXT | FK NN | | → `feed_items.id` |
| `type` | TEXT | NN | | `in` (stock bought) / `sale` (credit sale to farmer) / `adjust` (count correction, ± qty) |
| `date` | TEXT | NN | | |
| `qty` | INTEGER | NN | | Units; negative allowed only for `adjust` |
| `price_paise` | INTEGER | NN | | Cost price (`in`) or sale price (`sale`) per unit |
| `amount_paise` | INTEGER | NN | | `qty × price_paise` |
| `farmer_id` | TEXT | FK | NULL | Required for `sale` |
| `bill_id` | TEXT | FK | NULL | Bill that deducted this sale; NULL = not yet billed ("पशुखाद्य बाकी") |
| `note` | TEXT | | `''` | |
| `created_at` | TEXT | NN | | |
| `created_by` | TEXT | FK NN | | Stock-in: owner only |

`CHECK (type <> 'sale' OR farmer_id IS NOT NULL)`. Indexes: `(center_id, item_id)`, `(center_id, farmer_id, date)`, `(bill_id)`.

### 4.11 `advances`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | |
| `center_id` | TEXT | FK NN | | |
| `farmer_id` | TEXT | FK NN | | |
| `date` | TEXT | NN | | Day the advance was given |
| `amount_paise` | INTEGER | NN | | `CHECK (amount_paise > 0)` |
| `installment_paise` | INTEGER | NN | | Recovered per bill. `CHECK (installment_paise BETWEEN 1 AND amount_paise)` |
| `mode` | TEXT | NN | `'cash'` | `cash` / `upi` |
| `note` | TEXT | | `''` | e.g. वैद्यकीय |
| `created_at` | TEXT | NN | | |
| `created_by` | TEXT | FK NN | | |

Outstanding (उचल येणे) = `amount_paise − SUM(advance_recoveries.amount_paise)` over final bills.

### 4.12 `bill_cycles`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | `'<start>_<end>'`, e.g. `2026-11-01_2026-11-10` |
| `center_id` | TEXT | FK NN | | |
| `start_date` | TEXT | NN | | 1–10 / 11–20 / 21–end (10-day) or 7-day from the anchor |
| `end_date` | TEXT | NN | | |
| `status` | TEXT | NN | `'open'` | `open` → `generated` (draft bills) → `finalized` (locked) |
| `bill_count` | INTEGER | NN | `0` | |
| `stale` | INTEGER | NN | `0` | 1 = entries or rates changed after draft bills were generated; regenerate before finalizing |
| `generated_at` | TEXT | | NULL | |
| `finalized_at` | TEXT | | NULL | |
| `finalized_by` | TEXT | FK | NULL | |

Unique: `(center_id, start_date, end_date)`.

### 4.13 `bills`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | |
| `center_id` | TEXT | FK NN | | |
| `cycle_id` | TEXT | FK NN | | → `bill_cycles.id` |
| `farmer_id` | TEXT | FK NN | | |
| `bill_no` | TEXT | NN | | Printed number, e.g. `2611A-101` |
| `bill_date` | TEXT | NN | | |
| `start_date` / `end_date` | TEXT | NN | | Copied from the cycle (bill stands alone) |
| `litres_x100` | INTEGER | NN | | Total litres |
| `avg_fat_x100` | INTEGER | NN | | Litre-weighted average Fat |
| `avg_snf_x100` | INTEGER | NN | | |
| `avg_rate_paise` | INTEGER | NN | | |
| `gross_paise` | INTEGER | NN | | Milk amount |
| `feed_paise` | INTEGER | NN | `0` | Feed deducted |
| `advance_paise` | INTEGER | NN | `0` | Advance installment deducted |
| `previous_dues_paise` | INTEGER | NN | `0` | Carried from the last bill |
| `total_deduct_paise` | INTEGER | NN | | feed + advance + previous dues |
| `net_paise` | INTEGER | NN | | gross − deductions (may be negative) |
| `payable_paise` | INTEGER | NN | | `MAX(0, net)` |
| `carry_forward_dues_paise` | INTEGER | NN | `0` | `MAX(0, −net)` → next bill |
| `advance_remaining_paise` | INTEGER | NN | `0` | Advance still outstanding after this bill |
| `paid_paise` | INTEGER | NN | `0` | Sum of payments (kept in sync in the payment transaction) |
| `status` | TEXT | NN | `'draft'` | `draft` / `final` |
| `token` | TEXT | U NN | | Unguessable token for the public bill link sent by SMS |
| `pdf_path` | TEXT | | NULL | Generated Marathi PDF |
| `generated_at` | TEXT | NN | | |

Unique: `(cycle_id, farmer_id)`, `(center_id, bill_no)`, `(token)`.
`CHECK (paid_paise <= payable_paise)`. Payment status (paid / part / unpaid / nothing due) is derived from `paid_paise` vs `payable_paise`.

### 4.14 `advance_recoveries`

Which advance each bill's installment paid back (a farmer can have more than one advance; oldest is recovered first).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | |
| `center_id` | TEXT | FK NN | | |
| `bill_id` | TEXT | FK NN | | → `bills.id` (ON DELETE CASCADE, for regenerated drafts) |
| `advance_id` | TEXT | FK NN | | → `advances.id` |
| `amount_paise` | INTEGER | NN | | `CHECK (amount_paise > 0)` |

Unique: `(bill_id, advance_id)`. `SUM(amount_paise)` per bill = `bills.advance_paise`.

### 4.15 `payments`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | |
| `center_id` | TEXT | FK NN | | |
| `bill_id` | TEXT | FK NN | | → `bills.id`; bill must be `final` |
| `farmer_id` | TEXT | FK NN | | Copied for fast per-farmer queries |
| `date` | TEXT | NN | | Payment date |
| `mode` | TEXT | NN | | `cash` / `upi` |
| `amount_paise` | INTEGER | NN | | `CHECK (amount_paise > 0)`; cannot exceed what is still due |
| `upi_ref` | TEXT | | `''` | UTR — **required for UPI**, empty for cash. `CHECK (mode = 'cash' OR upi_ref <> '')` |
| `note` | TEXT | | `''` | |
| `created_at` | TEXT | NN | | |
| `created_by` | TEXT | FK NN | | Owner |

Indexes: `(center_id, date)` for the daily cash vs UPI totals · `(bill_id)` · `(center_id, farmer_id, date)`.

### 4.16 `dispatches`

Milk sent to the buying dairy, for shrinkage and margin.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | |
| `center_id` | TEXT | FK NN | | |
| `date` | TEXT | NN | | |
| `shift` | TEXT | NN | | `morning` / `evening` |
| `milk_type` | TEXT | NN | | `cow` / `buffalo` |
| `litres_x100` | INTEGER | NN | | Litres the dairy accepted |
| `fat_x10` / `snf_x10` | INTEGER | NN | | Dairy's test result |
| `rate_paise` | INTEGER | NN | | Rate the dairy pays per litre |
| `amount_paise` | INTEGER | NN | | Amount receivable from the dairy |
| `dairy_name` | TEXT | | `''` | |
| `slip_no` | TEXT | | `''` | Dairy receipt number |
| `created_at` | TEXT | NN | | |
| `created_by` | TEXT | FK NN | | |

Unique: `(center_id, date, shift, milk_type)`.
Profit per farmer (dashboard, farmer profile) = this `rate_paise` × the farmer's litres for the same date/shift/milk type − the farmer's `amount_paise`. Shifts without a dispatch row are not counted.

### 4.17 `outbox_messages`

Every WhatsApp/SMS goes through this queue; a worker sends when the network allows.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | |
| `center_id` | TEXT | FK NN | | |
| `farmer_id` | TEXT | FK NN | | |
| `kind` | TEXT | NN | | `daily` (evening summary) / `bill` |
| `date` | TEXT | NN | | Business date the message is about |
| `bill_id` | TEXT | FK | NULL | For `bill` messages |
| `channel` | TEXT | NN | | `whatsapp` / `sms` |
| `to_mobile` | TEXT | NN | | |
| `template` | TEXT | | | Approved WhatsApp utility template name |
| `body_json` | TEXT | NN | | Template variables / SMS text (Marathi, short) |
| `attachment_path` | TEXT | | NULL | Bill PDF for WhatsApp |
| `status` | TEXT | NN | `'queued'` | `queued` / `deferred` (SMS cap reached; waits for next day) / `sent` / `delivered` / `failed` |
| `attempts` | INTEGER | NN | `0` | Max 6; backoff 1, 2, 4 … 60 min |
| `next_attempt_at` | TEXT | | NULL | |
| `fell_back` | INTEGER | NN | `0` | 1 = WhatsApp failed and it moved to SMS |
| `provider_message_id` | TEXT | | NULL | Meta / SMS gateway id, for delivery receipts |
| `last_error` | TEXT | | NULL | |
| `created_at` | TEXT | NN | | |
| `sent_at` | TEXT | | NULL | |
| `delivered_at` | TEXT | | NULL | |

Unique (no double messages): `(center_id, farmer_id, kind, date, COALESCE(bill_id,''))`.
Index for the worker: `(status, next_attempt_at)`.

### 4.18 `sms_counters`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `center_id` | TEXT | FK NN | | |
| `date` | TEXT | NN | | IST date |
| `sent` | INTEGER | NN | `0` | SMS segments sent from the SIM today |

PK: `(center_id, date)`. The worker increments it in the same transaction that marks a message sent and stops at `centers.sms_cap`.

### 4.19 `audit_log`

Append-only. Shown on the बदल नोंद page.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PK | | |
| `center_id` | TEXT | FK NN | | |
| `at` | TEXT | NN | | |
| `user_id` | TEXT | FK | | Who (NULL for system jobs) |
| `action` | TEXT | NN | | `create` / `update` / `void` / `approve` / `reject` / `generate` / `finalize` / `login` / `logout` / `login-failed` / `reprice` … |
| `entity` | TEXT | NN | | `collection` / `farmer` / `rate-chart` / `bill-cycle` / `payment` / `user` / `center` … |
| `entity_id` | TEXT | | | |
| `before_json` | TEXT | | NULL | Row before the change (PIN hashes and Aadhaar never included) |
| `after_json` | TEXT | | NULL | Row after the change |
| `ip` | TEXT | | | |

Indexes: `(center_id, at DESC)`, `(center_id, user_id, at DESC)`, `(center_id, entity, entity_id)`.
No UPDATE or DELETE is ever run on this table (enforce with a trigger that raises an error).

### 4.20–4.23 Daily milk buyers (migration `backend/db/migrations/001_milk_buyers.sql`, D-51)

Hotels, tea stalls, hostels and households that take milk every day and pay **per calendar month**.

| Table | Columns (main) | Rules |
|---|---|---|
| `milk_buyers` | `id`, `center_id`, `code` (U per center), `name`, `area`, `mobile`, `milk_type` (cow/buffalo), `rate_paise` (current ₹/L), `morning_x100` / `evening_x100` (usual litres — pre-filled on the daily sheet), `active`, `note`, `created_at`, `updated_at` | Owner adds/edits; a new rate applies only to new entries |
| `buyer_sales` | `id` (client UUID), `center_id`, `buyer_id`, `date`, `shift`, `milk_type`, `litres_x100` (0 = didn't take), `rate_paise` (rate of that entry), `amount_paise`, `created_*`, `updated_*` | One per buyer/date/shift; `amount = round_half_up(litres × rate)` (CHECK); entries of a closed month cannot be added, changed or deleted (trigger) |
| `buyer_payments` | `id`, `center_id`, `buyer_id`, `date`, `mode` (cash/upi), `amount_paise`, `upi_ref`, `note`, `void`, `void_reason`, `created_*` | UPI needs UTR, cash has none; never deleted, only voided with a reason (trigger). A payment counts in the month of its date |
| `buyer_months` | `id` = `'YYYY-MM'`, `center_id`, `month`, `closed_at`, `closed_by` | A row = that month is closed (locked); only after the month has ended |

Month account per buyer: **previous balance** (all milk − all payments before the 1st) **+ this month's milk − received this month = balance due**.
Dispatch shrinkage counts milk sold to buyers as milk that left the center (dashboard).

### 4.24 Walk-in (सुटी) milk sales (migration `backend/db/migrations/002_counter_sales.sql`, D-53)

Occasional or unknown people who buy at the counter: village measures **¼, ½, 1 L** (any litres allowed), paid on the spot. No account, no balance.

| Table / column | Columns (main) | Rules |
|---|---|---|
| `centers.counter_rate_cow_paise`, `centers.counter_rate_buffalo_paise` | price per litre (default ₹60 / ₹76) | Owner sets; applies to new sales only |
| `counter_sales` | `id` (client UUID), `center_id`, `date`, `shift`, `milk_type`, `litres_x100` (> 0, ≤ 50 L), `rate_paise` (rate of that sale), `amount_paise`, `mode` (cash/upi), `upi_ref` (optional), `name` (optional), `void`, `void_reason`, `created_at`, `created_by` | `amount = round_half_up(litres × rate)` (CHECK), so ¼ L at ₹60 = ₹15; never deleted, only voided with a reason, nothing else can change (trigger); a closed buyer month (`buyer_months`) locks its walk-in sales too |

Dashboard shrinkage = collected − sent to dairy − sold to buyers − walk-in sales (voided sales excluded).

---

## 5. Business rules the database enforces

| Rule | How |
|---|---|
| One entry per farmer / date / shift / milk type | Partial unique index on `collections` (`WHERE void = 0`) |
| Retries don't create duplicates | Client UUID is the `collections.id` primary key |
| Farmer code unique in a center | Unique `(center_id, code)` |
| Money never fractional | All money columns `INTEGER` |
| Finalized cycle is locked | API check + trigger: reject INSERT/UPDATE on `collections`, `feed_moves.bill_id`, `bills` when the date's cycle is `finalized` |
| UPI payment needs a reference | `CHECK (mode = 'cash' OR upi_ref <> '')` |
| No overpayment | `CHECK (paid_paise <= payable_paise)` on `bills`, updated in the payment transaction |
| One dispatch per date/shift/milk type | Unique index on `dispatches` |
| One message per farmer/kind/date/bill | Unique index on `outbox_messages` |
| Audit log can't be changed | Triggers block UPDATE/DELETE on `audit_log` |
| No hard deletes | `active` / `void` flags; FKs without `ON DELETE CASCADE` except chart cells and draft-bill recoveries |

Calculated in the application (rules in `frontend/public/src/lib/`, covered by tests): rate lookup, rounding R1, bill totals B1–B4, cycle dates C1, advance installments, SMS cap, outbox retry.

---

## 6. Size estimate

For 200 farmers, both shifts, 365 days: about 150,000 collection rows and 200,000 audit rows a year. With indexes that is roughly 60–90 MB per year — comfortable for SQLite on the old desktop for many years. Dashboard queries read at most 30 days (~12,000 rows) through the `(center_id, date, shift)` index.

---

## 7. Backup and restore notes

- Daily: `VACUUM INTO 'backups/arag-YYYY-MM-DD.db'` while the app runs (consistent copy), keep 30 days locally.
- Off-site: upload the newest copy (encrypted zip) to the free-tier cloud folder.
- Uploaded files (bill PDFs, owner photo) are in `data/uploads/` and are backed up with the DB file.
- Restore: stop the service, replace `data/arag.db`, start the service, open the dashboard and check the latest collection date. Documented and tested in `docs/` before go-live (required by `CLAUDE.md`).

---

## 8. Open questions

1. **Engine and backend language** — SQLite proposed; FastAPI (Python) or Node.js? (§1)
2. **Feed stock adjustments** — is the `adjust` move type (for damaged/lost bags) wanted?
3. **Advance given in UPI** — should advances record the UPI reference like payments?
4. **Dairy payments** — do we need a table for money received from the dairy (to track dairy dues)? Phase 1 only records `dispatches.amount_paise`.
5. **Delivery receipts** — store WhatsApp "delivered/read" webhooks (`delivered_at`) in Phase 1, or only "sent"?
