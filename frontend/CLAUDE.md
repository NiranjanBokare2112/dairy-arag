# Frontend — working rules (read with the root CLAUDE.md)

PWA in plain ES modules: no build step, no runtime dependencies. Everything lives in `public/`.

## Test mode (until the real API exists)
- Pages call one object, `api` (`public/src/api/index.js`), which today points at `api/mock.js` — the whole app's rules run in the browser. Method names and data shapes follow `docs/api-contract.md`; keep them when changing anything.
- `node dev-server.mjs` (port 5173) shares one copy of the test data between all devices (`.dev-shared-db.json`, never committed). The user's 5173 server is usually running — **never stop it** and never touch that file without asking.
- For your own browser tests use `PORT=5174 node dev-server.mjs` (data in `.dev-shared-db-5174.json`); delete that file and stop the 5174 server afterwards. Kill only the headless Chrome you started (your own `--user-data-dir`).
- On a plain web host (Vercel) there is no dev server: a browser's first visit loads `public/demo/demo-data.json` (fictional). Rebuild it with `node scripts/demo/make-demo-snapshot.mjs <end-date>` from the repo root.

## Rules for every change
- **Texts**: Marathi first. Every UI string is a key in `public/src/i18n/mr.js` **and** `en.js` (same keys — a test checks). No hard-coded text in pages. In English text use the typographic apostrophe ’.
- **Business rules** (money, rates, bills, payouts, SLA, expenses…) go in `public/src/lib/*.js` as pure functions with tests in `tests/`. Money in integer paise, litres ×100, Fat/SNF ×10, dates IST `YYYY-MM-DD`.
- **After any change to files under `public/`**: bump `VERSION` in `public/sw.js` (`arag-vNNN`), or phones keep the old copy.
- Every write that matters is audit-logged in the mock (`audit(...)`), like the real backend will.
- Record new decisions in `docs/decisions.md` (next D-number).

## Checks
- `npm test` (from `frontend/`) — all must pass.
- Browser check for anything visible: PC (1280 px) and phone (390 px), no sideways scroll, no console errors.
- Staff login in test mode: 4-digit PIN → OTP shown on screen (owner 1234, operator 1111, support 9999); farmers: code (e.g. 103).

## Editing tips (Windows)
- Bash heredocs mangle backslashes, regexes and apostrophes: for multi-line edits write a small Python script with the Write tool, or use Edit.
