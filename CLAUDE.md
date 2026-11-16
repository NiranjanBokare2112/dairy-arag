# Arag Dudh Sankalan Kendra — Milk Collection & Farmer Billing System

Client project of **Bokare Technologies**. This file is the standing brief: read it before every task.

## 1. The client and the problem

- Client: **आरग दूध संकलन केंद्र** (Arag Dudh Sankalan Kendra), a new milk collection center in Arag village, Tal. Miraj, Dist. Sangli, Maharashtra 416401. Mobile 9158435304.
- One center today (Arag only). Design for multiple centers later (every business table carries `center_id`), because Bokare will sell this as a product to other centers.
- Farmers pour **cow and buffalo** milk twice a day (morning and evening shifts). Price per litre comes from a **Fat × SNF rate chart** (separate chart per milk type).
- Today they keep accounts in a notebook. Operators are not technical: the UI must be simple, large-touch, and in **Marathi first**.
- The buying dairy is **not decided yet**: rate charts must be configurable and importable from Excel, with effective dates.
- Bills every **7 or 10 days** (configurable per center). The center sells **cattle feed (पशुखाद्य)** on credit and gives **advances (उचल)**; both are deducted from bills.
- Payment to farmers: **UPI and cash**.
- Farmers mostly have WhatsApp; a few do not.

## 2. Deployment model (decided — changed to cloud on 16/11/2026, D-135)

- **Cloud: Vercel + Supabase.** The app (PWA) and the API are hosted on **Vercel**; **Supabase** (PostgreSQL, Mumbai region) is the main database. No server at the centre. (Replaces the earlier self-hosted desktop + Cloudflare Tunnel plan.)
- **Needs internet at the centre.** If it drops, a milk entry waits on the phone (client UUID, retry queue) and is sent when the connection is back; bills, dashboard and printing need the connection. A mobile hotspot is the backup link.
- Everything behind login; the public website and the farmer's own page (by code) are the only open pages.
- Outgoing messages (WhatsApp/SMS) go into an **outbox queue** in the database and are sent by a scheduled job (Vercel Cron); nothing is lost while a provider is down.
- **SMS**: the centre's SIM in an Android SMS-gateway app must be reachable from the cloud (the app's cloud mode), or a DLT SMS provider is used.
- **Backups**: Supabase's own backups (paid plan) + our daily dump to an off-site folder. Restore must be documented and tested.
- **Cost** (client's accounts): Vercel **Pro** (the free Hobby plan is non-commercial only) and a paid Supabase plan (free projects pause after a week of no use).
- **Demo link (now)**: the same app on Vercel in test mode — each browser starts from the published demo data (`frontend/public/demo/demo-data.json`, fictional) and keeps its own changes; nothing is shared or saved centrally.

## 3. Messaging (decided)

- **WhatsApp**: Meta **WhatsApp Cloud API** directly (no paid middleman/BSP). Use approved **utility** templates. Approx cost ₹0.115–0.15 per message (India, 2026) — paid from the client's own Meta account.
- **Per-entry message** (changed by the owner, D-73): as soon as a milk entry is saved, the farmer gets ONE message for that entry (date, shift, milk type, litres, Fat, SNF, rate, amount). An approved correction sends a short correction message. This replaced the evening daily summary.
- **Bill**: at the end of each bill cycle, send the Marathi **PDF bill** on WhatsApp.
- **SMS fallback** for farmers without WhatsApp (or when WhatsApp delivery fails): sent from the center's own SIM, which has **100 free SMS/day**, via an **Android phone running an SMS-gateway app** on the LAN (candidate: open-source "SMS Gateway for Android" local-server mode — verify current project/API before use). SMS carries a short summary and, for bills, a link to the bill page instead of a PDF.
  - Enforce a daily SMS cap (default 95) and keep a counter; overflow waits for the next day or goes to an optional DLT SMS gateway if one is configured later.
  - Marathi SMS is Unicode (~70 chars/segment): keep SMS templates short.
  - Send only account/transaction messages to registered farmers who agreed to receive them. Never promotional messages from the SIM.
- The WhatsApp number and the SMS SIM are the client's separate business number.

## 4. Modules (Phase 1 scope)

1. **Farmer master**: code (unique per center), name, village, mobile, has_whatsapp, milk type(s), UPI ID, optional bank details, optional Aadhaar (only if a govt subsidy scheme needs it; store encrypted and mask in UI), active flag.
2. **Rate charts**: per milk type, Fat × SNF grid, `effective_from` date, history kept, Excel import/export, clear rule for values between grid points (configurable: exact / nearest-lower / nearest).
3. **Milk collection entry** (shift-wise): farmer code → litres, Fat, SNF → rate and amount auto-filled. Block duplicate entry for same farmer/date/shift/milk type. Corrections need owner approval and are audit-logged. Optional Bluetooth 58 mm thermal receipt.
4. **Cattle feed & advance ledger**: feed stock in/out, credit sales per farmer, advances with per-cycle installment, running balances.
5. **Billing**: 7/10-day cycles; gross milk amount − feed − advance installment − previous dues = net payable. Marathi PDF bill (design in `design-assets/bill/`). Generate for all farmers in one action; finalize locks the cycle.
6. **Payments**: cash or UPI (with UPI reference), payment register, daily cash vs UPI totals, unpaid list. **UPI payouts (D-107)**: each farmer's UPI ID is checked with ₹1 (bank's name confirmed by the owner); farmers choose when they are paid (daily / on bill date / fixed date / month end); the owner approves the day's list with PIN or sets automatic payouts at a fixed time. Gateway (Cashfree Payouts / RazorpayX) not chosen yet — simulated until then.
7. **Dairy dispatch & owner dashboard**: litres sent to the dairy per shift with Fat/SNF/rate/amount received; collected vs dispatched (shrinkage); purchase vs sale margin; today's litres by shift and milk type; avg Fat/SNF trend; dues; top/low suppliers.
8. **Messaging**: WhatsApp message per milk entry (D-73) + bill PDF + notices (D-72), SMS fallback, outbox with status/retries, message log per farmer.
9. **Branding**: logo, colors and fonts from `design-assets/` used across app, bills, receipts and messages.
10. **Expenses (खर्च, D-126)**: owner and operator enter centre expenses (monthly ones spread per day, optional bill photo); an operator's change needs the owner; message costs and payout fees are counted automatically; the dashboard shows net profit after expenses.

Out of scope for Phase 1 (do not build unless asked): direct analyzer/weighing-scale integration (Phase 2), dairy-specific report formats, govt subsidy report formats, full accounting/GST/Tally, separate farmer app, multiple centers in production.

## 5. Users and roles

- **Login** (D-137): staff (owner, operators, Bokare support) with a 4-digit PIN + an OTP on their WhatsApp; farmers with their farmer code only (no password). The login page shows only these two options.
- **Owner (admin)**: everything, settings, rate charts, approvals, reports, dashboard (also remotely via tunnel).
- **Operator**: collection entry, feed/advance entries, receipts, the tabs the owner allows (D-86). Can add a farmer (D-69); any change to an existing farmer's details goes to the owner for approval (D-108). Cannot change rates or finalized bills.
- **Farmer**: own read-only page by farmer code (D-47) — milk, bills, UPI payments, doctors, schemes, help; asks for changes to their details, which the owner approves (D-108). Also receives WhatsApp/SMS and bill links.
- **Bokare support** (D-109): separate login (#/login?as=support, not on the centre's list); answers everyone's help tickets.

## 6. Engineering rules

- **Money in integer paise**, never floats. Litres as fixed decimal (2 places), Fat/SNF as 1 decimal. Rounding rules documented and tested.
- Every write that matters is **audit-logged** (who, when, before/after).
- Collection entries carry a client-generated UUID so retries/sync are idempotent.
- Marathi UI strings live in a translation file (`mr` default, `en` secondary); no hard-coded UI text in components.
- Dates in IST; display `DD/MM/YYYY`. Shift = `morning` | `evening` (UI: सकाळ / संध्याकाळ).
- Numbers: Latin digits by default in tables/inputs; a setting can show Marathi digits on printed bills.
- Must run well on an old desktop (assume 4 GB RAM, Windows 10/11) and on cheap Android phones (Chrome). Keep dependencies lean.
- Secrets only in `.env` (never committed). Provide `.env.example`.
- Tests for: rate lookup, bill calculation, deductions, rounding, duplicate-entry rules, SMS daily cap, outbox retry.
- Ask before adding a heavy dependency or changing a decision recorded in this file. Record new decisions in `docs/decisions.md`.

## 7. Brand

See `design-assets/README.md`. Primary blue `#1F4E9A`, green `#2E7D32`, grass `#8FAD3E`, sky `#E3EFF8`, text `#1A1A1A`, font **Mukta** (Google Fonts, weights 400–800). Tagline: **शुद्धता • पारदर्शकता • विश्वास**.

## 8. Repository layout (target)

```
arag-dudh-sankalan/
  CLAUDE.md              this brief
  SETUP_PROMPT.md        first-run prompt for Claude Code
  design-assets/         logos, letterhead, bill design (HTML + PNG) — source of truth for visuals
  docs/                  requirements, decisions.md, deployment & backup/restore guide
  backend/               API, DB, billing engine, messaging workers
  frontend/              PWA (operator app + owner dashboard)
  scripts/               install/run as Windows service, backup, restore, seed data
  .env.example
```
