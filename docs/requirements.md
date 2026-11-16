# Requirements — Phase 1

Derived from `CLAUDE.md` §1–6. Tick `[x]` when built **and** tested.

## A. Functional

### A1. Farmer master
- [ ] A1.1 Farmer code, unique per center.
- [ ] A1.2 Fields: name, village, mobile, has_whatsapp, milk type(s) (cow/buffalo), UPI ID, active flag.
- [ ] A1.3 Optional bank details.
- [ ] A1.4 Optional Aadhaar — only when a govt scheme needs it; stored encrypted, masked in UI.
- [ ] A1.5 Messaging consent flag (needed for D-12).

### A2. Rate charts
- [ ] A2.1 Separate Fat × SNF grid per milk type.
- [ ] A2.2 Each chart has `effective_from` date; history kept; correct chart chosen by collection date.
- [ ] A2.3 Excel import and export.
- [ ] A2.4 Configurable rule for values between grid points: exact / nearest-lower / nearest.
- [ ] A2.5 Only owner can create/change charts.

### A3. Milk collection
- [ ] A3.1 Shift-wise entry (morning/evening — सकाळ/संध्याकाळ).
- [ ] A3.2 Farmer code → litres, Fat, SNF → rate and amount auto-filled.
- [ ] A3.3 Block duplicate entry for same farmer + date + shift + milk type.
- [ ] A3.4 Corrections require owner approval and are audit-logged.
- [ ] A3.5 Client-generated UUID per entry; retries/sync are idempotent.
- [ ] A3.6 Optional Bluetooth 58 mm thermal receipt.

### A4. Cattle feed & advance ledger
- [ ] A4.1 Feed stock in/out.
- [ ] A4.2 Feed credit sales per farmer.
- [ ] A4.3 Advances (उचल) with per-cycle installment.
- [ ] A4.4 Running balances per farmer.

### A5. Billing
- [ ] A5.1 Bill cycle length 7 or 10 days, configurable per center.
- [ ] A5.2 Net payable = gross milk amount − feed − advance installment − previous dues.
- [ ] A5.3 Marathi PDF bill per farmer (design: `design-assets/bill/`).
- [ ] A5.4 Generate bills for all farmers in one action.
- [ ] A5.5 Finalize locks the cycle; operators cannot change finalized bills.
- [ ] A5.6 Bill page reachable by link (for SMS).

### A6. Payments
- [ ] A6.1 Record cash or UPI payment (UPI reference required for UPI).
- [ ] A6.2 Payment register.
- [ ] A6.3 Daily cash vs UPI totals.
- [ ] A6.4 Unpaid list.

### A7. Dairy dispatch & owner dashboard
- [ ] A7.1 Record litres dispatched to dairy per shift with Fat/SNF/rate/amount received.
- [ ] A7.2 Collected vs dispatched (shrinkage).
- [ ] A7.3 Purchase vs sale margin.
- [ ] A7.4 Today's litres by shift and milk type.
- [ ] A7.5 Avg Fat/SNF trend.
- [ ] A7.6 Dues; top/low suppliers.

### A8. Messaging
- [ ] A8.1 WhatsApp message per milk entry as soon as it is saved; correction message after an approved correction (D-73, replaced the evening daily summary).
- [ ] A8.2 Bill PDF on WhatsApp at end of cycle.
- [ ] A8.3 SMS fallback when no WhatsApp or WhatsApp delivery fails; bills via link.
- [ ] A8.4 Daily SMS cap (default 95) with counter; overflow deferred to next day (or optional DLT gateway).
- [ ] A8.5 Outbox with status and retries; nothing lost while offline.
- [ ] A8.6 Message log per farmer.
- [ ] A8.7 Only transactional messages to consenting registered farmers.

### A9. Branding
- [ ] A9.1 Logo, colors, Mukta font from `design-assets/` across app, bills, receipts, messages.

### A10. Users and roles
- [ ] A10.1 Owner (admin): everything — settings, rate charts, approvals, reports, dashboard (also remote).
- [ ] A10.2 Operator: collection, feed/advance entries, receipts. Cannot change rates or finalized bills.
- [ ] A10.3 Farmers have no login; receive WhatsApp/SMS and bill links.

## B. Non-functional

### B1. Deployment & availability
- [ ] B1.1 Runs self-hosted on the center's Windows 10/11 desktop (assume 4 GB RAM), as a Windows service.
- [ ] B1.2 Fully usable offline over LAN (collection, billing, printing).
- [ ] B1.3 Remote owner access via Cloudflare Tunnel, behind login.
- [ ] B1.4 Local daily backup + one off-site copy; restore documented and tested.

### B2. Data & correctness
- [ ] B2.1 Money stored as integer paise; never floats.
- [ ] B2.2 Litres fixed decimal 2 places; Fat/SNF 1 decimal.
- [ ] B2.3 Rounding rules documented and tested.
- [ ] B2.4 Every important write audit-logged (who, when, before/after).
- [ ] B2.5 Every business table carries `center_id` (multi-center ready).

### B3. Localisation & UX
- [ ] B3.1 Marathi first (`mr` default, `en` secondary); all UI strings in translation files.
- [ ] B3.2 Dates in IST, displayed `DD/MM/YYYY`.
- [ ] B3.3 Latin digits in tables/inputs; setting for Marathi digits on printed bills.
- [ ] B3.4 Simple, large-touch UI for non-technical operators.
- [ ] B3.5 Runs well on cheap Android phones (Chrome) — PWA.

### B4. Engineering
- [ ] B4.1 Lean dependencies; ask before adding a heavy one.
- [ ] B4.2 Secrets only in `.env`; `.env.example` provided.
- [ ] B4.3 Tests: rate lookup, bill calculation, deductions, rounding, duplicate-entry rules, SMS daily cap, outbox retry.
- [ ] B4.4 New decisions recorded in `docs/decisions.md`.

## C. Out of scope (Phase 1)
Analyzer/weighing-scale integration (Phase 2), dairy-specific and govt subsidy report formats, automated UPI payouts, full accounting/GST/Tally, separate farmer app, multiple centers in production.
