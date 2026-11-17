---
description: Rebuild the demo data (Vercel link + laptop package) up to a date, e.g. /demo-data 2026-11-30
argument-hint: end date YYYY-MM-DD (default: 7 days from today)
---
Rebuild the demo data so the demo shows data up to **$ARGUMENTS** (if empty: 7 days after today, IST).

1. Vercel demo link: `node scripts/demo/make-demo-snapshot.mjs <date>` from the repo root → `frontend/public/demo/demo-data.json`. Report milk-entry dates, bills, payouts, expenses, tickets.
2. Bump `VERSION` in `frontend/public/sw.js`.
3. Laptop package (`demo-package/Arag-Demo/`, not committed): copy `frontend/public` into it (replace its `public/`), and re-zip it as `demo-package/Arag-Demo-<today>.zip`. Do not touch its `.dev-shared-db.json` unless I ask.
4. Run the frontend tests.
5. Do not commit or push — tell me it is ready and ask whether to push.

Never touch the user's 5173 data (`frontend/.dev-shared-db.json`) or the PC / Supabase databases.
