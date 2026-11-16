# Go-live plan — from test mode to the real database

Status on 16/11/2026. Written for: the owner (Bokare) to decide the open points; the developer to follow the steps.

## Where we are

- **Pages and rules:** done and tested (97 frontend tests). They run in **test mode**: the data lives in the browser and the dev server's file (`api/mock.js`).
- **Real database:** PostgreSQL on the centre PC (`arag_dudh`). Up to date — all 14 migrations applied (16/11/2026, backup taken first). 36 tables. 27 backend tests pass.
- **Real backend (FastAPI):** only read-only parts exist — health, centre, farmers, milk entries, bills, summary, farmer login, WhatsApp delivery reports.
- **Gap:** the app has **124 operations** (`frontend/public/src/api/mock.js`). Each needs a real `/api/...` endpoint with the same name and data shape (`docs/api-contract.md`). Then `api/index.js` switches from the mock to an HTTP client — no page changes.

## Where it runs (D-135: cloud)

| | Vercel | Supabase |
|---|---|---|
| Role | The app (PWA) and the API (Python serverless functions), scheduled jobs (Vercel Cron: messages, daily backup) | **Main database** (PostgreSQL, Mumbai), all saves |
| Plan | Pro (Hobby is non-commercial only) | Paid (free projects pause after a week of no use); Row Level Security on every table |

The centre needs internet; a milk entry made while it is down waits on the phone and is sent later (retry queue, client UUID). The PC database stays for development and tests.

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
9. **Cloud set-up** — Supabase connected and filled on 16/11/2026 (RLS on for every table). Still to build: the API as Vercel functions, Vercel Cron for the outbox and backups, the SMS route from the cloud. (Was: sync from the centre PC (every few minutes and after each save batch; queued while offline).
10. **Switch over** — move the test data or start clean (owner's choice), point `api/index.js` at the API on Vercel, the centre's domain on Vercel, daily backup + off-site copy, and a tested restore.

## Decisions needed from the owner

1. ~~Supabase role~~ — decided: Supabase is the main database, app on Vercel (D-135).
2. **Start clean** on go-live day, or carry over the test data?
3. **Off-site backup folder** (`BACKUP_DESTINATION` in `.env`) — e.g. a Google Drive for desktop folder. Not set yet.
4. **Domain** for the live site on Vercel (e.g. `<name>.in`), and the Vercel Pro / Supabase paid plans on the client's accounts.
5. **Font** — Mukta stays unless another is chosen in the website's font tester (D-133).

## What the owner fills in `.env` (never shared in chat)

- `SUPABASE_DATABASE_URL` — Supabase → Project → Connect → Session pooler URI (format in `.env.example`).
- `BACKUP_DESTINATION` and the WhatsApp keys when messages go live. On Vercel the same values go into the project's Environment Variables, never into the code.
