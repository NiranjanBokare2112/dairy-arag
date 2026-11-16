# Frontend — operator app + owner dashboard (PWA)

A Marathi-first, large-touch web app served from the center's desktop over Wi-Fi. It installs on Android phones as an app (PWA) and has no runtime dependencies and no build step.

**Status:** all Phase 1 screens are built and run against an in-browser **mock API** with demo data. The backend is not started yet (see `docs/api-contract.md`).

## Run it

```
cd frontend
npm run dev        # http://localhost:5173  (+ LAN address for phones on the same Wi-Fi)
npm test           # 25 tests: rates, rounding, billing, deductions, duplicates, SMS cap, outbox retry, i18n
```

Demo PINs: owner **1234**, operator **1111**. To start over, use Settings → "डेमो डेटा पुन्हा सुरू".

Node 20+ is needed only for the dev server and tests. The app itself is plain HTML, CSS and JS.

## Screens

| Route | Who | What |
|---|---|---|
| `#/welcome` | public | Center website, opening with the animated milk-collection simulation: owner's vision, facilities, how it works, sample daily message, contact. **Login** button top-right. First page for anyone not logged in. |
| `#/login` | all | Pick a user, then enter the PIN on a big keypad |
| `#/` | all | Big tiles; today's litres |
| `#/collection` | owner, operator | Code → litres/Fat/SNF → rate and amount fill in automatically. Enter moves to the next box. Duplicate entries are blocked. Corrections go to the owner for approval. |
| `#/receipt/:id` | owner, operator | 58 mm thermal receipt |
| `#/farmers`, `#/farmers/:id` | owner edits | Farmer master, balances, bills, message log. Aadhaar is optional and masked. |
| `#/rates`, `#/rates/new` | owner | Fat × SNF charts with effective dates and history. CSV (Excel) import/export, a formula generator and a rate checker. |
| `#/ledger` | owner, operator | Feed credit sales, advances (उचल) with installments, stock |
| `#/billing`, `#/bill/:id` | owner | Generate all bills → review → finalize (locks the cycle). The A4 Marathi bill follows `design-assets/bill/`. |
| `#/b/:token` | public | Bill page for SMS links (final bills only) |
| `#/payments` | owner | Unpaid list, cash/UPI entry (UPI needs a reference), daily register |
| `#/dispatch` | owner, operator | Litres sent to the dairy; collected vs sent |
| `#/dashboard` | owner | Today by shift and milk type, 14-day bars, Fat/SNF trend, shrinkage and margin, dues, top/low suppliers |
| `#/messages` | owner, operator | Outbox with status and retries, SMS daily counter, daily summary queue |
| `#/approvals`, `#/settings`, `#/audit` | owner | Correction approvals, center settings, audit log |

## Layout

```
frontend/
  dev-server.mjs          zero-dependency static server (dev/LAN testing)
  public/                 everything the desktop serves
    index.html  manifest.webmanifest  sw.js (offline app shell)
    assets/fonts/         Mukta, self-hosted (works offline)
    assets/img/           cow & calf logo, PWA icons
    src/app.js            shell: routing, role guard, nav, online status
    src/core/             dom (escaping html``), router, i18n, ui (toast/modal), sync (retry queue)
    src/lib/              pure business rules: money, qty, rates, billing, cycles, collection, outbox
    src/api/              index.js → mock.js (+ seed.js demo data)
    src/i18n/             mr.js (default), en.js, messages.mr.js (WhatsApp/SMS texts)
    src/pages/            one module per screen
    src/styles/           app.css, print.css (A4 bill, 58 mm receipt)
  tests/                  node:test — business rules and i18n completeness
```

## Rules the UI follows (CLAUDE.md §6)

- **No floats:** money in paise, litres ×100, Fat/SNF ×10. Rounding rules are in `src/lib/*.js` headers and recorded as decisions D-20 to D-24.
- **Translations:** every UI string goes through `t()`. A test fails if a key is missing in `mr` or `en`.
- **Digits:** Latin digits on screen. The setting for Marathi digits applies to the printed bill only.
- **Dates:** IST, displayed as DD/MM/YYYY.
- **Escaping:** all HTML is built with the escaping `html` template, so farmer names cannot inject markup.
- **Touch targets:** at least 48 px, collection inputs 64 px. Works at 360 px phone width.
- **Duplicate-safe entries:** each collection entry has a client UUID. If the server is unreachable, the entry waits on the phone and is resent safely.
