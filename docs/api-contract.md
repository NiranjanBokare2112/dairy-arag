# API contract (frontend ↔ backend)

The frontend calls one object, `api` (`frontend/public/src/api/index.js`). It currently points at an in-browser mock (`api/mock.js`). The backend must expose the same operations over HTTP (`/api/...`, JSON). Then a thin `api/http.js` with the same method names replaces the mock and no page changes.

Conventions:
- **Units:** money is integer paise, litres ×100, Fat/SNF ×10, and dates are IST `YYYY-MM-DD`.
- **Scoping:** every record carries `centerId`. The server takes it from the session, never from the client.
- **Errors:** `{ code }` with one of the codes in `i18n/*.js` under `err.*`, for example `duplicate`, `cycle-locked`, `forbidden` or `rate-fat-out-of-range`. A `duplicate` error also returns the existing entry.
- **Audit log:** every write is recorded with user, time, and before/after values.

| Method | Role | Notes |
|---|---|---|
| `users()`, `login(userId, pin)`, `logout()`, `me()` | — | PIN login. The server hashes PINs and rate-limits attempts. |
| `center()`, `saveCenter(patch)`, `changePin(userId, pin)` | owner (writes) | Covers the cycle length (7 or 10 days), rate rule, daily summary time, SMS cap, Marathi digits on bills, and the public URL. |
| `farmers({includeInactive})`, `farmer(id)`, `farmerByCode(code)`, `nextFarmerCode()`, `saveFarmer(f)` | owner: add + edit; operator: add new only (D-69) | `farmer(id)` includes `balances`. Aadhaar goes in as 12 digits, is stored encrypted, and only `aadhaarLast4` is returned. |
| `charts()`, `chart(id)`, `saveChart({milkType, effectiveFrom, fats, snfs, rates, note})`, `quote({...})` | owner (writes) | Charts are immutable versions. `quote` prices an entry without saving it. |
| `collections({date, shift, farmerId, from, to})`, `collection(id)`, `addCollection(entry)` | owner, operator | `entry.id` is the client UUID. Resending the same id returns the stored entry, so retries are idempotent. Duplicate rule: same farmer, date, shift and milk type. |
| `requestCorrection(entryId, {...})`, `corrections({status})`, `decideCorrection(id, approve)` | owner decides | Corrections in a finalized cycle are rejected. |
| `schemes({all})`, `saveScheme(s)`, `deleteScheme(id)` | read: public (published, not past last date); `all` and writes: owner | Government schemes shown on the website (D-71). |
| `broadcast({text, audience, codes, sms, preview})` | owner, operator | Notice to farmers (D-72): WhatsApp to consented farmers; SMS only if `sms` (center notices only). Real backend: an approved WhatsApp template with the text as a variable. |
| `doctors({all})`, `saveDoctor(d)`, `deleteDoctor(id)` | read: public (shown ones); `all` and writes: owner | Veterinary doctors on the farmers' page and website (D-83). |
| `feedItems()`, `saveFeedItem()`, `feedMoves()`, `feedMove(id)`, `addFeedMove({type:'in'|'sale', ...})`, `advances()`, `addAdvance()`, `balances(farmerId)` | stock-in is owner only | |
| `cycleFor(date)`, `previousCycle(c)`, `cycle(start, end)`, `cycles()`, `generateBills({start, end})`, `finalizeCycle(id)`, `bills({cycleId, farmerId})`, `bill(id)`, `billByToken(token)` | owner | Finalize locks the cycle and queues the bill messages. `billByToken` is public and returns final bills only. |
| `addPayment({billId, mode, amountPaise, upiRef, date})`, `payments({date})`, `unpaidBills()` | owner | A UPI payment requires `upiRef`. |
| `dispatches({from, to})`, `addDispatch(d)` | owner, operator | One entry per date, shift and milk type. |
| `queueDailySummary(date)`, `outbox({farmerId, status})`, `smsCounter()`, `runOutbox()`, `retryMessage(id)` | | On the server, the outbox worker runs on a timer, not from the UI. |
| `dashboard()` | owner | Returns today by shift and milk type, a 14-day trend, shrinkage and margin, dues, and top/low suppliers. |
| `audit()`, `exportBackup()` | owner | |

The business rules come from `frontend/public/src/lib/` and its tests in `frontend/tests/`. They are plain ES modules, so a Node backend can import them directly. A backend in any other language must port them and pass the same test cases.

| `buyers({includeInactive})`, `saveBuyer(b)` | owner (writes), operator reads | Daily milk buyers (D-51). `saveBuyer`: name, mobile, area, milkType, ratePaise, morningX100, eveningX100, active. |
| `buyerDay({date, shift})`, `saveBuyerDay({date, shift, rows:[{buyerId, litresX100}]})` | owner, operator | The daily sheet. New entries take the buyer's current rate; edits keep the entry's rate; a closed month → `month-locked`; future date → `invalid-date`. |
| `counterSales({date})`, `addCounterSale({id, date, shift, milkType, litresX100, mode, upiRef?, name?})`, `voidCounterSale({id, reason})` | owner, operator | Walk-in sales (D-53). Rate = center counter rate for the milk type; same `id` twice = one sale; `reason-required`, `invalid-litres`, `invalid-date`, `month-locked`. Day view returns rows (newest first, voided included), `rates`, totals (litres, amount, cash, UPI, cow, buffalo). |
| `saveCounterRates({cowPaise, buffaloPaise})` | owner | Walk-in price per litre; new sales only. `buyerMonth` also returns `counter` (litres, amount, count, cash, UPI) and `dashboard` returns `counterSoldX100`, `counterRangeX100`, `counterRangePaise`. |
| `buyerMonth(month)`, `buyerStatement({buyerId, month})`, `addBuyerPayment({...})`, `closeBuyerMonth(month)` | owner | Month account (previous + this month − received = balance), day-by-day statement, payments (UPI needs `upiRef`), closing a finished month (`month-not-over` otherwise). |

