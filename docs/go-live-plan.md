# Go-live plan — from test mode to the real database

Status on 16/11/2026. Written for: the owner (Bokare) to decide the open points; the developer to follow the steps.

## Where we are

- **Pages and rules:** done and tested (97 frontend tests). They run in **test mode**: the data lives in the browser and the dev server's file (`api/mock.js`).
- **Real database:** PostgreSQL on the centre PC (`arag_dudh`). Up to date — all 14 migrations applied (16/11/2026, backup taken first). 36 tables. 27 backend tests pass.
- **Real backend (FastAPI):** only read-only parts exist — health, centre, farmers, milk entries, bills, summary, farmer login, WhatsApp delivery reports.
- **Gap:** the app has **124 operations** (`frontend/public/src/api/mock.js`). Each needs a real `/api/...` endpoint with the same name and data shape (`docs/api-contract.md`). Then `api/index.js` switches from the mock to an HTTP client — no page changes.

## The two databases (D-134)

| | Centre PC (PostgreSQL) | Supabase (online) |
|---|---|---|
| Role | **Main.** Every save happens here. | **Online copy**, kept in step from the centre PC. |
| Works without internet | Yes — collection, billing, printing on the centre Wi-Fi | — |
| Used for | Operators, owner at the centre, owner remotely through the Cloudflare Tunnel | Off-site backup; read-only pages when the centre PC is off (website, farmer's own page) |
| Writes | Yes | No (only the sync from the centre PC) |

Why one main database: two databases that both take saves would need conflict handling (two people changing the same bill). With one main and one copy, nothing can disagree.

## Steps

Each step: backend endpoints + backend tests (the same cases as the frontend tests) + the page tried against the real backend before the next step.

1. **Login and settings** — PIN login (hashed PINs, attempt limit), sessions, roles, operator tab permissions, centre settings, staff, login history.
2. **Farmers** — list, add, edit, detail-change requests and approvals (D-108), English names (D-118), Aadhaar encrypted.
3. **Rate charts** — versions, Excel import/export, rate lookup, dairy charts.
4. **Milk collection** — entry with client UUID (retries safe), duplicate block, corrections with approval, receipts, the per-entry WhatsApp message into the outbox (D-73).
5. **Feed, advances and expenses** — stock, credit sales, advances, expenses with approval of operator changes (D-126); default expense types created for the centre.
6. **Bills and money** — generate / finalize (locks the period), bill PDF, payments by hand, UPI payouts (still simulated, D-107), the double-payment guard (D-125).
7. **Dairy dispatch, milk buyers, dashboard** — dispatch, buyers' daily sheet and month account, walk-in sales, dashboard figures and net profit.
8. **Messages and the rest** — outbox worker (WhatsApp / SMS, daily SMS cap), notices, schemes, doctors, help tickets, website content, audit log, backup.
9. **Supabase copy** — connected and filled once on 16/11/2026 (RLS on for every table). Still to build: the sync job from the centre PC (every few minutes and after each save batch; queued while offline).
10. **Switch over** — move the test data or start clean (owner's choice), point `api/index.js` at the backend, run the Windows service, the Cloudflare Tunnel on the centre's domain, daily backup + off-site copy, and a tested restore.

## Decisions needed from the owner

1. Supabase as the **online copy** (recommended above) — or should it take saves too?
2. **Start clean** on go-live day, or carry over the test data?
3. **Off-site backup folder** (`BACKUP_DESTINATION` in `.env`) — e.g. a Google Drive for desktop folder. Not set yet.
4. **Domain** for the Cloudflare Tunnel (e.g. `<name>.in`).
5. **Font** — Mukta stays unless another is chosen in the website's font tester (D-133).

## What the owner fills in `.env` (never shared in chat)

- `SUPABASE_DATABASE_URL` — Supabase → Project → Connect → Session pooler URI (format in `.env.example`).
- `BACKUP_DESTINATION`, `CLOUDFLARE_TUNNEL_HOSTNAME`, and the WhatsApp keys when messages go live.
