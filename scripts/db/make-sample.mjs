// Generates scripts/db/sample-data.json: realistic sample rows for every PostgreSQL table, loaded with
// `python -m app.cli seed` in backend/. (The old SQLite draft files were removed; PostgreSQL is the database.)
//
//   node scripts/db/make-sample.mjs            (from the repo root; needs Node 18+)
//   node scripts/db/make-sample.mjs --until=2026-11-23 --out=scripts/db/test-data-until-2026-11-23.json
//        (test data up to that day: milk, dispatch, buyers, expenses …; keep sample-data.json as it is — the backend tests expect it)
//
// The data is not typed by hand: it is produced by the app's own business rules (the frontend's mock
// backend + frontend/public/src/lib/*, the same code the tests cover), so rates, amounts, rounding,
// bills, deductions and balances are consistent with each other:
//   1. buildSeed(): center, 2 users, 12 farmers, cow + buffalo rate charts, ~19 days of milk (both shifts),
//      dairy dispatches, feed stock, 2 advances, login history.
//   2. Billing (done by the mock on first start): the previous bill period is generated and finalized and
//      3 of every 4 bills paid (UPI with UTR / cash); this script adds a part payment and a cash payment,
//      so the sample has paid (UPI and cash), part-paid and unpaid bills.
//   3. Extra activity: feed stock bought, a +₹1 cow price change that re-prices the open period,
//      a new advance, an operator's correction (approved) and one still pending.
//   4. Messages: bill messages, one message per new milk entry (D-73), a correction message, a notice to all
//      farmers (D-72); most "sent", a few left queued. 5. Government schemes (D-71, D-92).
//   6. UPI payouts (D-107, simulated gateway): ₹1 checks of six UPI IDs (one name rejected) and one approved payout run.
//   8. Help tickets (D-109): an operator's (open) and a farmer's (answered by Bokare support, solved).
//   7. Change requests (D-108): an operator's edit waiting for the owner, and a farmer's own request (approved).
// Dates are relative to the day the script runs. All names, mobiles and UPI ids are fictional.
// PINs are stored as scrypt hashes; sample PINs: owner 1234, operator 1111.
import { writeFileSync } from 'node:fs';
import { createHash, scryptSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../../frontend/public/src/');

// ---- optional clock: --now=2026-11-11T10:00+05:30 builds the data as if it were that moment ----------
// (entries up to that shift, earlier bill periods closed and billed). Default: the real time.
const NOW_ARG = process.argv.find((a) => a.startsWith('--now='))?.slice(6);
if (NOW_ARG) {
  const target = new Date(NOW_ARG).getTime();
  if (Number.isNaN(target)) throw new Error('bad --now: ' + NOW_ARG);
  const RealDate = Date; const shift = target - RealDate.now();
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + shift); }
    static now() { return RealDate.now() + shift; }
  };
  console.log('clock set to', new Date().toISOString());
}

// ---- run the app's mock backend in Node ------------------------------------------------------------
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const ANDROID = 'Mozilla/5.0 (Linux; Android 12; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ANDROID, onLine: true }, configurable: true });

const { api } = await import(new URL('api/mock.js', 'file:///' + SRC.replace(/\\/g, '/')).href);
const lib = (p) => import(new URL(p, 'file:///' + SRC.replace(/\\/g, '/')).href);
const { todayIST, addDays } = await lib('lib/dates.js');
const { cycleFor, previousCycle, cycleKey } = await lib('lib/cycles.js');
const { adjustChart } = await lib('lib/rates.js');

const today = todayIST();
await api.login('u-owner', '1234');
const center = await api.center();
const cur = cycleFor(today, center.cycleDays, center.cycleAnchor);
const prev = previousCycle(cur, center.cycleDays, center.cycleAnchor);

const farmers = await api.farmers();
const F = (code) => farmers.find((f) => f.code === code);
await api.addFeedMove({ itemId: 'fi1', type: 'in', qty: 20, pricePaise: 132000, date: addDays(cur.start, 1), note: 'खरेदी' });

// The mock's first start already billed and finalized the previous period and paid 3 of every 4 bills
// (UPI with UTR for farmers with a UPI id, otherwise cash). Add a part payment and a full cash payment on two unpaid bills.
const prevId = cycleKey(prev);
const unpaid = (await api.bills({ cycleId: prevId })).filter((b) => b.payablePaise > b.paidPaise);
if (unpaid[0]) await api.addPayment({ billId: unpaid[0].id, mode: 'cash', amountPaise: Math.round((unpaid[0].payablePaise - unpaid[0].paidPaise) / 200) * 100, date: addDays(prev.end, 3) });
if (unpaid[1]) await api.addPayment({ billId: unpaid[1].id, mode: 'cash', amountPaise: unpaid[1].payablePaise - unpaid[1].paidPaise, date: addDays(prev.end, 2) });

// price change: cow +₹1/L from the 5th day of the open period, re-pricing entries already recorded
const charts = await api.charts();
const cowBase = charts.find((c) => c.milkType === 'cow');
const adj = adjustChart(cowBase, 100);
const adjChart = await api.saveChart({ milkType: 'cow', effectiveFrom: addDays(cur.start, 4), fats: adj.fats, snfs: adj.snfs, rates: adj.rates, note: 'डेअरीचा नवीन दर (+₹1)', reprice: true });

// a new advance in the open period
// days inside the open period (on its first day that is just today): corrections there are allowed
const openDay = (k) => (addDays(today, -k) >= cur.start ? addDays(today, -k) : today);
await api.addAdvance({ farmerId: F(103).id, amountPaise: 200000, installmentPaise: 50000, date: openDay(1), note: 'चारा खरेदी' });

// corrections: operator asks for two; owner approves one, the other stays pending
await api.logout(); await api.login('u-op1', '1111');
const yesterday = addDays(today, -1);
const e1 = (await api.collections({ date: openDay(1) })).find((e) => e.shift === 'morning');
const c1 = await api.requestCorrection(e1.id, { litresX100: e1.litresX100, fatX10: e1.fatX10 + 3, snfX10: e1.snfX10, reason: 'फॅट चुकीचा टाकला (मशीनवर जास्त होता)' });
const e2 = (await api.collections({ date: openDay(2) })).find((e) => (openDay(2) === today || e.shift === 'evening') && e.farmerId !== e1.farmerId && e.id !== e1.id);
await api.requestCorrection(e2.id, { litresX100: e2.litresX100 - 50, fatX10: e2.fatX10, snfX10: e2.snfX10, reason: 'लिटर चुकीचे — ५० मिली कमी' });
await api.logout(); await api.login('u-owner', '1234');
await api.decideCorrection(c1.id, true);

// messages (D-72, D-73): new milk entries send one message each; a notice to all farmers; send, then leave a
// couple of fresh entry messages queued
const sample = async (n) => {
  const done = new Set((await api.collections({ date: today })).map((e) => `${e.farmerId}|${e.shift}|${e.milkType}`));
  const proto = Object.fromEntries((await api.collections({ date: addDays(today, -1) })).map((e) => [e.milkType, e]));
  let added = 0;
  for (const f of await api.farmers()) for (const shift of ['morning', 'evening']) for (const m of f.milkTypes) {
    if (added >= n || done.has(`${f.id}|${shift}|${m}`) || !proto[m]) continue;
    const p = proto[m];
    try { await api.addCollection({ id: crypto.randomUUID(), farmerId: f.id, date: today, shift, milkType: m, litresX100: p.litresX100, fatX10: p.fatX10, snfX10: p.snfX10 }); added++; done.add(`${f.id}|${shift}|${m}`); } catch { /* slot taken */ }
  }
};
await sample(3);
await api.broadcast({ text: 'उद्या सकाळचे संकलन ७ ऐवजी ८ वाजता सुरू होईल. — आरग दूध संकलन केंद्र', audience: 'all' });
await api.runOutbox();
// 6. UPI payouts (D-107): ₹1 checks (one name rejected), the daily farmers paid through an approved run
for (const code of [101, 102, 103, 104, 105, 110]) {
  const c = await api.verifyUpi(F(code).id);
  if (c.status === 'name-check') await api.confirmUpiName({ farmerId: F(code).id, ok: !c.bankName.startsWith('SHRI') });
}
await api.setPayApproval({ farmerIds: [F(104).id], on: true }); // D-111: 104's payouts wait for the owner
await api.setDeductionConsent({ farmerId: F(103).id, consent: true });
await api.savePayoutSettings({ mode: 'approve', time: '21:30', lagDays: 1, minPaise: 10000, simDelayMs: 0,
  funding: { accountName: 'आरग दूध संकलन केंद्र', bankName: 'बँक ऑफ महाराष्ट्र', accountNo: '60123456789', ifsc: 'MAHB0000123' } });
const poRun = await api.createPayoutRun();
if (poRun.items.length) await api.approvePayoutRun({ runId: poRun.id, payoutIds: poRun.items.map((x) => x.id), pin: '1234' });
await api.payoutPulse(); // the (simulated) gateway confirms by webhook
await sample(2);
// 7. change requests (D-108): an operator's edit (waiting) and a farmer's own request (approved)
await api.logout(); await api.login('u-op1', '1111');
await api.saveFarmer({ ...(await api.farmer(F(106).id)), mobile: '9822000106', changeNote: 'शेतकऱ्याने नवीन नंबर दिला' });
await api.logout(); await api.farmerLogin(107);
const myReq = await api.requestMyChange({ fields: { bankName: 'बँक ऑफ महाराष्ट्र', bankIfsc: 'MAHB0000123' }, note: 'नवीन बँक खाते' });
await api.logout(); await api.login('u-owner', '1234');
await api.decideChange(myReq.id, true);
// 8. help tickets (D-109): an operator's (open) and a farmer's, answered by Bokare support and solved
await api.logout(); await api.login('u-op1', '1111');
await api.createTicket({ category: 'app', subject: 'प्रिंटर जोडला जात नाही', text: 'ब्लूटूथ प्रिंटर यादीत दिसत नाही. फोन रीस्टार्ट केला तरी तसेच.' });
await api.logout(); await api.farmerLogin(103);
const tk = await api.createTicket({ category: 'milk', subject: 'कालचे दूध दिसत नाही', text: 'कालचे संध्याकाळचे दूध माझ्या नोंदीत दिसत नाही.', priority: 'urgent' });
await api.logout(); await api.login('u-support', '9999');
await api.replyTicket(tk.id, 'तपासले — नोंद आता दिसेल. कृपया पुन्हा पहा.');
await api.setTicketStatus(tk.id, 'resolved');
await api.logout();
// 9. --until=YYYY-MM-DD: test data up to that day (D-112 / D-126) — milk, dispatch, buyers, walk-in sales, sample expenses,
//    and once every newer screen's examples (payouts in every state, approvals, change requests, tickets)
const UNTIL = process.argv.find((x) => x.startsWith('--until='))?.slice(8);
if (UNTIL) { await api.login('u-owner', '1234'); console.log('test data until', UNTIL, await api.demoFill({ until: UNTIL })); await api.logout(); }

const db = JSON.parse(store.get('arag.db.v2'));

// ---- helpers -----------------------------------------------------------------------------------
const j = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const seeded = (s) => createHash('sha256').update('arag-sample:' + s).digest();
const pinHash = (pin, id) => { const salt = seeded('salt' + id).subarray(0, 16); return `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync(pin, salt, 32).toString('base64')}`; };
const counts = {};
const data = {}; // same rows as JSON for the backend loader (backend/app/loader.py): booleans stay true/false, bytes → {"$hex": …}
const jsonVal = (v) => (v instanceof Buffer ? { $hex: v.toString('hex') } : v === undefined ? null : v);
function insert(table, cols, rows) {
  counts[table] = rows.length;
  data[table] = rows.map((r) => Object.fromEntries(cols.map((col, i) => [col, jsonVal(r[i])])));
}
const created = db.users[0].createdAt;

// ---- tables ------------------------------------------------------------------------------------
const c = db.center;
insert('centers', ['id', 'name', 'name_en', 'address', 'mobile', 'dairy_name', 'cycle_days', 'cycle_anchor', 'rate_rule', 'daily_summary_time', 'sms_cap',
  'marathi_digits_on_bill', 'public_base_url', 'morning_from', 'morning_to', 'evening_from', 'evening_to', 'owner_name', 'owner_title', 'owner_message',
  'owner_photo_path', 'payout', 'name_words', 'msg_cost_paise', 'created_at', 'updated_at'],
[[c.id, c.name, c.nameEn, c.address, c.mobile, c.dairyName || '', c.cycleDays, c.cycleAnchor, c.rateRule, c.dailySummaryTime, c.smsCap, c.marathiDigitsOnBill,
  'https://arag.in', c.morningFrom, c.morningTo, c.eveningFrom, c.eveningTo, 'श्री. संजय पाटील', 'मालक, आरग दूध संकलन केंद्र',
  'शेतकऱ्यांना योग्य दर, अचूक मोजणी आणि वेळेवर पैसे — हाच आमचा शब्द.', 'data/uploads/owner.jpg', c.payout || null, db.nameWords || {}, c.msgCostPaise ?? 13, created, created]]);

const PINS = { 'u-owner': '1234', 'u-op1': '1111' };
insert('users', ['id', 'center_id', 'name', 'role', 'pin_hash', 'pin_length', 'mobile', 'active', 'pages', 'created_at', 'updated_at'],
  db.users.map((u) => [u.id, u.centerId, u.name, u.role, pinHash(PINS[u.id] || u.pin, u.id), (PINS[u.id] || u.pin).length, u.mobile || '', u.active !== false, u.role === 'operator' && Array.isArray(u.pages) ? u.pages : null, u.createdAt, u.createdAt]));

insert('sessions', ['id', 'center_id', 'user_id', 'farmer_id', 'token_hash', 'login_at', 'last_seen_at', 'logout_at', 'user_agent', 'ip', 'via_tunnel'],
  db.sessions.map((s, i) => { const owner = s.userId === 'u-owner'; return [s.id, s.centerId, s.userId || null, s.farmerId || null, sha('token:' + s.id), s.loginAt, s.lastSeenAt, s.logoutAt,
    s.ua, owner && i % 2 ? '172.71.94.' + (20 + i) : '192.168.1.' + (owner ? 10 : 21), owner && i % 2 ? 1 : 0]; }));

// every farmer has a made-up Aadhaar ending (D-70) and bank details (D-79); the "ciphertext" is a random placeholder
const AADHAAR = Object.fromEntries(db.farmers.filter((f) => f.aadhaarLast4).map((f) => [f.id, f.aadhaarLast4]));
insert('farmers', ['id', 'center_id', 'code', 'name', 'village', 'mobile', 'has_whatsapp', 'consent', 'consent_at', 'milk_cow', 'milk_buffalo', 'upi_id',
  'bank_name', 'bank_account', 'bank_ifsc', 'aadhaar_enc', 'aadhaar_last4', 'active', 'pay_kind', 'pay_day', 'upi_check',
  'pay_method', 'bank_check', 'pay_approval', 'deduction_consent_at', 'deduction_consent_by', 'name_en', 'name_en_auto', 'created_at', 'updated_at'],
db.farmers.map((f) => [f.id, f.centerId, f.code, f.name, f.village, f.mobile, f.hasWhatsapp, f.consent, f.consent ? f.createdAt : null,
  f.milkTypes.includes('cow'), f.milkTypes.includes('buffalo'), f.upiId || '',
  f.bankName || '', f.bankAccount || '', f.bankIfsc || '',
  AADHAAR[f.id] ? Buffer.concat([seeded('nonce' + f.id).subarray(0, 12), seeded('ct' + f.id).subarray(0, 28)]) : null, AADHAAR[f.id] || '',
  f.active, f.payPref?.kind || 'bill', f.payPref?.kind === 'day' ? f.payPref.day : null, f.upiCheck || { status: 'none' },
  f.payMethod || 'upi', f.bankCheck || { status: 'none' }, !!f.payApproval, f.deductionConsent?.at || null, f.deductionConsent?.by || null, f.nameEn || '', !!f.nameEnAuto, f.createdAt, f.createdAt]));

const rng = (a) => [Math.min(...a), Math.max(...a)];
insert('rate_charts', ['id', 'center_id', 'side', 'milk_type', 'effective_from', 'effective_to', 'fat_min_x10', 'fat_max_x10', 'snf_min_x10', 'snf_max_x10', 'source',
  'adjust_paise', 'note', 'created_at', 'created_by'],
db.charts.map((r) => { const isAdj = r.id === adjChart.id; return [r.id, r.centerId, r.side === 'dairy' ? 'dairy' : 'farmer', r.milkType, r.effectiveFrom, r.effectiveTo || null, ...rng(r.fats), ...rng(r.snfs),
  isAdj ? 'adjust' : 'manual', isAdj ? 100 : null, r.note || '', r.createdAt, r.createdBy]; }));

const cells = [];
for (const r of db.charts) r.fats.forEach((fat, i) => r.snfs.forEach((snf, k) => cells.push([r.id, fat, snf, r.rates[i][k]])));
insert('rate_chart_cells', ['chart_id', 'fat_x10', 'snf_x10', 'rate_paise'], cells);

insert('feed_items', ['id', 'center_id', 'name', 'unit', 'price_paise', 'active', 'created_at', 'updated_at'],
  db.feedItems.map((i) => [i.id, i.centerId, i.name, i.unit, i.pricePaise, i.active, created, created]));

const advRows = db.advances.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
insert('advances', ['id', 'center_id', 'farmer_id', 'date', 'amount_paise', 'installment_paise', 'mode', 'note', 'created_at', 'created_by'],
  advRows.map((a, i) => [a.id, a.centerId, a.farmerId, a.date, a.amountPaise, a.installmentPaise, i === 1 ? 'upi' : 'cash', a.note || '', a.createdAt, a.createdBy]));

const billOfEntry = new Map(); for (const b of db.bills) for (const id of b.entryIds) billOfEntry.set(id, b.id);
insert('collections', ['id', 'center_id', 'farmer_id', 'date', 'shift', 'milk_type', 'litres_x100', 'fat_x10', 'snf_x10', 'chart_id', 'rate_paise', 'amount_paise',
  'void', 'bill_id', 'repriced_at', 'created_at', 'created_by', 'device_id'],
db.collections.slice().sort((a, b) => (a.date + a.shift + a.farmerId < b.date + b.shift + b.farmerId ? -1 : 1)).map((e) => [e.id, e.centerId, e.farmerId, e.date, e.shift,
  e.milkType, e.litresX100, e.fatX10, e.snfX10, e.chartId, e.ratePaise, e.amountPaise, e.void, billOfEntry.get(e.id) || null,
  e.chartId === adjChart.id && e.date < today ? adjChart.createdAt : null, e.createdAt, e.createdBy, e.createdBy === 'u-op1' ? 'tab-01' : 'desk-01']));

insert('corrections', ['id', 'center_id', 'collection_id', 'reason', 'before_json', 'after_json', 'status', 'requested_at', 'requested_by', 'decided_at', 'decided_by'],
  db.corrections.map((r) => [r.id, r.centerId, r.entryId, r.reason, j(r.before), j(r.after), r.status, r.requestedAt, r.requestedBy, r.decidedAt || null, r.decidedBy || null]));

const billFor = (farmerId, date) => db.bills.find((b) => b.farmerId === farmerId && date >= b.start && date <= b.end);
insert('feed_moves', ['id', 'center_id', 'item_id', 'type', 'date', 'qty', 'price_paise', 'amount_paise', 'farmer_id', 'bill_id', 'note', 'created_at', 'created_by'],
  db.feedMoves.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((m) => [m.id, m.centerId, m.itemId, m.type, m.date, m.qty, m.pricePaise, m.amountPaise,
    m.farmerId || null, m.type === 'sale' ? billFor(m.farmerId, m.date)?.id || null : null, m.note || '', m.createdAt, m.createdBy]));

const cycles = db.cycles.map((y) => [y.id, y.centerId, y.start, y.end, y.status, y.billCount || 0, y.stale ? 1 : 0, y.generatedAt || null, y.finalizedAt || null, y.finalizedBy || null]);
cycles.push([cycleKey(cur), db.center.id, cur.start, cur.end, 'open', 0, 0, null, null, null]);
insert('bill_cycles', ['id', 'center_id', 'start_date', 'end_date', 'status', 'bill_count', 'stale', 'generated_at', 'finalized_at', 'finalized_by'], cycles);

insert('bills', ['id', 'center_id', 'cycle_id', 'farmer_id', 'bill_no', 'bill_date', 'start_date', 'end_date', 'litres_x100', 'avg_fat_x100', 'avg_snf_x100',
  'avg_rate_paise', 'gross_paise', 'feed_paise', 'advance_paise', 'previous_dues_paise', 'total_deduct_paise', 'net_paise', 'payable_paise',
  'carry_forward_dues_paise', 'advance_remaining_paise', 'paid_paise', 'prepaid_paise', 'overpaid_paise', 'status', 'token', 'pdf_path', 'generated_at'],
db.bills.map((b) => [b.id, b.centerId, b.cycleId, b.farmerId, b.no, b.billDate, b.start, b.end, b.litresX100, b.avgFatX100, b.avgSnfX100, b.avgRatePaise,
  b.grossPaise, b.feedPaise, b.advancePaise, b.previousDuesPaise, b.totalDeductPaise, b.netPaise, b.payablePaise, b.carryForwardDuesPaise,
  b.advanceRemainingPaise, b.paidPaise, b.prepaidPaise || 0, b.overpaidPaise || 0, b.status, b.token, b.status === 'final' ? `data/bills/${b.no}.pdf` : null, b.generatedAt]));

// installment taken by each bill, allocated to the farmer's advances oldest first
const left = new Map(advRows.map((a) => [a.id, a.amountPaise]));
const recov = [];
for (const b of db.bills.slice().sort((a, x) => (a.start < x.start ? -1 : 1))) {
  let amt = b.advancePaise;
  for (const a of advRows.filter((x) => x.farmerId === b.farmerId && x.date <= b.end)) {
    if (amt <= 0) break;
    const take = Math.min(amt, left.get(a.id)); if (take <= 0) continue;
    recov.push([sha('rec' + b.id + a.id).slice(0, 32), b.centerId, b.id, a.id, take]); left.set(a.id, left.get(a.id) - take); amt -= take;
  }
}
insert('advance_recoveries', ['id', 'center_id', 'bill_id', 'advance_id', 'amount_paise'], recov);

insert('payout_runs', ['id', 'center_id', 'date', 'mode', 'auto', 'status', 'up_to', 'count', 'total_paise', 'created_at', 'created_by', 'sent_at', 'approved_by', 'cancelled_at'],
  (db.payoutRuns || []).map((r) => [r.id, r.centerId, r.date, r.mode === 'auto' ? 'eod' : r.mode, !!r.auto, r.status, r.upTo, r.count, r.totalPaise,
    r.createdAt, r.createdBy, r.sentAt || null, r.approvedBy || null, r.cancelledAt || null]));
insert('payouts', ['id', 'center_id', 'run_id', 'kind', 'date', 'farmer_id', 'upi_id', 'amount_paise', 'credit_paise', 'fee_paise', 'fee_by', 'parts', 'capped',
  'status', 'ref', 'reason', 'bank_name', 'attempts', 'created_at', 'sent_at', 'done_at', 'approved_by',
  'method', 'dest_label', 'txn_ref', 'breakdown', 'wait_approval', 'decided_by', 'decided_at', 'reversed_at'],
  (db.payouts || []).map((x) => [x.id, x.centerId, x.runId, x.kind, x.date, x.farmerId, x.upiId, x.amountPaise, x.creditPaise, x.feePaise, x.feeBy,
    x.parts || [], !!x.capped, x.status, x.ref || null, x.reason || null, x.bankName || null, x.attempts || 0, x.createdAt, x.sentAt || null, x.doneAt || null, x.approvedBy || null,
    x.method || 'upi', x.destLabel || null, x.txnRef || null, x.breakdown || null, !!x.waitApproval, x.decidedBy || null, x.decidedAt || null, x.reversedAt || null]));
insert('tickets', ['id', 'center_id', 'no', 'reporter_kind', 'reporter_user_id', 'reporter_farmer_id', 'reporter_name', 'category', 'priority', 'subject', 'status', 'unread_for', 'created_at', 'updated_at'],
  (db.tickets || []).map((x) => [x.id, x.centerId, x.no, x.by.kind, x.by.kind === 'farmer' ? null : x.by.id, x.by.kind === 'farmer' ? x.by.id : null, x.by.name,
    x.category, x.priority, x.subject, x.status, x.unreadFor || [], x.createdAt, x.updatedAt]));
insert('ticket_messages', ['id', 'ticket_id', 'author_kind', 'author_name', 'text', 'status', 'at'],
  (db.tickets || []).flatMap((x) => x.messages.map((mm) => [mm.id, x.id, mm.by.kind, mm.by.name, mm.text || null, mm.text ? null : mm.status, mm.at])));
insert('ticket_notifications', ['ticket_id', 'channel', 'event', 'status', 'created_at'],
  (db.tickets || []).flatMap((x) => x.notify.map((n) => [x.id, n.channel, n.event, n.status, n.at])));
// D-126: expenses (photos are files on the desktop; the sample has none)
insert('expense_categories', ['id', 'center_id', 'name', 'monthly', 'active', 'created_at'],
  (db.expenseCategories || []).map((c) => [c.id, c.centerId, c.name, !!c.monthly, c.active !== false, created]));
insert('expenses', ['id', 'center_id', 'date', 'category_id', 'amount_paise', 'mode', 'period', 'note', 'photo_path', 'pending', 'void', 'void_reason', 'voided_at', 'voided_by', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  (db.expenses || []).map((e) => [e.id, e.centerId, e.date, e.categoryId, e.amountPaise, e.mode, e.period, e.note || '', '', e.pending || null, !!e.void, e.voidReason || '',
    e.voidedAt || null, e.voidedBy || null, e.createdAt, e.createdBy, e.updatedAt || null, e.updatedBy || null]));
insert('change_requests', ['id', 'center_id', 'entity', 'entity_id', 'requested_by', 'requested_by_kind', 'fields', 'note', 'status', 'requested_at', 'decided_at', 'decided_by', 'decision_note'],
  (db.changeRequests || []).map((r) => [r.id, r.centerId, r.entity, r.entityId, r.requestedBy, r.requestedByKind, r.fields, r.note || '', r.status, r.requestedAt,
    r.decidedAt || null, r.decidedBy || null, r.decisionNote || '']));
insert('payments', ['id', 'center_id', 'bill_id', 'farmer_id', 'date', 'mode', 'amount_paise', 'upi_ref', 'note', 'source', 'cycle_id', 'payout_id', 'created_at', 'created_by'],
  db.payments.map((p) => { const b = db.bills.find((x) => x.id === p.billId); return [p.id, p.centerId, p.billId || null, p.farmerId, p.date, p.mode, p.amountPaise, p.upiRef || '',
    p.mode === 'cash' && b && b.paidPaise < b.payablePaise ? 'अर्धे पैसे; बाकी पुढच्या आठवड्यात' : '',
    p.source || 'manual', p.cycleId || null, p.payoutId || null, p.createdAt, p.createdBy]; }));

insert('dispatches', ['id', 'center_id', 'date', 'shift', 'milk_type', 'litres_x100', 'fat_x10', 'snf_x10', 'rate_paise', 'amount_paise', 'dairy_name', 'slip_no', 'created_at', 'created_by'],
  db.dispatches.slice().sort((a, b) => (a.date + a.shift < b.date + b.shift ? -1 : 1)).map((d) => [d.id, d.centerId, d.date, d.shift, d.milkType, d.litresX100,
    d.fatX10, d.snfX10, d.ratePaise, d.amountPaise, d.dairyName || '', `D${d.date.replace(/-/g, '').slice(2)}${d.shift[0].toUpperCase()}${d.milkType[0].toUpperCase()}`, d.createdAt, d.createdBy]));

const TEMPLATE = { bill: 'bill_mr_v1', daily: 'daily_summary_mr_v1', pour: 'milk_entry_mr_v1', 'pour-fix': 'milk_correction_mr_v1', notice: 'center_notice_mr_v1', support: 'support_reply_mr_v1', payout: 'payout_status_mr_v1' };
insert('outbox_messages', ['id', 'center_id', 'farmer_id', 'kind', 'date', 'bill_id', 'channel', 'to_mobile', 'template', 'body_json', 'attachment_path', 'status',
  'attempts', 'next_attempt_at', 'fell_back', 'provider_message_id', 'last_error', 'created_at', 'sent_at', 'delivered_at',
  'collection_id', 'correction_id', 'broadcast_id', 'no_sms', 'ticket_id', 'ticket_message_id', 'payout_id', 'payout_status'],
db.outbox.map((m) => { const wa = m.channel === 'whatsapp'; const sent = m.status === 'sent'; const bill = m.billId && db.bills.find((b) => b.id === m.billId);
  return [m.id, m.centerId, m.farmerId, m.kind, m.date, m.billId || null, m.channel, m.to, wa ? TEMPLATE[m.kind] : null,
    j(wa ? { text: m.texts.whatsapp } : { text: m.texts.sms }), wa && bill ? `data/bills/${bill.no}.pdf` : null, m.status, m.attempts || 0,
    m.status === 'queued' || m.status === 'deferred' ? iso(m.nextAttemptAt) || m.createdAt : null, m.fellBack ? 1 : 0,
    sent ? (wa ? 'wamid.' + sha(m.id).slice(0, 24) : 'sms-' + sha(m.id).slice(0, 10)) : null, m.lastError || null, m.createdAt, m.sentAt || null, null,
    m.kind === 'pour' ? m.entryId : null, m.kind === 'pour-fix' ? m.entryId : null, m.broadcastId || null, !!m.noSms, m.ticketId || null, m.ticketMsgId || null, m.payoutId || null, m.payoutStatus || null]; }));

insert('sms_counters', ['center_id', 'date', 'sent'], [[db.center.id, db.smsCounter.date, db.smsCounter.sent]]);

const strip = (o) => { if (!o || typeof o !== 'object') return o; const { pin, ...r } = o; return r; };
// staff user, or the farmer themselves ('farmer:<id>', D-108); automatic payout runs ('system', D-107) have no user
const auditUser = (u) => (u && !u.startsWith('farmer:') && u !== 'system' ? u : null);
const auditFarmer = (u) => (u && u.startsWith('farmer:') ? u.slice(7) : null);
insert('audit_log', ['id', 'center_id', 'at', 'user_id', 'farmer_id', 'action', 'entity', 'entity_id', 'before_json', 'after_json', 'ip'],
  db.audit.slice().sort((a, b) => (a.at < b.at ? -1 : 1)).map((a) => [a.id, a.centerId, a.at, auditUser(a.userId), auditFarmer(a.userId), a.action, a.entity, a.entityId || null,
    j(strip(a.before)), j(strip(a.after)), a.userId === 'u-owner' ? '192.168.1.10' : a.userId ? '192.168.1.21' : null]));

// daily milk buyers (D-51) — PostgreSQL migration 001 (backend/db/migrations/001_milk_buyers.sql)
insert('milk_buyers', ['id', 'center_id', 'code', 'name', 'area', 'mobile', 'milk_type', 'rate_paise', 'morning_x100', 'evening_x100', 'active', 'note', 'start_date', 'bill_kind', 'bill_day', 'created_at', 'updated_at'],
  db.buyers.map((b) => [b.id, b.centerId, b.code, b.name, b.area || '', b.mobile || '', b.milkType, b.ratePaise, b.morningX100, b.eveningX100, b.active, b.note || '',
    b.startDate, b.billing?.kind === 'day' ? 'day' : 'month-end', b.billing?.kind === 'day' ? b.billing.day : null, b.createdAt, b.createdAt]));
insert('buyer_sales', ['id', 'center_id', 'buyer_id', 'date', 'shift', 'milk_type', 'litres_x100', 'rate_paise', 'amount_paise', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  db.buyerSales.map((x) => [x.id, x.centerId, x.buyerId, x.date, x.shift, x.milkType, x.litresX100, x.ratePaise, x.amountPaise, x.createdAt, x.createdBy, x.updatedAt || null, x.updatedBy || null]));
insert('buyer_payments', ['id', 'center_id', 'buyer_id', 'date', 'mode', 'amount_paise', 'upi_ref', 'note', 'created_at', 'created_by'],
  db.buyerPayments.map((x) => [x.id, x.centerId, x.buyerId, x.date, x.mode, x.amountPaise, x.upiRef || '', x.note || '', x.createdAt, x.createdBy]));
// walk-in (सुटी) sales (D-53) — migration 002
insert('counter_sales', ['id', 'center_id', 'date', 'shift', 'milk_type', 'litres_x100', 'rate_paise', 'amount_paise', 'mode', 'upi_ref', 'name', 'void', 'void_reason', 'created_at', 'created_by'],
  (db.counterSales || []).map((x) => [x.id, x.centerId, x.date, x.shift, x.milkType, x.litresX100, x.ratePaise, x.amountPaise, x.mode, x.upiRef || '', x.name || '', !!x.void, x.voidReason || '', x.createdAt, x.createdBy]));
insert('buyer_months', ['id', 'center_id', 'month', 'closed_at', 'closed_by'],
  db.buyerMonths.map((x) => [x.id, x.centerId, x.month, x.closedAt, x.closedBy]));

// government schemes (D-71) and notices (D-72) — migration 003
insert('schemes', ['id', 'center_id', 'title', 'summary', 'benefit', 'eligibility', 'documents', 'how_to', 'last_date', 'link', 'published', 'created_at', 'updated_at', 'created_by'],
  (db.schemes || []).map((x) => [x.id, x.centerId, x.title, x.summary, x.benefit || '', x.eligibility || '', x.documents || '', x.howTo || '', x.lastDate || null, x.link || '', !!x.published, x.createdAt, x.updatedAt || x.createdAt, 'u-owner']));
insert('broadcasts', ['id', 'center_id', 'text', 'audience', 'codes', 'sms', 'counts', 'created_at', 'created_by'],
  (db.broadcasts || []).map((x) => [x.id, x.centerId, x.text, x.audience, x.codes || [], !!x.sms, j({ whatsapp: x.counts.whatsapp, sms: x.counts.sms, skipped: x.counts.skipped }), x.createdAt, x.createdBy]));

// veterinary doctors (D-83) — migration 005
insert('doctors', ['id', 'center_id', 'name', 'qualification', 'kind', 'mobile', 'place', 'areas', 'timings', 'services', 'emergency', 'published', 'sort', 'created_at', 'updated_at'],
  (db.doctors || []).map((x) => [x.id, x.centerId, x.name, x.qualification || '', x.kind, x.mobile || '', x.place || '', x.areas || '', x.timings || '', x.services || '', !!x.emergency, !!x.published, x.sort || 0, x.createdAt, x.updatedAt || x.createdAt]));

// ---- write -------------------------------------------------------------------------------------
const OUT_ARG = process.argv.find((x) => x.startsWith('--out='))?.slice(6);
const OUT = OUT_ARG ? join(process.cwd(), OUT_ARG) : join(HERE, 'sample-data.json');
writeFileSync(OUT, JSON.stringify({ generated: today, center: db.center.id, tables: data }, null, 1), 'utf8');
console.log('wrote', OUT); console.log(counts);
