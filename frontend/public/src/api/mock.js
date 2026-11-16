// In-browser mock of the backend API (localStorage). Same async contract the real REST API
// will expose (see docs/api-contract.md). Lets the UI be built, demoed and tested offline now.
// NOTE: PINs are plain text here for the demo only — the real backend hashes them.
import { govtSchemes, SCHEME_SET } from './schemes-data.js';
import { buildSeed, CENTER_ID, CENTER_DEFAULTS, demoAadhaarLast4, sampleSchemes, demoFill, topUpDemo, sampleDairyCharts, sampleDoctors, demoExpenses, isDemoData, topUpExpenses } from './seed.js';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_MSG_COST_PAISE, expenseShare, expenseTotals, autoCosts, monthlyDue, expenseError } from '../lib/expenses.js';
import { findDuplicate, priceEntry } from '../lib/collection.js';
import { chartFor, lookupRate, adjustChart } from '../lib/rates.js';
import { computeBill } from '../lib/billing.js';
import { amountFor } from '../lib/money.js';
import { cycleFor, previousCycle, cycleKey } from '../lib/cycles.js';
import { addDays, todayIST, daysBetween, lastDayOfMonth, nowHHMM } from '../lib/dates.js';
import { billingOf, buyerCycle, prevCycle } from '../lib/buyerbill.js';
import { chooseChannel, selectDue, afterFailure, deferToNextDay, smsAllowance } from '../lib/outbox.js';
import { dailySummary, billMessage, noticeMessage, pourMessage, pourFixMessage, supportReplyMessage, payoutMessage } from '../i18n/messages.mr.js';
import { uuid } from '../lib/uuid.js';
import { deviceLabel } from '../lib/device.js';
import { PAYOUT_DEFAULTS, PAYOUT_MODES, PAY_METHODS, prefOf, validPref, isDue, nextPayDate, applyLimits } from '../lib/payout.js';
import { simVerify, simVerifyBank, simSend } from '../lib/payout-sim.js';
import { toEnglish, learnPairs } from '../lib/translit.js';

const DB_KEY = 'arag.db.v2'; // v2: ~3-month demo history with every past period billed (D-50)
const SESSION_KEY = 'arag.session';
const SESSION_ID_KEY = 'arag.sessionId';
const MAX_FAILED = 5, LOCK_MINUTES = 10;
const SMS_NOTICE_MAX = 140; // a broadcast also sent by SMS stays within 2 Unicode (Marathi) SMS parts (D-72)
const MAX_FARMER_FAILED = 10; // wrong farmer codes per 10 minutes (per device on the real server) before a pause

export class ApiError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}

let firstRun = false;
let db = load();

function load() {
  try {
    const s = localStorage.getItem(DB_KEY);
    if (s) return migrate(JSON.parse(s));
  } catch { /* corrupt or blocked */ }
  firstRun = true;
  return migrate(buildSeed());
}
/** Bring data saved by an older version up to date. */
function migrate(d) {
  for (const [k, v] of Object.entries(CENTER_DEFAULTS)) if (d.center[k] === undefined) d.center[k] = v;
  delete d.center.collectionTimes;
  d.sessions ||= [];
  d.center.payout = { ...PAYOUT_DEFAULTS, ...(d.center.payout || {}) }; // D-107
  d.payouts ||= []; d.payoutRuns ||= [];
  d.changeRequests ||= []; // D-108
  d.tickets ||= []; d.ticketSeq ||= 0; // D-109
  d.nameWords ||= {}; // D-118: the centre's own English → Marathi corrections
  // D-126: expenses — ready-made categories, the list, the estimated cost of one WhatsApp message; demo data gets examples once
  d.expenseCategories ||= DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c, centerId: d.center.id || CENTER_ID, active: true }));
  d.expenses ||= [];
  d.center.msgCostPaise ??= DEFAULT_MSG_COST_PAISE;
  if (!d.expenseDemoSet) { if (isDemoData(d)) d.expenses.push(...demoExpenses(todayIST(), d.center.id || CENTER_ID)); d.expenseDemoSet = true; }
  for (const f of d.farmers) if (f.nameEn === undefined) { f.nameEn = toEnglish(f.name); f.nameEnAuto = true; } // filled in once, for the owner to check
  if (!d.users.some((u) => u.role === 'support')) d.users.push({ id: 'u-support', centerId: CENTER_ID, role: 'support', name: 'Bokare सपोर्ट', pin: '9999', active: true, mobile: '', createdAt: new Date().toISOString() });
  if (!d.payPrefSet) { // demo: a mix of choices so every screen has something to show
    const demo = { 101: { kind: 'daily' }, 103: { kind: 'daily' }, 105: { kind: 'daily' }, 102: { kind: 'day', day: 5 }, 104: { kind: 'month-end' } };
    for (const f of d.farmers) f.payPref ??= demo[f.code] ? { day: null, ...demo[f.code] } : { kind: 'bill', day: null };
    d.payPrefSet = true;
  }
  for (const f of d.farmers) { f.payPref ??= { kind: 'bill', day: null }; f.upiCheck ??= { status: 'none' }; f.bankCheck ??= { status: 'none' }; f.payMethod ??= f.upiId ? 'upi' : f.bankAccount ? 'bank' : 'upi'; f.payApproval ??= false; } // D-110, D-111
  if (!d.counterSales) d.counterSales = buildSeed().counterSales; // D-53
  if (!d.buyers) { const fresh = buildSeed(); Object.assign(d, { buyers: fresh.buyers, buyerSales: fresh.buyerSales, buyerPayments: fresh.buyerPayments, buyerMonths: fresh.buyerMonths }); }
  for (const u of d.users) { u.active ??= true; u.mobile ??= ''; u.createdAt ??= new Date().toISOString(); }
  if (!d.schemes) d.schemes = sampleSchemes(); // D-71
  if ((d.schemeSet || 0) < SCHEME_SET) { // D-92: drop the untouched (नमुना) samples, add the real schemes not yet there
    d.schemes = d.schemes.filter((s) => !(/^sch-[12]$/.test(s.id) && s.title.endsWith('(नमुना)') && (!s.updatedAt || s.updatedAt === s.createdAt)));
    for (const s of govtSchemes(d.center.id || CENTER_ID)) if (!d.schemes.some((x) => x.id === s.id)) d.schemes.push(s);
    d.schemeSet = SCHEME_SET;
  }
  for (const s of d.schemes) s.howTo ??= '';
  if (!d.doctors) d.doctors = sampleDoctors(); // D-83
  for (const b of d.buyers || []) { // D-87: start date (first milk, else the day added) and when they pay
    if (!b.startDate) b.startDate = (d.buyerSales || []).filter((s) => s.buyerId === b.id).reduce((m, s) => (!m || s.date < m ? s.date : m), '') || String(b.createdAt || '').slice(0, 10) || '2026-01-01';
    if (!b.billing) b.billing = b.id === 'g1' ? { kind: 'day', day: 5 } : b.id === 'g6' ? { kind: 'day', day: 10 } : { kind: 'month-end' };
  }
  for (const f of d.farmers) if (!f.aadhaarLast4) f.aadhaarLast4 = demoAadhaarLast4(f.code); // demo data: every farmer has (fake) Aadhaar
  if (d.center.publicBaseUrl === 'https://example.in') d.center.publicBaseUrl = ''; // old placeholder
  for (const c of d.charts) c.side ||= 'farmer'; // D-80
  if (!d.charts.some((c) => c.side === 'dairy')) d.charts.push(...sampleDairyCharts(d.charts));
  demoFill(d); // D-79: no blank demo columns (bank, UPI, operator mobile, buyer notes, UTRs)
  return d;
}
let dirty = false; // set by save(): the shared copy on the dev server needs this change (D-67)
function save() { dirty = true; try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* quota / private mode */ } }

const nowIso = () => new Date().toISOString();
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const byCenter = (list) => list.filter((x) => x.centerId === CENTER_ID);
// D-80: two kinds of rate chart. 'farmer' = what we pay farmers (prices every milk entry); 'dairy' = what the dairy
// pays us (fills the dispatch rate and gives the profit of every entry). Old charts without a side are farmer charts.
const sideOf = (c) => (c.side === 'dairy' ? 'dairy' : 'farmer');
const farmerCharts = () => byCenter(db.charts).filter((c) => sideOf(c) === 'farmer');
const dairyCharts = () => byCenter(db.charts).filter((c) => sideOf(c) === 'dairy');
/** What the dairy chart pays for this milk (litres × dairy rate for its Fat/SNF on its date), or null if no dairy rate. */
function dairyValue(c) {
  const ch = chartFor(dairyCharts(), c.milkType, c.date); if (!ch) return null;
  const r = lookupRate(ch, c.fatX10, c.snfX10, db.center.rateRule); if (!r.ok) return null;
  return { ratePaise: r.ratePaise, amountPaise: amountFor(c.litresX100, r.ratePaise) };
}
/**
 * Profit of one milk entry: dairy-chart value − what the farmer is paid. Without a dairy chart for that date, the
 * rate the dairy actually paid for that date / shift / milk type (dispatch) is used, as before; else null.
 */
function entryProfit(c, dispByKey) {
  const v = dairyValue(c);
  if (v) return { revenuePaise: v.amountPaise, costPaise: c.amountPaise, by: 'chart' };
  const d = dispByKey?.get(`${c.date}|${c.shift}|${c.milkType}`);
  if (d) return { revenuePaise: Math.round(c.litresX100 * d.ratePaise / 100), costPaise: c.amountPaise, by: 'dispatch' };
  return null;
}

// ---------- session & roles ----------
let sessionUserId = null;
try { sessionUserId = localStorage.getItem(SESSION_KEY); } catch { /* ignore */ }

function me() {
  const u = db.users.find((x) => x.id === sessionUserId);
  if (!u) throw new ApiError('unauthenticated');
  return u;
}
const OPERATOR_PATHS = ['/collection', '/ledger', '/farmers', '/dispatch', '/buyers', '/messages'];
/** D-86: an operator may only write in the tabs the owner allowed. */
function requirePage(u, path) {
  if (u.role === 'operator' && Array.isArray(u.pages) && !u.pages.includes(path)) throw new ApiError('page-not-allowed');
  return u;
}
function requireRole(...roles) {
  const u = me();
  if (!roles.includes(u.role)) throw new ApiError('forbidden');
  return u;
}
function audit(action, entity, entityId, before, after, userId = sessionUserId) {
  db.audit.push({ id: uuid(), centerId: CENTER_ID, at: nowIso(), userId, action, entity, entityId, before: clone(before), after: clone(after) });
}
const userAgent = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent || '');
let sessionId = null;
try { sessionId = localStorage.getItem(SESSION_ID_KEY); } catch { /* ignore */ }
const currentSession = () => db.sessions.find((s) => s.id === sessionId && !s.logoutAt);
/** Mark the current session as active now (written at most once a minute). */
function touchSession() {
  const s = currentSession(); if (!s) return;
  if (Date.now() - Date.parse(s.lastSeenAt) > 60000) { s.lastSeenAt = nowIso(); save(); }
}
/** The signed-in farmer (farmer login by code), or null for staff / nobody. */
function farmerSession() {
  if (!sessionUserId || !sessionUserId.startsWith('farmer:')) return null;
  const f = db.farmers.find((x) => x.id === sessionUserId.slice(7) && x.active);
  return f ? { farmerId: f.id, farmer: f } : null;
}
const maskMobile = (m) => (m && m.length >= 10 ? m.slice(0, 2) + 'XXXXXX' + m.slice(-2) : '');
const maskUpi = (u) => { if (!u) return ''; const [n, d = ''] = u.split('@'); return n.slice(0, 2) + '•••' + (d ? '@' + d : ''); };

function failedRecently(userId) {
  const since = Date.now() - LOCK_MINUTES * 60000;
  const lastOk = db.sessions.filter((s) => s.userId === userId).reduce((m, s) => (s.loginAt > m ? s.loginAt : m), '');
  return db.audit.filter((a) => a.action === 'login-failed' && a.entityId === userId && Date.parse(a.at) > since && a.at > lastOk).length;
}

// ---------- derived helpers ----------
const farmerById = (id) => db.farmers.find((f) => f.id === id);
const cycleConf = () => [db.center.cycleDays, db.center.cycleAnchor];
const currentCycle = (date = todayIST()) => cycleFor(date, ...cycleConf());

function isLocked(date) {
  return db.cycles.some((c) => c.status === 'finalized' && date >= c.start && date <= c.end);
}

/**
 * Advance (उचल) position of a farmer. upTo (a date): only advances given on or before it count — a bill for a
 * period never recovers an advance given after that period (D-50). Recoveries are applied oldest advance first;
 * the instalment is the sum of the instalments of advances that are still not fully repaid.
 */
function advanceState(farmerId, excludeBillCycleId, upTo) {
  const given = db.advances.filter((a) => a.farmerId === farmerId && (!upTo || a.date <= upTo)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const recovered = db.bills.filter((b) => b.farmerId === farmerId && b.cycleId !== excludeBillCycleId && (!upTo || b.end <= upTo))
    .reduce((s, b) => s + b.advancePaise, 0);
  const total = given.reduce((s, a) => s + a.amountPaise, 0);
  const outstanding = Math.max(0, total - recovered);
  let left = recovered; let installment = 0;
  for (const a of given) { const paidOff = Math.min(left, a.amountPaise); left -= paidOff; if (paidOff < a.amountPaise) installment += a.installmentPaise; }
  return { totalPaise: total, recoveredPaise: recovered, outstandingPaise: outstanding, installmentPaise: installment };
}

// ---------- daily buyers (D-51) ----------
const buyerMonthLocked = (date) => db.buyerMonths.some((m) => m.month === date.slice(0, 7));
function buyerBalanceBefore(buyerId, beforeDate) {
  return sum(db.buyerSales.filter((s) => s.buyerId === buyerId && s.date < beforeDate), 'amountPaise')
    - sum(db.buyerPayments.filter((p) => p.buyerId === buyerId && p.date < beforeDate), 'amountPaise');
}
const buyerBalance = (buyerId) => buyerBalanceBefore(buyerId, '9999-12-31');
/**
 * D-87: a buyer's account by their own bill periods. Due = milk of finished periods − everything received so far;
 * it falls due on the period's due date and is overdue after it.
 */
function buyerBill(b, today = todayIST()) {
  const billing = billingOf(b);
  const cur = buyerCycle(billing, today);
  const last = prevCycle(billing, cur);
  const sales = db.buyerSales.filter((s) => s.buyerId === b.id); const pays = db.buyerPayments.filter((p) => p.buyerId === b.id);
  const billedUpTo = sum(sales.filter((s) => s.date <= last.end), 'amountPaise');
  const received = sum(pays.filter((p) => p.date <= today), 'amountPaise');
  const lastAmount = sum(sales.filter((s) => s.date >= last.start && s.date <= last.end), 'amountPaise');
  const due = Math.max(0, billedUpTo - received);
  return { billing, current: { ...cur, amountPaise: sum(sales.filter((s) => s.date >= cur.start && s.date <= today), 'amountPaise') },
    last: { ...last, amountPaise: lastAmount }, duePaise: due, dueDate: last.due, overdue: due > 0 && today > last.due,
    advancePaise: Math.max(0, received - billedUpTo - sum(sales.filter((s) => s.date > last.end), 'amountPaise')) };
}
const counterRate = (milkType) => (milkType === 'buffalo' ? db.center.counterRateBuffaloPaise : db.center.counterRateCowPaise);
const liveCounter = () => byCenter(db.counterSales).filter((s) => !s.void);

function feedSalesIn(farmerId, start, end) {
  return db.feedMoves.filter((m) => m.type === 'sale' && m.farmerId === farmerId && m.date >= start && m.date <= end);
}

function feedBilled(farmerId) {
  return db.bills.filter((b) => b.farmerId === farmerId).reduce((s, b) => s + b.feedPaise, 0);
}

function balances(farmerId) {
  const adv = advanceState(farmerId);
  const feedTotal = db.feedMoves.filter((m) => m.type === 'sale' && m.farmerId === farmerId).reduce((s, m) => s + m.amountPaise, 0);
  const last = lastBill(farmerId);
  const unpaid = db.bills.filter((b) => b.farmerId === farmerId && b.status === 'final').reduce((s, b) => s + Math.max(0, b.payablePaise - b.paidPaise), 0);
  return {
    advanceOutstandingPaise: adv.outstandingPaise, advanceInstallmentPaise: adv.installmentPaise,
    feedUnbilledPaise: feedTotal - feedBilled(farmerId),
    duesPaise: last ? last.carryForwardDuesPaise : 0,
    unpaidPaise: unpaid,
  };
}

function lastBill(farmerId, beforeStart) {
  return db.bills.filter((b) => b.farmerId === farmerId && (!beforeStart || b.end < beforeStart))
    .sort((a, b) => (a.end < b.end ? 1 : -1))[0] || null;
}

// ---------- help / support tickets (D-109) ----------
// Owner, operators and farmers report an issue; every new ticket (and every reply from the reporter) is sent to
// Bokare support by email + WhatsApp (queued here; the backend sends). Bokare support answers from its own login;
// the centre owner sees the operators' and farmers' tickets too. The reporter follows status and replies.
const TICKET_CATS = ['milk', 'bill', 'upi', 'app', 'login', 'other'];
const TICKET_STATUS = ['open', 'in-progress', 'waiting', 'resolved', 'closed'];
/** Who is asking: { kind, id, name } for staff, farmer or support (null = nobody). */
function whoAsks() {
  const fs = farmerSession();
  if (fs) return { kind: 'farmer', id: fs.farmerId, name: fs.farmer.name, key: 'farmer:' + fs.farmerId };
  const u = db.users.find((x) => x.id === sessionUserId);
  return u ? { kind: u.role, id: u.id, name: u.name, key: u.id } : null;
}
const reporterKey = (t) => (t.by.kind === 'farmer' ? 'farmer:' + t.by.id : t.by.id);
/** May this person see the ticket? reporter · owner (all of the centre) · support (all) */
function canSeeTicket(w, t) { return !!w && (reporterKey(t) === w.key || w.kind === 'owner' || w.kind === 'support'); }
function notifySupport(t, event) {
  const at = nowIso();
  for (const channel of ['email', 'whatsapp']) t.notify.push({ channel, to: 'support', event, status: 'queued', at });
}
function ticketView(t, w) {
  const unread = w && t.unreadFor?.includes(w.key);
  return { ...clone(t), unread: !!unread, mine: !!w && reporterKey(t) === w.key };
}

// ---------- change requests (D-108) ----------
// An operator's or a farmer's change to a farmer's details waits for the owner. Only these fields can be asked for:
const OPERATOR_FIELDS = ['name', 'nameEn', 'village', 'mobile', 'hasWhatsapp', 'consent', 'milkTypes', 'upiId', 'bankName', 'bankAccount', 'bankIfsc', 'active', 'payPref', 'payMethod'];
const FARMER_FIELDS = ['mobile', 'hasWhatsapp', 'upiId', 'bankName', 'bankAccount', 'bankIfsc', 'payPref', 'payMethod'];
const sameVal = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
/** Same rules as saving a farmer, for the fields being changed. */
function checkFarmerFields(f, ch) {
  if ('name' in ch && !String(ch.name || '').trim()) throw new ApiError('name-required');
  if ('mobile' in ch && ch.mobile && !/^[6-9]\d{9}$/.test(ch.mobile)) throw new ApiError('invalid-mobile');
  if ('milkTypes' in ch && !ch.milkTypes?.length) throw new ApiError('milk-type-required');
  if ('upiId' in ch && ch.upiId && !/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/i.test(ch.upiId)) throw new ApiError('invalid-upi');
  if ('bankIfsc' in ch && ch.bankIfsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(ch.bankIfsc).toUpperCase())) throw new ApiError('invalid-ifsc');
  if ('payPref' in ch && !validPref(ch.payPref)) throw new ApiError('invalid-pay-pref');
  if ('payMethod' in ch && !PAY_METHODS.includes(ch.payMethod)) throw new ApiError('invalid');
}
/** Make a request from the asked fields: only real changes, as { field: { before, after } }. */
function makeChangeRequest(f, asked, allowed, by, kind, note) {
  const fields = {};
  for (const k of allowed) {
    if (!(k in asked)) continue;
    let v = asked[k];
    if (k === 'payPref') v = prefOf({ payPref: v });
    if (k === 'bankIfsc' && v) v = String(v).toUpperCase();
    const before = k === 'payPref' ? prefOf(f) : f[k];
    if (!sameVal(before, v)) fields[k] = { before: clone(before ?? ''), after: clone(v) };
  }
  if (!Object.keys(fields).length) throw new ApiError('no-change');
  checkFarmerFields(f, Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, x.after])));
  // a newer request from the same person replaces the SAME fields of their older pending request (other fields stay asked)
  for (const r of db.changeRequests.filter((x) => x.entityId === f.id && x.requestedBy === by && x.status === 'pending')) {
    for (const k of Object.keys(fields)) delete r.fields[k];
    if (!Object.keys(r.fields).length) Object.assign(r, { status: 'replaced', decidedAt: nowIso() });
  }
  const req = { id: 'cr-' + uuid().slice(0, 8), centerId: CENTER_ID, entity: 'farmer', entityId: f.id, requestedBy: by, requestedByKind: kind,
    fields, note: String(note || '').slice(0, 300), status: 'pending', requestedAt: nowIso() };
  db.changeRequests.push(req);
  audit('request', 'farmer-change', req.id, null, req, by);
  return req;
}
/** Owner approved: apply the fields (a new UPI ID must be checked again). */
function applyFarmerChange(f, fields, userId) {
  const before = clone(f);
  for (const [k, x] of Object.entries(fields)) f[k] = clone(x.after);
  if ('upiId' in fields && (fields.upiId.after || '') !== (fields.upiId.before || '')) f.upiCheck = { status: 'none' };
  if ('bankAccount' in fields || 'bankIfsc' in fields) f.bankCheck = { status: 'none' };
  audit('update', 'farmer', f.id, before, f, userId);
}
const pendingFor = (farmerId) => clone(db.changeRequests.filter((r) => r.entityId === farmerId && r.status === 'pending'));

// ---------- farmer payouts (D-107, D-110) ----------
// Source of funds: the owner's business account. Destination: the farmer's UPI ID or bank account (checked with ₹1 first).
// Modes: immediate (each confirmed collection) · approve (owner's pending list) · eod (batch at the set time, optional approval).
// A payout is 'processing' once the gateway ACCEPTS it; only the gateway's confirmation (webhook) makes it 'success'
// (or 'failed' / later 'reversed'). Money is booked to the farmer only on success; a reversal voids it again.
const payoutConf = () => {
  const c = { ...PAYOUT_DEFAULTS, ...(db.center.payout || {}) };
  if (c.mode === 'auto') { c.mode = 'eod'; c.eodApproval = false; } // D-107 → D-110
  c.funding = { ...PAYOUT_DEFAULTS.funding, ...(c.funding || {}) };
  return c;
};
// D-126: expense helpers
const liveCats = (keep) => byCenter(db.expenseCategories).filter((c) => c.active || c.id === keep);
/** A bill photo: a small JPEG data URL (the page shrinks it), else nothing. */
const photoOf = (p) => (typeof p === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(p) && p.length < 700000 ? p : '');
const noPhoto = (x) => { const c = clone(x); if (c.photo) c.photo = '(photo)'; return c; };
/** Costs counted by the app for [from, to]: WhatsApp messages sent, payout fees paid by the centre. */
function autoCostsFor(from, to) {
  const istDay = (ts) => (ts ? todayIST(new Date(ts)) : '');
  const wa = byCenter(db.outbox || []).filter((m) => m.channel === 'whatsapp' && m.status === 'sent' && istDay(m.sentAt) >= from && istDay(m.sentAt) <= to).length;
  const fees = (db.payouts || []).filter((x) => x.kind === 'payout' && ['success', 'reversed', 'processing'].includes(x.status) && x.feeBy !== 'farmer' && x.date >= from && x.date <= to);
  return autoCosts({ whatsappSent: wa, msgCostPaise: db.center.msgCostPaise ?? DEFAULT_MSG_COST_PAISE, payoutFeesPaise: sum(fees, 'feePaise'), payoutCount: fees.length });
}
const PENDING = ['proposed', 'approved', 'processing'];
const payoutsOf = (farmerId) => (db.payouts || []).filter((x) => x.farmerId === farmerId && x.kind === 'payout');
/** Parts of payouts for a period: pending ones (not yet paid), or also the successful ones. */
function payoutParts(farmerId, cycleId, statuses, excludeRunId) {
  return payoutsOf(farmerId).filter((x) => statuses.includes(x.status) && x.runId !== excludeRunId)
    .flatMap((x) => x.parts || []).filter((x) => x.cycleId === cycleId).reduce((t, x) => t + x.paise, 0);
}
const upiOk = (f) => !!f.upiId && f.upiCheck?.status === 'verified' && f.upiCheck.upiId === f.upiId;
const bankOk = (f) => !!f.bankAccount && !!f.bankIfsc && f.bankCheck?.status === 'verified' && f.bankCheck.account === f.bankAccount && f.bankCheck.ifsc === String(f.bankIfsc).toUpperCase();
const methodOf = (f) => (f.payMethod === 'bank' || (!f.payMethod && !f.upiId && f.bankAccount) ? 'bank' : 'upi');
const destOk = (f) => (methodOf(f) === 'bank' ? bankOk(f) : upiOk(f));
const hasDest = (f) => (methodOf(f) === 'bank' ? !!(f.bankAccount && f.bankIfsc) : !!f.upiId);
const destOf = (f) => (methodOf(f) === 'bank' ? { method: 'bank', to: `${f.bankAccount}|${String(f.bankIfsc).toUpperCase()}`, label: `XXXX${String(f.bankAccount).slice(-4)} · ${String(f.bankIfsc).toUpperCase()}` }
  : { method: 'upi', to: f.upiId, label: f.upiId });
const lastPayoutDate = (farmerId, excludeRunId = null) => payoutsOf(farmerId).filter((x) => [...PENDING, 'success'].includes(x.status) && x.runId !== excludeRunId)
  .reduce((m, x) => (x.date > m ? x.date : m), '') || null;
/** Money the gateway has accepted but not yet confirmed is held in the business account. */
const heldPaise = () => sum((db.payouts || []).filter((x) => x.status === 'processing'), 'creditPaise');
const availablePaise = () => payoutConf().simBalancePaise - heldPaise();

/**
 * What a farmer is owed up to `upTo`, oldest period first, with the breakdown the bill would show:
 * final bills not fully paid, and (unless only bills count) the milk of periods without a final bill —
 * gross milk amount − feed − advance instalment − old dues = net; minus what is already paid = owed.
 */
function owedParts(f, upTo, { onlyBills = false, excludeRunId = null } = {}) {
  const parts = [];
  const finals = db.bills.filter((b) => b.farmerId === f.id && b.status === 'final');
  for (const b of finals) {
    const paid = b.paidPaise + payoutParts(f.id, b.cycleId, PENDING, excludeRunId);
    const left = b.payablePaise - paid;
    if (left > 0) parts.push({ cycleId: b.cycleId, billId: b.id, start: b.start, end: b.end, paise: left, kind: 'bill',
      grossPaise: b.grossPaise, feedPaise: b.feedPaise, advancePaise: b.advancePaise, duesPaise: b.previousDuesPaise, netPaise: b.payablePaise, paidPaise: paid });
  }
  if (!onlyBills) {
    const billed = new Set(finals.map((b) => b.cycleId));
    let c = currentCycle(upTo);
    for (let i = 0; i < 6; i++, c = previousCycle(c, ...cycleConf())) {
      const cid = cycleKey(c);
      if (billed.has(cid) || isLocked(c.start)) continue;
      const end = c.end < upTo ? c.end : upTo;
      const entries = db.collections.filter((e) => !e.void && e.farmerId === f.id && e.date >= c.start && e.date <= end);
      if (!entries.length) continue;
      const adv = advanceState(f.id, cid, end);
      const calc = computeBill({ entries, feedPaise: sum(feedSalesIn(f.id, c.start, end), 'amountPaise'),
        advanceOutstandingPaise: adv.outstandingPaise, advanceInstallmentPaise: adv.installmentPaise,
        previousDuesPaise: lastBill(f.id, c.start)?.carryForwardDuesPaise || 0 });
      const paid = payoutParts(f.id, cid, [...PENDING, 'success'], excludeRunId);
      const left = calc.payablePaise - paid;
      if (left > 0) parts.push({ cycleId: cid, billId: null, start: c.start, end, paise: left, kind: 'open',
        grossPaise: calc.grossPaise, feedPaise: calc.feedPaise, advancePaise: calc.advancePaise, duesPaise: calc.previousDuesPaise, netPaise: calc.payablePaise, paidPaise: paid,
        litresX100: calc.litresX100 });
    }
  }
  return parts.sort((a, b) => (a.start < b.start ? -1 : 1));
}
/** gross − deductions = net; − already paid = owed (totals over the parts). */
function breakdownOf(parts) {
  const tot = (k) => sum(parts, k);
  return { grossPaise: tot('grossPaise'), feedPaise: tot('feedPaise'), advancePaise: tot('advancePaise'), duesPaise: tot('duesPaise'),
    deductPaise: tot('feedPaise') + tot('advancePaise') + tot('duesPaise'), netPaise: tot('netPaise'), alreadyPaidPaise: tot('paidPaise'), owedPaise: tot('paise') };
}

/** The live list: every active farmer with what they would get now, or why not. */
function payoutPreview(date, excludeRunId = null, { only = null, upTo: upToArg = null } = {}) {
  const conf = payoutConf();
  const upTo = upToArg || addDays(date, -conf.lagDays);
  const rows = []; const cands = [];
  for (const f of byCenter(db.farmers).filter((x) => x.active && (!only || only(x))).sort((a, b) => a.code - b.code)) {
    const pref = prefOf(f); const dest = hasDest(f) ? destOf(f) : null;
    const base = { farmerId: f.id, code: f.code, name: f.name, upiId: f.upiId || '', method: methodOf(f), dest: dest?.label || '', pref,
      check: (methodOf(f) === 'bank' ? f.bankCheck?.status : f.upiCheck?.status) || 'none', consent: !!f.deductionConsent };
    if (!isDue(pref, date, lastPayoutDate(f.id, excludeRunId))) { rows.push({ ...base, amountPaise: 0, why: 'not-due', next: nextPayDate(pref, date) }); continue; }
    const parts = owedParts(f, upTo, { onlyBills: pref.kind === 'bill', excludeRunId });
    const amount = sum(parts, 'paise');
    if (!amount) { rows.push({ ...base, amountPaise: 0, why: 'nothing' }); continue; }
    const bd = breakdownOf(parts);
    if (!dest) { rows.push({ ...base, amountPaise: amount, parts, breakdown: bd, why: 'no-dest' }); continue; }
    if (!destOk(f)) { rows.push({ ...base, amountPaise: amount, parts, breakdown: bd, why: 'unverified' }); continue; }
    cands.push({ ...base, amountPaise: amount, parts, breakdown: bd });
  }
  const limited = applyLimits(cands, conf);
  const ready = limited.filter((x) => !x.held);
  const held = limited.filter((x) => x.held).map((x) => ({ ...x, why: x.held }));
  return { date, upTo, conf, ready, held, waiting: rows,
    totalPaise: sum(ready, 'creditPaise'), feesPaise: ready.length * conf.feePaise, availablePaise: availablePaise() };
}

/** Split the amount actually sent over the owed parts, oldest first. */
function allocate(parts, paise) {
  const out = []; let left = paise;
  for (const x of parts) { if (left <= 0) break; const take = Math.min(left, x.paise); out.push({ ...x, paise: take }); left -= take; }
  return out;
}

function payoutRecord(run, x, conf) {
  const f = farmerById(x.farmerId); const dest = destOf(f);
  return { id: 'po-' + uuid().slice(0, 8), centerId: CENTER_ID, runId: run.id, kind: 'payout', date: run.date, farmerId: x.farmerId,
    method: dest.method, upiId: dest.to, destLabel: dest.label, amountPaise: x.sendPaise, creditPaise: x.creditPaise, feePaise: conf.feePaise, feeBy: conf.feeBy,
    parts: allocate(x.parts, x.sendPaise), breakdown: { ...x.breakdown, sentPaise: x.sendPaise, creditPaise: x.creditPaise, remainingPaise: x.breakdown.owedPaise - x.sendPaise },
    capped: !!x.capped, consent: !!f.deductionConsent, status: 'proposed', attempts: 0, createdAt: nowIso() };
}

function makeRun(date, mode, userId, { only = null, upTo = null, auto = false } = {}) {
  if (!only) { // a new list replaces today's list that is still waiting
    const old = db.payoutRuns.find((r) => r.date === date && r.status === 'proposed');
    if (old) { db.payouts = db.payouts.filter((x) => x.runId !== old.id); db.payoutRuns = db.payoutRuns.filter((r) => r !== old); }
  }
  const pv = payoutPreview(date, null, { only, upTo });
  const run = { id: 'pr-' + uuid().slice(0, 8), centerId: CENTER_ID, date, mode, auto, status: 'proposed', upTo: pv.upTo,
    createdAt: nowIso(), createdBy: userId, count: pv.ready.length, totalPaise: pv.totalPaise };
  db.payoutRuns.push(run);
  for (const x of pv.ready) db.payouts.push(payoutRecord(run, x, pv.conf));
  audit('create', 'payout-run', run.id, null, { date, mode, count: run.count, totalPaise: run.totalPaise }, userId);
  return run;
}

/** Tell the farmer about a payout status (SMS / WhatsApp, D-110). */
function notifyPayout(x, status) {
  const f = farmerById(x.farmerId); if (!f) return;
  queueMessage({ farmer: f, kind: 'payout', date: todayIST(), texts: payoutMessage({ farmer: f, payout: x, status }), payoutId: x.id, payoutStatus: status });
}

/** Hand one payout to the gateway: funds check, then 'processing' until the webhook says what happened. */
function sendPayout(x, userId) {
  // D-125: a bill paid by hand meanwhile (cash / own UPI) is not paid again — the payout is stopped
  if (billPaidMeanwhile(x)) { Object.assign(x, { status: 'rejected', waitApproval: false, reason: 'already-paid', decidedAt: nowIso() }); audit('payout-stopped', 'payout', x.id, null, { reason: 'already-paid' }, userId); return; }
  x.attempts = (x.attempts || 0) + 1; x.approvedBy ||= userId;
  x.txnRef = `${x.id}-${x.attempts}`; // unique reference: the provider refuses a second payout with the same one (idempotency)
  if (x.creditPaise > availablePaise()) { Object.assign(x, { status: 'failed', reason: 'insufficient-funds', sentAt: nowIso() }); audit('payout-failed', 'payout', x.id, null, { reason: 'insufficient-funds' }, userId); return; }
  const r = simSend({ to: x.upiId, amountPaise: x.creditPaise, key: x.txnRef });
  if (!r.accepted) { Object.assign(x, { status: 'failed', reason: r.reason, sentAt: nowIso() }); notifyPayout(x, 'failed'); audit('payout-failed', 'payout', x.id, null, { reason: r.reason }, userId); return; }
  Object.assign(x, { status: 'processing', reason: null, sentAt: nowIso(), sim: { outcome: r.outcome, failReason: r.failReason || null, utr: r.utr || null, reverse: !!r.reverse },
    webhookDueAt: Date.now() + payoutConf().simDelayMs });
  audit('payout-sent', 'payout', x.id, null, { amountPaise: x.amountPaise, txnRef: x.txnRef }, userId);
}

/** Is any final bill in this payout already paid (by hand or by another payout) so that sending it would pay twice? */
function billPaidMeanwhile(x) {
  return (x.parts || []).some((p) => {
    const b = p.billId && db.bills.find((q) => q.id === p.billId); if (!b) return false;
    const others = payoutsOf(x.farmerId).filter((y) => y !== x && PENDING.includes(y.status)).flatMap((y) => y.parts || [])
      .filter((q) => q.cycleId === p.cycleId).reduce((t, q) => t + q.paise, 0);
    return p.paise > b.payablePaise - b.paidPaise - others;
  });
}
/** The gateway's webhook (simulated): confirm, fail or reverse payouts whose result has arrived. */
function processWebhooks(now = Date.now()) {
  let changed = false;
  for (const x of (db.payouts || []).filter((p) => p.kind === 'payout')) {
    if (x.status === 'processing' && x.webhookDueAt <= now) {
      changed = true;
      if (x.sim?.outcome !== 'success') { Object.assign(x, { status: 'failed', reason: x.sim?.failReason || 'failed', doneAt: nowIso() }); notifyPayout(x, 'failed'); continue; }
      Object.assign(x, { status: 'success', ref: x.sim.utr, doneAt: nowIso() });
      for (const part of x.parts) {
        const bill = part.billId ? db.bills.find((b) => b.id === part.billId) : db.bills.find((b) => b.farmerId === x.farmerId && b.cycleId === part.cycleId);
        db.payments.push({ id: uuid(), centerId: CENTER_ID, billId: bill?.id || null, cycleId: part.cycleId, farmerId: x.farmerId, mode: 'upi',
          amountPaise: part.paise, upiRef: x.ref, date: x.date, createdAt: nowIso(), createdBy: x.approvedBy || 'system', source: 'payout', payoutId: x.id });
        if (bill) bill.paidPaise += part.paise;
      }
      if (x.sim.reverse) x.reverseDueAt = now + payoutConf().simDelayMs * 3;
      notifyPayout(x, 'success');
      audit('payout-confirmed', 'payout', x.id, null, { ref: x.ref }, 'system');
    } else if (x.status === 'success' && x.reverseDueAt && x.reverseDueAt <= now) {
      changed = true; // the bank sent the money back: the farmer's amount is payable again
      Object.assign(x, { status: 'reversed', reason: 'reversed-by-bank', reversedAt: nowIso() }); delete x.reverseDueAt;
      for (const p of db.payments.filter((q) => q.payoutId === x.id && !q.void)) {
        Object.assign(p, { void: true, voidReason: 'payout reversed by the bank' });
        const bill = p.billId && db.bills.find((b) => b.id === p.billId); if (bill) bill.paidPaise -= p.amountPaise;
      }
      notifyPayout(x, 'reversed');
      audit('payout-reversed', 'payout', x.id, null, null, 'system');
    }
  }
  return changed;
}

/** Owner's set time: end-of-day batch (sent, or waiting for approval); in every mode, farmers on a date / bill choice. */
function payoutTick(now = new Date()) {
  const conf = payoutConf();
  if (conf.mode === 'off') return false;
  const date = todayIST(now);
  if (nowHHMM(now) < conf.time || db.payoutRuns.some((r) => r.date === date && r.auto)) return false;
  // immediate mode pays daily farmers at each collection; at the set time only the others (their date has come)
  const only = conf.mode === 'immediate' ? (f) => prefOf(f).kind !== 'daily' : null;
  const run = makeRun(date, conf.mode === 'approve' ? 'approve' : 'eod', 'system', { only, auto: true });
  if (conf.mode === 'approve') return true; // the whole list waits for the owner
  // D-111: at the fixed time the money goes from the business account by itself; farmers marked "needs approval"
  // (or everyone, when the owner wants to approve all) wait in the approval list
  for (const x of db.payouts.filter((p) => p.runId === run.id)) {
    if (needsApproval(farmerById(x.farmerId), conf)) { x.waitApproval = true; continue; }
    sendPayout(x, 'system');
  }
  Object.assign(run, { status: 'sent', sentAt: nowIso(), approvedBy: 'system' });
  return true;
}
/** Does this farmer's payout wait for the owner? (everyone, or only farmers marked "needs approval") */
const needsApproval = (f, conf = payoutConf()) => !!(conf.eodApproval || f?.payApproval || prefOf(f).kind === 'approval'); // D-123: 'only after approval' farmers always wait

/** Immediate mode: right after a collection is confirmed, pay that farmer what they are owed now. */
function payImmediately(farmerId) {
  const conf = payoutConf(); const f = farmerById(farmerId);
  if (conf.mode !== 'immediate' || !f || prefOf(f).kind !== 'daily' || !destOk(f)) return;
  const wait = needsApproval(f, conf); // D-111: marked farmers wait for the owner even in immediate mode
  const date = todayIST();
  if (db.payouts.some((p) => p.farmerId === farmerId && PENDING.includes(p.status))) return; // one at a time
  const run = makeRun(date, 'immediate', 'system', { only: (x) => x.id === farmerId, upTo: date });
  const items = db.payouts.filter((p) => p.runId === run.id);
  if (!items.length) { db.payoutRuns = db.payoutRuns.filter((r) => r !== run); return; }
  for (const x of items) { if (wait) x.waitApproval = true; else sendPayout(x, 'system'); }
  Object.assign(run, { status: 'sent', sentAt: nowIso(), approvedBy: 'system' });
}
/** Payouts waiting for the owner's decision, with the farmer and the breakdown. */
function waitingApproval() {
  return (db.payouts || []).filter((x) => x.kind === 'payout' && x.status === 'proposed' && x.waitApproval)
    .map((x) => { const f = farmerById(x.farmerId); return { ...clone(x), code: f?.code, name: f?.name, pref: prefOf(f) }; })
    .sort((a, b) => (a.date === b.date ? a.code - b.code : a.date < b.date ? -1 : 1));
}

/** D-113: farmer payouts for the owner's dashboard — paid and failed in the chosen dates; owed and waiting right now. */
function payoutSummary(from, to) {
  if (processWebhooks()) save();
  const conf = payoutConf(); const today = todayIST();
  const pos = (db.payouts || []).filter((x) => x.kind === 'payout');
  const inR = pos.filter((x) => x.date >= from && x.date <= to);
  const paid = inR.filter((x) => x.status === 'success'); const bad = inR.filter((x) => ['failed', 'reversed'].includes(x.status));
  const waiting = pos.filter((x) => x.status === 'proposed' && x.waitApproval); const processing = pos.filter((x) => ['approved', 'processing'].includes(x.status));
  let owed = 0, owedFarmers = 0;
  for (const f of byCenter(db.farmers).filter((x) => x.active)) { const o = sum(owedParts(f, today), 'paise'); if (o > 0) { owed += o; owedFarmers++; } }
  const ranToday = db.payoutRuns.some((r) => r.date === today && r.auto);
  const next = conf.mode === 'off' ? { kind: 'off' } : conf.mode === 'approve' ? { kind: 'approve' } : conf.mode === 'immediate' ? { kind: 'immediate', time: conf.time }
    : { kind: 'eod', date: ranToday || nowHHMM() >= conf.time ? addDays(today, 1) : today, time: conf.time, approval: !!conf.eodApproval };
  return { paidPaise: sum(paid, 'creditPaise'), paidCount: paid.length, failedPaise: sum(bad, 'creditPaise'), failedCount: bad.length,
    reversedCount: bad.filter((x) => x.status === 'reversed').length, waitingPaise: sum(waiting, 'creditPaise'), waitingCount: waiting.length,
    processingPaise: sum(processing, 'creditPaise'), processingCount: processing.length, owedPaise: owed, owedFarmers, next, mode: conf.mode };
}

function runView(run) {
  const items = db.payouts.filter((x) => x.runId === run.id).map((x) => { const f = farmerById(x.farmerId); return { ...clone(x), code: f?.code, name: f?.name, pref: prefOf(f) }; })
    .sort((a, b) => a.code - b.code);
  const by = (st) => items.filter((x) => x.status === st);
  return { ...clone(run), items, okCount: by('success').length, failCount: by('failed').length, processingCount: by('processing').length, reversedCount: by('reversed').length,
    waitingCount: items.filter((x) => x.status === 'proposed' && x.waitApproval).length, rejectedCount: by('rejected').length,
    sentPaise: sum(by('success'), 'creditPaise'), failedPaise: sum(by('failed'), 'creditPaise') };
}
const pinOk = (u, pin) => u.pin === String(pin || '');

function stockOf(itemId) {
  return db.feedMoves.filter((m) => m.itemId === itemId).reduce((s, m) => s + (m.type === 'in' ? m.qty : m.type === 'sale' ? -m.qty : m.qty), 0);
}

function billNo(cycle, farmer) {
  const day = Number(cycle.start.slice(8, 10));
  const idx = Math.floor((day - 1) / (db.center.cycleDays === 10 ? 10 : 7));
  return `${cycle.start.slice(0, 4)}/${cycle.start.slice(5, 7)}-${'ABCDE'[idx] || 'X'}/${farmer.code}`;
}

function queueMessage({ farmer, kind, date, texts, billId, broadcastId, entryId, ticketId, ticketMsgId, payoutId, payoutStatus, noSms = false }) {
  const channel = chooseChannel(farmer);
  if (!channel) return null;
  if (db.outbox.some((m) => m.farmerId === farmer.id && m.kind === kind && m.date === date && m.billId === (billId || null) && (m.broadcastId || null) === (broadcastId || null) && (m.entryId || null) === (entryId || null) && (m.ticketMsgId || null) === (ticketMsgId || null) && (m.payoutKey || null) === (payoutId ? payoutId + ':' + payoutStatus : null))) return null;
  const msg = { id: uuid(), centerId: CENTER_ID, farmerId: farmer.id, kind, date, billId: billId || null, channel,
    to: farmer.mobile, texts, attempts: 0, status: 'queued', nextAttemptAt: 0, createdAt: nowIso(), sentAt: null, lastError: null,
    ...(broadcastId ? { broadcastId } : {}), ...(entryId ? { entryId } : {}), ...(ticketId ? { ticketId, ticketMsgId } : {}), ...(payoutId ? { payoutId, payoutStatus, payoutKey: payoutId + ':' + payoutStatus } : {}), ...(noSms ? { noSms: true } : {}) };
  db.outbox.push(msg);
  return msg;
}

/** IST date + 'HH:MM' → ISO timestamp. */
const istIso = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();

/**
 * Demo message history (D-57): one daily summary per farmer for every past day with milk (sent at the
 * daily-summary time), and each bill message dated the morning after its period. Runs once per data set.
 */
function backfillMessages() {
  if (db.msgHistory) return;
  const today = todayIST();
  const first = db.collections.reduce((m, c) => (!m || c.date < m ? c.date : m), '');
  const at = db.center.dailySummaryTime || '20:30';
  if (first) {
    for (let d = first; d < today; d = addDays(d, 1)) {
      for (const f of byCenter(db.farmers)) {
        const entries = db.collections.filter((c) => !c.void && c.farmerId === f.id && c.date === d).sort((a, b) => entryOrder(a).localeCompare(entryOrder(b)));
        if (!entries.length) continue;
        const m = queueMessage({ farmer: f, kind: 'daily', date: d, texts: dailySummary({ farmer: f, date: d, entries }) });
        if (m) Object.assign(m, { status: 'sent', attempts: 1, createdAt: istIso(d, at), sentAt: istIso(d, at) });
        else { const ex = db.outbox.find((x) => x.farmerId === f.id && x.kind === 'daily' && x.date === d); if (ex && ex.status === 'sent') ex.createdAt = ex.sentAt = istIso(d, at); }
      }
    }
  }
  for (const m of db.outbox) {
    if (m.kind !== 'bill' || !m.billId) continue;
    const b = db.bills.find((x) => x.id === m.billId); if (!b) continue;
    const day = addDays(b.end, 1) < today ? addDays(b.end, 1) : today;
    m.date = day; m.createdAt = istIso(day, '09:00'); if (m.status === 'sent') m.sentAt = istIso(day, '09:01');
  }
  db.msgHistory = true;
}

// ---------- API ----------
const api = {
  // auth
  // pinLength lets the login screen sign in as soon as the PIN is complete (4–6 digits). The PIN itself never leaves.
  /** Users shown on the login screen (active only). */
  async users({ support = false } = {}) { // D-109: Bokare support has its own login (#/login?as=support), not on the centre's list
    return db.users.filter((u) => u.active !== false && (u.role === 'support') === support).map(({ pin, ...u }) => ({ ...u, pinLength: pin.length }));
  },
  async login(userId, pin) {
    const u = db.users.find((x) => x.id === userId && x.active !== false);
    if (!u) throw new ApiError('bad-pin');
    if (failedRecently(u.id) >= MAX_FAILED) throw new ApiError('too-many-attempts');
    if (u.pin !== pin) { audit('login-failed', 'user', u.id, null, { ua: userAgent() }, u.id); save(); throw new ApiError('bad-pin'); }
    const s = { id: uuid(), centerId: CENTER_ID, userId: u.id, loginAt: nowIso(), lastSeenAt: nowIso(), logoutAt: null, ua: userAgent() };
    db.sessions.push(s);
    sessionUserId = u.id; sessionId = s.id;
    try { localStorage.setItem(SESSION_KEY, u.id); localStorage.setItem(SESSION_ID_KEY, s.id); } catch { /* ignore */ }
    audit('login', 'user', u.id, null, { ua: s.ua }); save();
    const { pin: _p, ...safe } = u; return safe;
  },
  async logout() {
    const s = currentSession();
    if (s) { s.logoutAt = nowIso(); s.lastSeenAt = s.logoutAt;
      if (s.farmerId) audit('logout', 'farmer', s.farmerId, null, null, null); else audit('logout', 'user', s.userId, null, null);
      save(); }
    sessionUserId = null; sessionId = null;
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_ID_KEY); } catch { /* ignore */ }
  },
  async me() {
    const fs = farmerSession();
    if (fs) { touchSession(); const f = fs.farmer; return { id: 'farmer:' + f.id, role: 'farmer', farmerId: f.id, name: f.name, code: f.code }; }
    try { const { pin, ...u } = me(); touchSession(); return u; } catch { return null; }
  },

  // farmer login (code only — owner's decision D-47): read-only view of the farmer's own details
  async farmerLogin(code) {
    const since = Date.now() - LOCK_MINUTES * 60000;
    if (db.audit.filter((a) => a.action === 'farmer-login-failed' && Date.parse(a.at) > since).length >= MAX_FARMER_FAILED) throw new ApiError('too-many-attempts');
    const n = Number(String(code ?? '').trim());
    const f = Number.isInteger(n) && n > 0 ? db.farmers.find((x) => x.code === n && x.active) : null;
    if (!f) { audit('farmer-login-failed', 'farmer', String(code ?? ''), null, { code: String(code ?? ''), ua: userAgent() }, null); save(); throw new ApiError('farmer-code-not-found'); }
    const s = { id: uuid(), centerId: CENTER_ID, userId: null, farmerId: f.id, loginAt: nowIso(), lastSeenAt: nowIso(), logoutAt: null, ua: userAgent() };
    db.sessions.push(s);
    sessionUserId = 'farmer:' + f.id; sessionId = s.id;
    try { localStorage.setItem(SESSION_KEY, sessionUserId); localStorage.setItem(SESSION_ID_KEY, s.id); } catch { /* ignore */ }
    audit('login', 'farmer', f.id, null, { code: f.code, name: f.name, ua: s.ua }, null); save();
    return api.me();
  },
  /**
   * Everything a farmer may see about themselves, for a date range (default: last 30 days; all: true = since their first entry):
   * profile (mobile/UPI masked), today, balances and the open period (always "now"), and for the range:
   * summary, a day-by-day trend, every entry (newest first) and the bills that overlap it.
   */
  async myDetails({ from, to, all = false } = {}) {
    const fs = farmerSession(); if (!fs) throw new ApiError('unauthenticated');
    touchSession();
    const f = fs.farmer; const today = todayIST();
    const mine = db.collections.filter((c) => !c.void && c.farmerId === f.id);
    const firstDate = mine.reduce((m, c) => (c.date < m ? c.date : m), today);
    const ok = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (all) { from = firstDate; to = today; }
    else {
      if (!ok(to) || to > today) to = today;
      if (!ok(from)) from = addDays(to, -29);
      if (from > to) [from, to] = [to, from];
    }
    const inRange = mine.filter((e) => e.date >= from && e.date <= to).sort((x, y) => (entryOrder(x) < entryOrder(y) ? 1 : -1));
    const lit = sum(inRange, 'litresX100');
    const w = (k) => (lit ? Math.round(inRange.reduce((t, e) => t + e[k] * e.litresX100, 0) * 10 / lit) : 0);
    const milkDays = new Set(inRange.map((e) => e.date)).size;
    const trend = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const rows = inRange.filter((e) => e.date === d);
      trend.push({ date: d, inRange: true, litresX100: sum(rows, 'litresX100'),
        cowX100: sum(rows.filter((e) => e.milkType === 'cow'), 'litresX100'), buffaloX100: sum(rows.filter((e) => e.milkType === 'buffalo'), 'litresX100') });
    }
    const bills = db.bills.filter((x) => x.farmerId === f.id && x.end >= from && x.start <= to).sort((x, y) => (x.start < y.start ? 1 : -1)).map((x) => {
      const pays = db.payments.filter((p) => p.billId === x.id).sort((p, q) => (p.date < q.date ? 1 : -1));
      return { id: x.id, start: x.start, end: x.end, litresX100: x.litresX100, avgFatX100: x.avgFatX100, avgSnfX100: x.avgSnfX100, grossPaise: x.grossPaise,
        feedPaise: x.feedPaise, advancePaise: x.advancePaise, previousDuesPaise: x.previousDuesPaise, carryForwardDuesPaise: x.carryForwardDuesPaise,
        totalDeductPaise: x.totalDeductPaise, payablePaise: x.payablePaise, paidPaise: x.paidPaise, status: x.status,
        token: x.status === 'final' ? x.token : null, lastPayment: pays[0] ? { date: pays[0].date, mode: pays[0].mode } : null };
    });
    const cyc = currentCycle(today);
    const openBilled = db.bills.some((x) => x.farmerId === f.id && x.cycleId === cycleKey(cyc));
    const open = mine.filter((e) => e.date >= cyc.start && e.date <= cyc.end);
    const c = db.center;
    return {
      farmer: { id: f.id, code: f.code, name: f.name, village: f.village, milkTypes: f.milkTypes.slice(), hasWhatsapp: f.hasWhatsapp,
        mobileMasked: maskMobile(f.mobile), upiMasked: maskUpi(f.upiId), aadhaarLast4: f.aadhaarLast4 || '' },
      center: { name: c.name, mobile: c.mobile, morningFrom: c.morningFrom, morningTo: c.morningTo, eveningFrom: c.eveningFrom, eveningTo: c.eveningTo,
        cycleDays: c.cycleDays, cycleAnchor: c.cycleAnchor },
      today: clone(mine.filter((e) => e.date === today).sort((x, y) => (entryOrder(x) < entryOrder(y) ? -1 : 1))),
      balances: balances(f.id),
      openCycle: openBilled ? null : { start: cyc.start, end: cyc.end, litresX100: sum(open, 'litresX100'), amountPaise: sum(open, 'amountPaise'), entries: open.length },
      firstDate,
      range: { from, to, days: daysBetween(from, to) + 1, all: !!all },
      summary: { litresX100: lit, amountPaise: sum(inRange, 'amountPaise'), entries: inRange.length, milkDays,
        avgPerDayX100: milkDays ? Math.round(lit / milkDays) : 0, avgFatX100: w('fatX10'), avgSnfX100: w('snfX10'),
        avgRatePaise: lit ? Math.round(sum(inRange, 'amountPaise') * 100 / lit) : 0 },
      trend,
      entries: clone(inRange),
      bills,
    };
  },

  // staff (owner)
  /** Every user with status, last login, and logins and work in { from, to } (default: today). */
  async staff({ from, to } = {}) {
    requireRole('owner');
    const today = todayIST();
    const lo = from || (to ? '0000-01-01' : today), hi = to || today;
    const inR = (d) => d >= lo && d <= hi;
    const ONLINE_MS = 5 * 60000;
    return db.users.filter((u) => u.role !== 'support').map(({ pin, ...u }) => { // D-109: Bokare support is not centre staff
      const ss = db.sessions.filter((s) => s.userId === u.id).sort((a, b) => (a.loginAt < b.loginAt ? 1 : -1));
      const last = ss[0] || null;
      const open = ss.find((s) => !s.logoutAt && Date.now() - Date.parse(s.lastSeenAt) < ONLINE_MS);
      const mine = (list, k = 'createdBy') => list.filter((x) => x[k] === u.id);
      const coll = mine(db.collections).filter((c) => inR(c.date) && !c.void);
      return { ...clone(u), pinLength: pin.length,
        online: !!open, lastLoginAt: last?.loginAt || null, lastSeenAt: last ? (last.logoutAt || last.lastSeenAt) : null,
        lastDevice: last ? deviceLabel(last.ua) : null, sessions: ss.filter((s) => inR(toIstDate(s.loginAt))).length,
        failed: db.audit.filter((a) => a.action === 'login-failed' && a.entityId === u.id && inR(toIstDate(a.at))).length,
        work: { entries: coll.length, litresX100: sum(coll, 'litresX100'), amountPaise: sum(coll, 'amountPaise'),
          feedSales: mine(db.feedMoves).filter((m) => m.type === 'sale' && inR(m.date)).length,
          advances: mine(db.advances).filter((a) => inR(a.date)).length,
          dispatches: mine(db.dispatches).filter((d) => inR(d.date)).length,
          corrections: db.corrections.filter((c) => c.requestedBy === u.id && inR(toIstDate(c.requestedAt))).length } };
    });
  },
  /** Login sessions (newest first) plus failed PIN attempts, optionally for one user. */
  async loginHistory({ userId, limit = 100 } = {}) {
    requireRole('owner');
    const sessions = db.sessions.filter((s) => s.userId && (!userId || s.userId === userId)).sort((a, b) => (a.loginAt < b.loginAt ? 1 : -1)).slice(0, limit)
      .map((s) => ({ ...clone(s), device: deviceLabel(s.ua), open: !s.logoutAt }));
    const failed = db.audit.filter((a) => a.action === 'login-failed' && (!userId || a.entityId === userId)).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30)
      .map((a) => ({ at: a.at, userId: a.entityId, device: deviceLabel(a.after?.ua) }));
    return { sessions, failed };
  },
  /** Add or edit a user (owner). New users are operators; the owner account cannot be disabled. */
  async saveUser(input) {
    const me_ = requireRole('owner');
    const name = String(input.name || '').trim();
    if (!name) throw new ApiError('name-required');
    if (input.mobile && !/^[6-9]\d{9}$/.test(input.mobile)) throw new ApiError('invalid-mobile');
    if (input.pin && !/^\d{4,6}$/.test(input.pin)) throw new ApiError('invalid-pin');
    const ex = input.id ? db.users.find((u) => u.id === input.id) : null;
    if (!ex && !input.pin) throw new ApiError('invalid-pin');
    if (ex && (ex.role === 'owner' || ex.id === me_.id) && input.active === false) throw new ApiError('cannot-disable-owner');
    const before = ex ? (({ pin, ...u }) => u)(ex) : null;
    const rec = ex || { id: 'u-' + uuid().slice(0, 8), centerId: CENTER_ID, role: 'operator', createdAt: nowIso() };
    Object.assign(rec, { name, mobile: input.mobile || '', active: input.active !== false });
    // D-86: which tabs an operator may open (null = all); दूध संकलन is always included
    if (rec.role === 'operator' && Array.isArray(input.pages)) rec.pages = [...new Set(['/collection', ...input.pages.filter((x) => OPERATOR_PATHS.includes(x))])];
    if (input.pin) rec.pin = input.pin;
    if (!ex) db.users.push(rec);
    if (rec.active === false) for (const s of db.sessions) if (s.userId === rec.id && !s.logoutAt) s.logoutAt = nowIso(); // end their sessions
    audit(ex ? 'update' : 'create', 'user', rec.id, before, { name: rec.name, mobile: rec.mobile, active: rec.active, pages: rec.pages || null, pinChanged: !!input.pin });
    save();
    const { pin, ...safe } = rec; return safe;
  },

  // center settings
  async center() { return clone(db.center); },
  async saveCenter(patch) {
    requireRole('owner');
    const before = clone(db.center);
    const next = { ...db.center, ...patch };
    if (![7, 10].includes(Number(next.cycleDays))) throw new ApiError('invalid');
    next.cycleDays = Number(next.cycleDays); next.smsCap = Math.max(0, Number(next.smsCap) || 0);
    db.center = next; audit('update', 'center', CENTER_ID, before, next); save();
    return clone(next);
  },
  async changePin(userId, pin) {
    requireRole('owner');
    if (!/^\d{4,6}$/.test(pin)) throw new ApiError('invalid-pin');
    const u = db.users.find((x) => x.id === userId); if (!u) throw new ApiError('not-found');
    u.pin = pin; audit('change-pin', 'user', userId, null, null); save();
  },

  // farmers
  async farmers({ includeInactive = false } = {}) {
    me();
    return clone(byCenter(db.farmers).filter((f) => includeInactive || f.active).sort((a, b) => a.code - b.code));
  },
  async farmer(id) { me(); const f = farmerById(id); if (!f) throw new ApiError('not-found'); return { ...clone(f), balances: balances(id), pendingChanges: pendingFor(id) }; },
  /**
   * One farmer's performance for the owner: last `days` (default 30) vs the previous `days`,
   * weekly average (last 28 days ÷ 4), litre-weighted Fat/SNF, avg rate, shift & milk-type split,
   * profit (dairy rate for the same shift − rate paid; only shifts with a dispatch entry),
   * daily trend, the open cycle so far, and the last 7 bills with payment status.
   */
  /** A farmer's figures for a date range: { from, to } (IST, inclusive; a from before the first entry starts at the first entry),
   *  or the last `days` days. Bills shown are those overlapping the range (newest first). */
  async farmerInsights(farmerId, { days = 30, from: askFrom, to: askTo } = {}) {
    const fs = farmerSession();
    if (fs && fs.farmerId !== farmerId) throw new ApiError('forbidden');
    const isOwner = fs ? false : me().role === 'owner';
    const realToday = todayIST();
    const all = byCenter(db.collections).filter((c) => !c.void && c.farmerId === farmerId);
    const firstEntry = all.reduce((m, c) => (!m || c.date < m ? c.date : m), '') || realToday;
    const today = askTo && askTo <= realToday ? askTo : realToday; // end of the range
    let from = askFrom ? (askFrom < firstEntry ? firstEntry : askFrom) : addDays(today, -(days - 1));
    if (from > today) from = today;
    days = daysBetween(from, today) + 1;
    const prevFrom = addDays(from, -days); const prevTo = addDays(from, -1);
    const win = all.filter((c) => c.date >= from && c.date <= today);
    const prev = all.filter((c) => c.date >= prevFrom && c.date <= prevTo);
    const lit = sum(win, 'litresX100');
    const w = (k) => (lit ? Math.round(win.reduce((s, c) => s + c[k] * c.litresX100, 0) * 10 / lit) : 0);
    const milkDays = new Set(win.map((c) => c.date)).size;
    // profit (D-80): the dairy chart's value of this farmer's milk − what we paid (dispatch rate where no dairy chart)
    const disp = new Map(byCenter(db.dispatches).map((d) => [`${d.date}|${d.shift}|${d.milkType}`, d]));
    let revenue = 0, cost = 0, coveredX100 = 0;
    for (const c of win) {
      const p = entryProfit(c, disp); if (!p) continue;
      revenue += p.revenuePaise; cost += p.costPaise; coveredX100 += c.litresX100;
    }
    const trend = [];
    for (let d = from; d <= today; d = addDays(d, 1)) {
      const rows = win.filter((c) => c.date === d);
      const dl = sum(rows, 'litresX100'); const wd = (k) => (dl ? Math.round(rows.reduce((s2, c) => s2 + c[k] * c.litresX100, 0) * 10 / dl) : 0);
      trend.push({ date: d, inRange: true, litresX100: dl, avgFatX100: wd('fatX10'), avgSnfX100: wd('snfX10'), // per-day fat/SNF for the side panel (D-61)
        cowX100: sum(rows.filter((c) => c.milkType === 'cow'), 'litresX100'), buffaloX100: sum(rows.filter((c) => c.milkType === 'buffalo'), 'litresX100') });
    }
    const cyc = currentCycle(realToday);
    const open = all.filter((c) => c.date >= cyc.start && c.date <= cyc.end);
    const openInRange = cyc.start <= today && cyc.end >= from;
    const openBilled = db.bills.some((b) => b.farmerId === farmerId && b.cycleId === cycleKey(cyc));
    const bills = db.bills.filter((b) => b.farmerId === farmerId && b.end >= from && b.start <= today).sort((a, b) => (a.start < b.start ? 1 : -1)).map((b) => {
      const pays = db.payments.filter((p) => p.billId === b.id).sort((a, x) => (a.date < x.date ? 1 : -1));
      return { id: b.id, no: b.no, start: b.start, end: b.end, litresX100: b.litresX100, avgFatX100: b.avgFatX100, avgSnfX100: b.avgSnfX100,
        grossPaise: b.grossPaise, totalDeductPaise: b.totalDeductPaise, payablePaise: b.payablePaise, paidPaise: b.paidPaise, status: b.status,
        carryForwardDuesPaise: b.carryForwardDuesPaise, token: b.status === 'final' ? b.token : null, lastPayment: pays[0] ? { date: pays[0].date, mode: pays[0].mode } : null };
    });
    const lastEntry = all.reduce((m, c) => (c.date > m ? c.date : m), '');
    return {
      from, to: today, days,
      litresX100: lit, prevLitresX100: sum(prev, 'litresX100'), amountPaise: sum(win, 'amountPaise'),
      milkDays, avgPerDayX100: milkDays ? Math.round(lit / milkDays) : 0, weeklyAvgX100: Math.round(lit * 7 / days),
      avgFatX100: w('fatX10'), avgSnfX100: w('snfX10'), avgRatePaise: lit ? Math.round(sum(win, 'amountPaise') * 100 / lit) : 0,
      morningX100: sum(win.filter((c) => c.shift === 'morning'), 'litresX100'), eveningX100: sum(win.filter((c) => c.shift === 'evening'), 'litresX100'),
      cowX100: sum(win.filter((c) => c.milkType === 'cow'), 'litresX100'), buffaloX100: sum(win.filter((c) => c.milkType === 'buffalo'), 'litresX100'),
      lastEntry: lastEntry || null,
      // profit is the owner's business figure only
      profit: isOwner ? { revenuePaise: revenue, costPaise: cost, profitPaise: revenue - cost, coveredX100,
        perLitrePaise: coveredX100 ? Math.round((revenue - cost) * 100 / coveredX100) : 0 } : null,
      trend,
      openCycle: openBilled || !openInRange ? null : { start: cyc.start, end: cyc.end, litresX100: sum(open, 'litresX100'), amountPaise: sum(open, 'amountPaise'),
        avgFatX100: (() => { const l = sum(open, 'litresX100'); return l ? Math.round(open.reduce((s, c) => s + c.fatX10 * c.litresX100, 0) * 10 / l) : 0; })() },
      bills,
    };
  },
  async farmerByCode(code) { me(); return clone(db.farmers.find((f) => f.code === Number(code) && f.active)) || null; },
  async nextFarmerCode() { requireRole('owner', 'operator'); return Math.max(100, ...db.farmers.map((f) => f.code)) + 1; },
  /** Owner: add or edit. Operator: add a new farmer only (D-69); changing an existing farmer stays with the owner. */
  async saveFarmer(input) {
    const u = requirePage(requireRole('owner', 'operator'), '/farmers');
    if (input.id && u.role !== 'owner') { // D-108: an operator's change waits for the owner
      const f = farmerById(input.id); if (!f) throw new ApiError('not-found');
      const req = makeChangeRequest(f, input, OPERATOR_FIELDS, u.id, 'operator', input.changeNote); save();
      return { ...clone(f), pendingRequest: clone(req) };
    }
    const code = Number(input.code);
    if (!Number.isInteger(code) || code <= 0) throw new ApiError('invalid-code');
    if (!input.name) throw new ApiError('name-required');
    if (input.mobile && !/^[6-9]\d{9}$/.test(input.mobile)) throw new ApiError('invalid-mobile');
    if (!input.milkTypes?.length) throw new ApiError('milk-type-required');
    if (db.farmers.some((f) => f.code === code && f.id !== input.id)) throw new ApiError('duplicate-code');
    // D-59: Aadhaar is required for new farmers (12 digits, first digit 2–9 as UIDAI issues them).
    if (!input.id && !input.aadhaar) throw new ApiError('aadhaar-required');
    if (input.aadhaar && !/^[2-9]\d{11}$/.test(input.aadhaar)) throw new ApiError('invalid-aadhaar');
    const existing = input.id ? farmerById(input.id) : null;
    if (input.payPref !== undefined && !validPref(input.payPref)) throw new ApiError('invalid-pay-pref');
    const { aadhaar, id: _id, ...rest } = input;
    if (existing && rest.upiId !== undefined && (rest.upiId || '') !== (existing.upiId || '')) rest.upiCheck = { status: 'none' }; // D-107: new UPI ID → check again
    if (existing && ((rest.bankAccount !== undefined && (rest.bankAccount || '') !== (existing.bankAccount || '')) || (rest.bankIfsc !== undefined && String(rest.bankIfsc || '').toUpperCase() !== String(existing.bankIfsc || '').toUpperCase()))) rest.bankCheck = { status: 'none' }; // D-110
    if (rest.payMethod !== undefined && !PAY_METHODS.includes(rest.payMethod)) throw new ApiError('invalid');
    if (rest.nameEn !== undefined) { rest.nameEn = String(rest.nameEn || '').trim().replace(/\s+/g, ' ').slice(0, 80); rest.nameEnAuto = false; } // D-118
    if (rest.name !== undefined) rest.name = String(rest.name || '').trim().replace(/\s+/g, ' ');
    if (u.role !== 'owner') delete rest.deductionConsent;
    if (!existing) { rest.upiCheck = { status: 'none' }; rest.bankCheck = { status: 'none' }; }
    if (rest.payPref) rest.payPref = prefOf({ payPref: rest.payPref }); // never let an empty id from the form overwrite the new one
    const rec = { ...(existing || { id: 'f' + uuid().slice(0, 8), centerId: CENTER_ID, createdAt: nowIso() }), ...rest, code,
      // The backend stores Aadhaar encrypted; the client only ever sees the last 4 digits.
      aadhaarLast4: aadhaar ? aadhaar.slice(-4) : (existing?.aadhaarLast4 || '') };
    if (!rec.nameEn) { rec.nameEn = toEnglish(rec.name); rec.nameEnAuto = true; }
    for (const [en, mr] of learnPairs(rec.name, rec.nameEn)) db.nameWords[en] = mr; // D-118: remember the centre's spellings
    if (existing) Object.assign(existing, rec); else db.farmers.push(rec);
    audit(existing ? 'update' : 'create', 'farmer', rec.id, existing ? clone(existing) : null, rec); save();
    return clone(rec);
  },

  // rate charts
  /** Rate charts of one side ('farmer' default, or 'dairy'; 'all' for both), newest first. */
  async charts({ side = 'farmer' } = {}) {
    me();
    return clone(byCenter(db.charts).filter((c) => side === 'all' || sideOf(c) === side).map((c) => ({ ...c, side: sideOf(c) }))
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : (a.createdAt < b.createdAt ? 1 : -1))));
  },
  async chart(id) { me(); const c = db.charts.find((x) => x.id === id); if (!c) throw new ApiError('not-found'); return { ...clone(c), side: sideOf(c) }; },
  /**
   * Save a new rate chart version (A2.2: never edited in place, history kept).
   * effectiveTo: optional last day (e.g. "today only"); after it the previous chart applies again.
   * reprice: also re-price entries already recorded in [effectiveFrom, effectiveTo ∧ today] (open cycles only).
   */
  async saveChart({ milkType, effectiveFrom, effectiveTo = null, fats, snfs, rates, note, reprice = false, side = 'farmer' }) {
    const u = requireRole('owner');
    checkChartInput({ milkType, effectiveFrom, effectiveTo, fats, snfs });
    if (!['farmer', 'dairy'].includes(side)) throw new ApiError('invalid');
    const rec = { id: 'rc-' + uuid().slice(0, 8), centerId: CENTER_ID, side, milkType, effectiveFrom, effectiveTo: effectiveTo || null,
      fats, snfs, rates, note: note || '', createdAt: nowIso(), createdBy: u.id };
    db.charts.push(rec);
    audit('create', 'rate-chart', rec.id, null, { side, milkType, effectiveFrom, effectiveTo: rec.effectiveTo, rows: fats.length, cols: snfs.length });
    // re-pricing recorded milk only applies to the farmer chart (the dairy chart changes profit, never what a farmer is paid)
    const result = reprice && side === 'farmer' ? repriceEntries(milkType, effectiveFrom, rec.effectiveTo, true) : null;
    save();
    return { ...clone(rec), repriced: result };
  },
  /** What saving this chart would do to entries already recorded (nothing is changed). */
  async previewRateChange({ milkType, effectiveFrom, effectiveTo = null, fats, snfs, rates }) {
    requireRole('owner');
    checkChartInput({ milkType, effectiveFrom, effectiveTo, fats, snfs });
    const temp = { id: '__preview', centerId: CENTER_ID, side: 'farmer', milkType, effectiveFrom, effectiveTo: effectiveTo || null, fats, snfs, rates, createdAt: '9999' };
    db.charts.push(temp);
    try { return repriceEntries(milkType, effectiveFrom, temp.effectiveTo, false); } finally { db.charts.pop(); }
  },
  /** The chart in force for a milk type on a date (or null). */
  async chartOn(milkType, date, side = 'farmer') { me(); return clone(chartFor(side === 'dairy' ? dairyCharts() : farmerCharts(), milkType, date)); },
  /** First date whose entries can still change (day after the last finalized bill cycle). */
  async firstOpenDate() {
    me();
    const ends = db.cycles.filter((c) => c.status === 'finalized').map((c) => c.end).sort();
    return ends.length ? addDays(ends.at(-1), 1) : '2000-01-01';
  },
  async quote({ milkType, date, litresX100, fatX10, snfX10, side = 'farmer' }) {
    me();
    return priceEntry({ milkType, date, litresX100, fatX10, snfX10 }, side === 'dairy' ? dairyCharts() : farmerCharts(), db.center.rateRule);
  },

  // collection
  async collections({ date, shift, farmerId, from, to } = {}) {
    me();
    return clone(byCenter(db.collections).filter((c) => !c.void && (!date || c.date === date) && (!shift || c.shift === shift)
      && (!farmerId || c.farmerId === farmerId) && (!from || c.date >= from) && (!to || c.date <= to))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  },
  /** Dates in [from, to] that have at least one milk entry (calendar dots). */
  async entryDates(from, to) {
    me();
    return new Set(byCenter(db.collections).filter((c) => !c.void && c.date >= from && c.date <= to).map((c) => c.date));
  },
  async collection(id) { me(); return clone(db.collections.find((c) => c.id === id)) || null; },
  /** Idempotent on `id` (client UUID): resending the same entry returns the stored one. */
  async addCollection(input) {
    const u = requireRole('owner', 'operator');
    const same = db.collections.find((c) => c.id === input.id);
    if (same) return clone(same);
    const farmer = farmerById(input.farmerId);
    if (!farmer || !farmer.active) throw new ApiError('farmer-not-found');
    if (!farmer.milkTypes.includes(input.milkType)) throw new ApiError('milk-type-mismatch');
    if (isLocked(input.date)) throw new ApiError('cycle-locked');
    const cand = { ...input, centerId: CENTER_ID };
    const dup = findDuplicate(byCenter(db.collections), cand);
    if (dup) throw new ApiError('duplicate', clone(dup));
    const p = priceEntry(input, farmerCharts(), db.center.rateRule);
    if (!p.ok) throw new ApiError(p.errors.rate ? 'rate-' + p.errors.rate : 'invalid', p.errors);
    const rec = { id: input.id, centerId: CENTER_ID, farmerId: farmer.id, date: input.date, shift: input.shift, milkType: input.milkType,
      litresX100: input.litresX100, fatX10: input.fatX10, snfX10: input.snfX10, ratePaise: p.ratePaise, amountPaise: p.amountPaise,
      chartId: p.chartId, createdAt: nowIso(), createdBy: u.id, void: false };
    db.collections.push(rec); audit('create', 'collection', rec.id, null, rec);
    // D-73: the farmer gets this entry on WhatsApp (SMS if no WhatsApp) as soon as it is saved
    queueMessage({ farmer, kind: 'pour', date: rec.date, texts: pourMessage({ farmer, entry: rec }), entryId: rec.id });
    payImmediately(farmer.id); // D-110 immediate mode
    save();
    return clone(rec);
  },

  // corrections (A3.4)
  async requestCorrection(entryId, { litresX100, fatX10, snfX10, voidEntry = false, reason }) {
    const u = requireRole('owner', 'operator');
    const e = db.collections.find((c) => c.id === entryId);
    if (!e) throw new ApiError('not-found');
    if (isLocked(e.date)) throw new ApiError('cycle-locked');
    if (!reason) throw new ApiError('reason-required');
    if (db.corrections.some((c) => c.entryId === entryId && c.status === 'pending')) throw new ApiError('correction-pending');
    const after = voidEntry ? { void: true } : { litresX100, fatX10, snfX10 };
    if (!voidEntry) {
      const p = priceEntry({ ...e, ...after }, farmerCharts(), db.center.rateRule);
      if (!p.ok) throw new ApiError(p.errors.rate ? 'rate-' + p.errors.rate : 'invalid', p.errors);
    }
    const rec = { id: uuid(), centerId: CENTER_ID, entryId, requestedBy: u.id, requestedAt: nowIso(), reason,
      before: { litresX100: e.litresX100, fatX10: e.fatX10, snfX10: e.snfX10, amountPaise: e.amountPaise }, after, status: 'pending' };
    db.corrections.push(rec); audit('request', 'correction', rec.id, null, rec); save();
    if (u.role === 'owner') await api.decideCorrection(rec.id, true);
    return clone(rec);
  },
  async corrections({ status } = {}) {
    requireRole('owner', 'operator');
    return clone(byCenter(db.corrections).filter((c) => !status || c.status === status)
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))
      .map((c) => ({ ...c, entry: db.collections.find((e) => e.id === c.entryId) })));
  },
  async decideCorrection(id, approve) {
    const u = requireRole('owner');
    const c = db.corrections.find((x) => x.id === id);
    if (!c || c.status !== 'pending') throw new ApiError('not-found');
    const e = db.collections.find((x) => x.id === c.entryId);
    if (approve) {
      if (isLocked(e.date)) throw new ApiError('cycle-locked');
      const before = clone(e);
      if (c.after.void) e.void = true;
      else {
        const p = priceEntry({ ...e, ...c.after }, farmerCharts(), db.center.rateRule);
        if (!p.ok) throw new ApiError('invalid');
        Object.assign(e, c.after, { ratePaise: p.ratePaise, amountPaise: p.amountPaise, chartId: p.chartId });
      }
      e.correctedAt = nowIso();
      audit('correct', 'collection', e.id, before, e);
      const fr = farmerById(e.farmerId); // D-73: tell the farmer the corrected figures
      if (fr) queueMessage({ farmer: fr, kind: 'pour-fix', date: e.date, texts: pourFixMessage({ farmer: fr, entry: e }), entryId: c.id });
    }
    Object.assign(c, { status: approve ? 'approved' : 'rejected', decidedBy: u.id, decidedAt: nowIso() });
    audit(approve ? 'approve' : 'reject', 'correction', c.id, null, null); save();
  },

  // feed & advances (A4)
  async feedItems() { me(); return clone(byCenter(db.feedItems)).map((i) => ({ ...i, stock: stockOf(i.id) })); },
  async saveFeedItem(item) {
    requireRole('owner');
    if (!item.name || !(item.pricePaise > 0)) throw new ApiError('invalid');
    const ex = item.id && db.feedItems.find((x) => x.id === item.id);
    const rec = { ...(ex || { id: 'fi' + uuid().slice(0, 6), centerId: CENTER_ID, active: true }), ...item };
    if (ex) Object.assign(ex, rec); else db.feedItems.push(rec);
    audit(ex ? 'update' : 'create', 'feed-item', rec.id, ex ? clone(ex) : null, rec); save();
  },
  async feedMoves({ farmerId, from, to } = {}) {
    me();
    return clone(byCenter(db.feedMoves).filter((m) => (!farmerId || m.farmerId === farmerId) && (!from || m.date >= from) && (!to || m.date <= to))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  },
  async feedMove(id) { me(); return clone(byCenter(db.feedMoves).find((m) => m.id === id)) || null; },
  async addFeedMove({ itemId, type, qty, farmerId, date, pricePaise, note }) {
    const u = requirePage(requireRole('owner', 'operator'), '/ledger');
    const item = db.feedItems.find((i) => i.id === itemId);
    if (!item || !(qty > 0) || !['in', 'sale'].includes(type)) throw new ApiError('invalid');
    if (type === 'sale') {
      if (!farmerById(farmerId)) throw new ApiError('farmer-not-found');
      if (isLocked(date)) throw new ApiError('cycle-locked');
      if (stockOf(itemId) < qty) throw new ApiError('no-stock');
    } else if (u.role !== 'owner') throw new ApiError('forbidden');
    const price = pricePaise ?? item.pricePaise;
    const rec = { id: uuid(), centerId: CENTER_ID, itemId, type, qty, pricePaise: price, amountPaise: qty * price,
      farmerId: type === 'sale' ? farmerId : null, date, note: note || '', createdAt: nowIso(), createdBy: u.id };
    db.feedMoves.push(rec); audit('create', 'feed-move', rec.id, null, rec); save();
    return clone(rec);
  },
  async advances({ farmerId } = {}) {
    me();
    return clone(byCenter(db.advances).filter((a) => !farmerId || a.farmerId === farmerId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  },
  async addAdvance({ farmerId, amountPaise, installmentPaise, date, note }) {
    const u = requirePage(requireRole('owner', 'operator'), '/ledger');
    if (!farmerById(farmerId)) throw new ApiError('farmer-not-found');
    if (!(amountPaise > 0) || !(installmentPaise > 0) || installmentPaise > amountPaise) throw new ApiError('invalid');
    const rec = { id: uuid(), centerId: CENTER_ID, farmerId, amountPaise, installmentPaise, date, note: note || '', createdAt: nowIso(), createdBy: u.id };
    db.advances.push(rec); audit('create', 'advance', rec.id, null, rec); save();
    return clone(rec);
  },
  async balances(farmerId) { me(); return balances(farmerId); },

  // ---------- expenses (D-126): owner and operator add; an operator's change / delete waits for the owner ----------
  async expenseCategories() { me(); return clone(byCenter(db.expenseCategories)); },
  async saveExpenseCategory({ id, name, monthly = false, active = true }) {
    const u = requireRole('owner'); const nm = String(name || '').trim();
    if (!nm || nm.length > 40) throw new ApiError('invalid');
    if (byCenter(db.expenseCategories).some((c) => c.id !== id && c.name === nm)) throw new ApiError('duplicate');
    let c = id ? db.expenseCategories.find((x) => x.id === id) : null; const before = c ? clone(c) : null;
    if (id && !c) throw new ApiError('not-found');
    if (c) Object.assign(c, { name: nm, monthly: !!monthly, active: !!active });
    else { c = { id: 'ec-' + uuid().slice(0, 8), centerId: CENTER_ID, name: nm, monthly: !!monthly, active: true }; db.expenseCategories.push(c); }
    audit(before ? 'update' : 'create', 'expense-category', c.id, before, clone(c), u.id); save();
    return clone(c);
  },
  /** Expenses ENTERED in [from, to] (by their date; D-128), newest first. The dashboard profit spreads monthly ones per day. */
  async expenses({ from, to } = {}) {
    requirePage(requireRole('owner', 'operator'), '/expenses');
    return clone(byCenter(db.expenses).filter((e) => !e.void && (!from || (e.date >= from && e.date <= (to || from))))
      .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1)));
  },
  async addExpense(x = {}) {
    const u = requirePage(requireRole('owner', 'operator'), '/expenses');
    const old = x.id && db.expenses.find((e) => e.id === x.id); if (old) return clone(old); // a retry of the same entry (client id)
    const rec = { id: x.id || uuid(), centerId: CENTER_ID, date: x.date, categoryId: x.categoryId, amountPaise: x.amountPaise, mode: x.mode || 'cash',
      period: x.period || 'once', note: String(x.note || '').trim(), photo: photoOf(x.photo), createdAt: nowIso(), createdBy: u.id, void: false, pending: null };
    const err = expenseError(rec, { categories: liveCats(), today: todayIST() }); if (err) throw new ApiError(err);
    db.expenses.push(rec); audit('create', 'expense', rec.id, null, noPhoto(rec), u.id); save();
    return clone(rec);
  },
  /** Owner: saved at once. Operator: the change waits for the owner (बिल व पेमेंट → मंजुरी). */
  async updateExpense({ id, changes = {}, note = '' }) {
    const u = requirePage(requireRole('owner', 'operator'), '/expenses');
    const e = db.expenses.find((x) => x.id === id && !x.void); if (!e) throw new ApiError('not-found');
    const allowed = ['date', 'categoryId', 'amountPaise', 'mode', 'period', 'note', 'photo'];
    const ch = Object.fromEntries(Object.entries(changes).filter(([k, v]) => allowed.includes(k) && v !== undefined && (k === 'photo' ? photoOf(v) !== e.photo : v !== e[k])).map(([k, v]) => [k, k === 'photo' ? photoOf(v) : k === 'note' ? String(v).trim() : v]));
    if (!Object.keys(ch).length) throw new ApiError('no-change');
    const err = expenseError({ ...e, ...ch }, { categories: liveCats(e.categoryId), today: todayIST() }); if (err) throw new ApiError(err);
    if (u.role === 'operator') {
      if (e.pending) throw new ApiError('already-pending');
      e.pending = { kind: 'edit', changes: ch, by: u.id, at: nowIso(), note: String(note || '').trim() };
      audit('request-change', 'expense', e.id, null, { changes: noPhoto(ch) }, u.id); save();
      return { ...clone(e), queued: true };
    }
    const before = noPhoto(e); Object.assign(e, ch, { pending: null, updatedAt: nowIso(), updatedBy: u.id });
    audit('update', 'expense', e.id, before, noPhoto(e), u.id); save();
    return clone(e);
  },
  async deleteExpense({ id, reason }) {
    const u = requirePage(requireRole('owner', 'operator'), '/expenses');
    const e = db.expenses.find((x) => x.id === id && !x.void); if (!e) throw new ApiError('not-found');
    const why = String(reason || '').trim(); if (!why) throw new ApiError('reason-required');
    if (u.role === 'operator') {
      if (e.pending) throw new ApiError('already-pending');
      e.pending = { kind: 'delete', by: u.id, at: nowIso(), note: why };
      audit('request-delete', 'expense', e.id, null, { reason: why }, u.id); save();
      return { ...clone(e), queued: true };
    }
    Object.assign(e, { void: true, voidReason: why, voidedAt: nowIso(), voidedBy: u.id, pending: null });
    audit('delete', 'expense', e.id, noPhoto(e), { void: true, reason: why }, u.id); save();
    return clone(e);
  },
  async expenseRequests() { requireRole('owner'); return clone(byCenter(db.expenses).filter((e) => !e.void && e.pending)); },
  async decideExpense({ id, ok }) {
    const u = requireRole('owner');
    const e = db.expenses.find((x) => x.id === id && !x.void && x.pending); if (!e) throw new ApiError('not-found');
    const p = e.pending; const before = noPhoto(e);
    if (ok && p.kind === 'edit') Object.assign(e, p.changes, { updatedAt: nowIso(), updatedBy: p.by });
    if (ok && p.kind === 'delete') Object.assign(e, { void: true, voidReason: p.note, voidedAt: nowIso(), voidedBy: p.by });
    e.pending = null;
    audit(ok ? 'approve' : 'reject', 'expense', e.id, before, { request: { ...p, changes: p.changes ? noPhoto(p.changes) : undefined }, after: noPhoto(e) }, u.id); save();
    return clone(e);
  },
  /** Totals for [from, to]: entered expenses (monthly ones spread per day), costs the app counts itself, reminders. */
  async expenseSummary({ from, to }) {
    requirePage(requireRole('owner', 'operator'), '/expenses');
    return { ...expenseTotals(byCenter(db.expenses), from, to), auto: autoCostsFor(from, to), monthlyDue: clone(monthlyDue(byCenter(db.expenses), todayIST())), msgCostPaise: db.center.msgCostPaise };
  },
  async setMsgCost({ paise }) {
    const u = requireRole('owner');
    if (!Number.isInteger(paise) || paise < 0 || paise > 500) throw new ApiError('invalid');
    const before = db.center.msgCostPaise; db.center.msgCostPaise = paise;
    audit('update', 'center', CENTER_ID, { msgCostPaise: before }, { msgCostPaise: paise }, u.id); save();
    return paise;
  },

  // billing (A5)
  cycleFor(date) { return currentCycle(date); },
  previousCycle(c) { return previousCycle(c, ...cycleConf()); },
  async cycle(start, end) {
    me();
    const id = cycleKey({ start, end });
    return clone(db.cycles.find((c) => c.id === id)) || { id, centerId: CENTER_ID, start, end, status: 'open' };
  },
  async cycles() { me(); return clone(byCenter(db.cycles).sort((a, b) => (a.start < b.start ? 1 : -1))); },
  async generateBills({ start, end }) {
    requireRole('owner');
    const id = cycleKey({ start, end });
    let cyc = db.cycles.find((c) => c.id === id);
    if (cyc?.status === 'finalized') throw new ApiError('cycle-locked');
    db.bills = db.bills.filter((b) => b.cycleId !== id);
    const made = [];
    for (const f of byCenter(db.farmers).filter((x) => x.active)) {
      const entries = db.collections.filter((c) => !c.void && c.farmerId === f.id && c.date >= start && c.date <= end)
        .sort((a, b) => entryOrder(a).localeCompare(entryOrder(b)));
      const feed = feedSalesIn(f.id, start, end);
      const prev = lastBill(f.id, start);
      const adv = advanceState(f.id, id, end);
      if (!entries.length && !feed.length && !(prev?.carryForwardDuesPaise)) continue;
      const calc = computeBill({ entries, feedPaise: feed.reduce((s, m) => s + m.amountPaise, 0),
        advanceOutstandingPaise: adv.outstandingPaise, advanceInstallmentPaise: adv.installmentPaise,
        previousDuesPaise: prev?.carryForwardDuesPaise || 0 });
      const feedLines = feed.map((m) => ({ name: db.feedItems.find((i) => i.id === m.itemId)?.name || '', qty: m.qty, unit: db.feedItems.find((i) => i.id === m.itemId)?.unit || '', amountPaise: m.amountPaise, date: m.date }));
      const bill = { id: 'b-' + uuid().slice(0, 8), centerId: CENTER_ID, cycleId: id, start, end, farmerId: f.id, no: billNo({ start }, f),
        billDate: todayIST(), ...calc, feedLines, entryIds: entries.map((e) => e.id), status: 'draft', paidPaise: 0,
        token: uuid().replace(/-/g, ''), generatedAt: nowIso() };
      // D-107: UPI payouts already sent for this period's milk are part-payments of this bill
      const pre = db.payments.filter((x) => x.source === 'payout' && !x.void && x.farmerId === f.id && x.cycleId === id);
      for (const x of pre) x.billId = bill.id;
      bill.paidPaise = sum(pre, 'amountPaise'); bill.prepaidPaise = bill.paidPaise;
      if (bill.paidPaise > bill.payablePaise) { bill.overpaidPaise = bill.paidPaise - bill.payablePaise; bill.carryForwardDuesPaise += bill.overpaidPaise; }
      db.bills.push(bill); made.push(bill);
    }
    if (!cyc) { cyc = { id, centerId: CENTER_ID, start, end, status: 'generated' }; db.cycles.push(cyc); }
    Object.assign(cyc, { status: 'generated', generatedAt: nowIso(), billCount: made.length, stale: false });
    audit('generate', 'bill-cycle', id, null, { count: made.length }); save();
    return made.length;
  },
  async finalizeCycle(id) {
    const u = requireRole('owner');
    const cyc = db.cycles.find((c) => c.id === id);
    if (!cyc || cyc.status !== 'generated') throw new ApiError('not-generated');
    for (const b of db.bills.filter((x) => x.cycleId === id)) {
      b.status = 'final';
      const f = farmerById(b.farmerId);
      const link = `${publicBase()}/#/b/${b.token}`;
      queueMessage({ farmer: f, kind: 'bill', date: todayIST(), billId: b.id, texts: billMessage({ farmer: f, bill: b, link }) });
    }
    Object.assign(cyc, { status: 'finalized', finalizedAt: nowIso(), finalizedBy: u.id });
    audit('finalize', 'bill-cycle', id, null, null); save();
  },
  async bills({ cycleId, farmerId } = {}) {
    me();
    return clone(byCenter(db.bills).filter((b) => (!cycleId || b.cycleId === cycleId) && (!farmerId || b.farmerId === farmerId))
      .sort((a, b) => (a.start === b.start ? farmerById(a.farmerId).code - farmerById(b.farmerId).code : a.start < b.start ? 1 : -1)));
  },
  async bill(id) {
    me();
    const b = db.bills.find((x) => x.id === id); if (!b) throw new ApiError('not-found');
    return billView(b);
  },
  /** Public, unauthenticated bill page for SMS links (A5.6). Unguessable token, final bills only. */
  async billByToken(token) {
    const b = db.bills.find((x) => x.token === token && x.status === 'final');
    if (!b) throw new ApiError('not-found');
    return billView(b);
  },

  /** D-118: the centre's own English → Marathi name corrections (for the name suggestions in the forms). */
  async nameWords() { me(); return clone(db.nameWords || {}); },

  // ---------- test data (D-112) ----------
  /**
   * Owner, test data only: fill milk / buyers / walk-in sales / dispatches up to `until` (e.g. tomorrow), and once give every
   * newer tab something to explore: checked UPI / bank accounts, payouts in every status, farmers waiting for approval,
   * detail-change requests and help tickets. Never touches finalized bill periods or anything entered by hand.
   */
  async demoFill({ until } = {}) {
    const u = requireRole('owner');
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new ApiError('invalid');
    const added = topUpDemo(db, new Date(), { until });
    const expensesAdded = topUpExpenses(db, until && until > todayIST() ? until : todayIST()).length; // D-126: sample expenses too
    for (const e of added) { const f = farmerById(e.farmerId); if (f) queueMessage({ farmer: f, kind: 'pour', date: e.date, texts: pourMessage({ farmer: f, entry: e }), entryId: e.id }); }
    let features = false;
    if (!db.featureDemoSet) { await featureDemo(u); db.featureDemoSet = true; features = true; }
    audit('demo-fill', 'center', CENTER_ID, null, { until: until || todayIST(), entries: added.length, expenses: expensesAdded, features }, u.id); save();
    return { entries: added.length, expenses: expensesAdded, features };
  },

  // ---------- help / support tickets (D-109) ----------
  async createTicket({ category, priority = 'normal', subject, text }) {
    const w = whoAsks(); if (!w || w.kind === 'support') throw new ApiError('unauthenticated');
    if (!TICKET_CATS.includes(category)) throw new ApiError('invalid');
    if (!['normal', 'urgent'].includes(priority)) throw new ApiError('invalid');
    const sub = String(subject || '').trim().slice(0, 120); const body = String(text || '').trim().slice(0, 2000);
    if (!sub) throw new ApiError('ticket-subject-required');
    if (body.length < 5) throw new ApiError('ticket-text-required');
    db.ticketSeq = (db.ticketSeq || 0) + 1;
    const t = { id: 'tk-' + uuid().slice(0, 8), centerId: CENTER_ID, no: 'T-' + String(db.ticketSeq).padStart(4, '0'),
      by: { kind: w.kind, id: w.id, name: w.name }, category, priority, subject: sub, status: 'open',
      messages: [{ id: uuid().slice(0, 8), by: { kind: w.kind, name: w.name }, text: body, at: nowIso() }],
      notify: [], unreadFor: [], createdAt: nowIso(), updatedAt: nowIso() };
    notifySupport(t, 'created');
    db.tickets.push(t);
    audit('create', 'ticket', t.id, null, { no: t.no, category, priority }, w.key); save();
    return ticketView(t, w);
  },
  /** The person's own tickets (newest first). Owner: scope 'center' = everyone's in the centre. Support: all. */
  async tickets({ scope = 'mine', status } = {}) {
    const w = whoAsks(); if (!w) throw new ApiError('unauthenticated');
    const all = byCenter(db.tickets).filter((t) => (!status || t.status === status)
      && (w.kind === 'support' || (scope === 'center' && w.kind === 'owner') ? true : reporterKey(t) === w.key));
    return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map((t) => ticketView(t, w));
  },
  async ticket(id) {
    const w = whoAsks(); const t = db.tickets.find((x) => x.id === id);
    if (!t || !canSeeTicket(w, t)) throw new ApiError('not-found');
    if (t.unreadFor?.includes(w.key)) { t.unreadFor = t.unreadFor.filter((k) => k !== w.key); save(); }
    return ticketView(t, w);
  },
  async replyTicket(id, text) {
    const w = whoAsks(); const t = db.tickets.find((x) => x.id === id);
    if (!t || !canSeeTicket(w, t)) throw new ApiError('not-found');
    const body = String(text || '').trim().slice(0, 2000); if (!body) throw new ApiError('ticket-text-required');
    t.messages.push({ id: uuid().slice(0, 8), by: { kind: w.kind, name: w.name }, text: body, at: nowIso() });
    const fromReporter = reporterKey(t) === w.key;
    if (fromReporter) {
      if (['resolved', 'closed', 'waiting'].includes(t.status)) t.status = 'open'; // the reporter answered / it is back
      notifySupport(t, 'reply');
    } else {
      if (w.kind === 'support' && t.status === 'open') t.status = 'in-progress';
      t.unreadFor = [...new Set([...(t.unreadFor || []), reporterKey(t)])];
      if (t.by.kind === 'farmer') { const f = farmerById(t.by.id); if (f) queueMessage({ farmer: f, kind: 'support', date: todayIST(), texts: supportReplyMessage({ farmer: f, ticket: t }), ticketId: t.id, ticketMsgId: t.messages[t.messages.length - 1].id }); }
    }
    t.updatedAt = nowIso();
    audit('reply', 'ticket', t.id, null, { by: w.kind }, w.key); save();
    return ticketView(t, w);
  },
  /** Support / owner: in-progress, waiting (for the reporter), resolved. Reporter: closed (done) or open again. */
  async setTicketStatus(id, status) {
    const w = whoAsks(); const t = db.tickets.find((x) => x.id === id);
    if (!t || !canSeeTicket(w, t)) throw new ApiError('not-found');
    if (!TICKET_STATUS.includes(status)) throw new ApiError('invalid');
    const reporter = reporterKey(t) === w.key;
    const staffSide = w.kind === 'support' || (w.kind === 'owner' && !reporter);
    if (!(staffSide && ['in-progress', 'waiting', 'resolved', 'open'].includes(status)) && !(reporter && ['closed', 'open'].includes(status))) throw new ApiError('forbidden');
    const before = t.status; t.status = status; t.updatedAt = nowIso();
    t.messages.push({ id: uuid().slice(0, 8), by: { kind: w.kind, name: w.name }, status, at: nowIso() });
    if (!reporter) t.unreadFor = [...new Set([...(t.unreadFor || []), reporterKey(t)])];
    audit('status', 'ticket', t.id, { status: before }, { status }, w.key); save();
    return ticketView(t, w);
  },

  // ---------- change requests (D-108) ----------
  /** Owner: requests to change farmers' details (pending first). */
  async changeRequests({ status } = {}) {
    requireRole('owner');
    return clone(byCenter(db.changeRequests).filter((r) => (!status || r.status === status) && r.status !== 'replaced')
      .sort((a, b) => (a.status === 'pending') !== (b.status === 'pending') ? (a.status === 'pending' ? -1 : 1) : (a.requestedAt < b.requestedAt ? 1 : -1))
      .map((r) => { const f = farmerById(r.entityId); const u = db.users.find((x) => x.id === r.requestedBy);
        return { ...r, farmerCode: f?.code, farmerName: f?.name, byName: r.requestedByKind === 'farmer' ? f?.name : u?.name || r.requestedBy }; }));
  },
  async decideChange(id, approve, note = '') {
    const u = requireRole('owner');
    const r = db.changeRequests.find((x) => x.id === id && x.status === 'pending'); if (!r) throw new ApiError('not-found');
    const f = farmerById(r.entityId); if (!f) throw new ApiError('farmer-not-found');
    if (approve) {
      // still valid now? (e.g. nobody else changed the same field in between)
      for (const [k, x] of Object.entries(r.fields)) { const now = k === 'payPref' ? prefOf(f) : f[k]; if (!sameVal(now, x.before)) throw new ApiError('changed-meanwhile'); }
      applyFarmerChange(f, r.fields, u.id);
    }
    Object.assign(r, { status: approve ? 'approved' : 'rejected', decidedAt: nowIso(), decidedBy: u.id, decisionNote: String(note || '').slice(0, 300) });
    audit(approve ? 'approve' : 'reject', 'farmer-change', r.id, null, { status: r.status }, u.id); save();
    return clone(r);
  },
  /** Farmer: ask to change their own contact / payment details (blank = unchanged). */
  async requestMyChange({ fields = {}, note = '' } = {}) {
    const s = farmerSession(); if (!s) throw new ApiError('unauthenticated');
    const asked = Object.fromEntries(Object.entries(fields).filter(([k, v]) => FARMER_FIELDS.includes(k) && v !== '' && v !== null && v !== undefined));
    if ('payPref' in asked && !payoutConf().farmerCanChoose) throw new ApiError('forbidden');
    const req = makeChangeRequest(s.farmer, asked, FARMER_FIELDS, 'farmer:' + s.farmer.id, 'farmer', note); save();
    return clone(req);
  },
  async myChangeRequests() {
    const s = farmerSession(); if (!s) throw new ApiError('unauthenticated');
    const mask = (k, v) => (k === 'mobile' ? maskMobile(v) : k === 'upiId' ? maskUpi(v) : k === 'bankAccount' && v ? 'XXXX' + String(v).slice(-4) : v);
    return db.changeRequests.filter((r) => r.entityId === s.farmer.id && r.requestedByKind === 'farmer' && r.status !== 'replaced')
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1)).slice(0, 10)
      .map((r) => ({ id: r.id, status: r.status, requestedAt: r.requestedAt, decidedAt: r.decidedAt || null,
        fields: Object.fromEntries(Object.entries(r.fields).map(([k, x]) => [k, { after: mask(k, x.after) }])) }));
  },

  // ---------- farmer payouts (D-107, D-110) ----------
  async payoutSettings() { requireRole('owner'); processWebhooks(); return { ...payoutConf(), availablePaise: availablePaise(), heldPaise: heldPaise(),
    markedCount: byCenter(db.farmers).filter((f) => f.active && f.payApproval).length }; },
  async savePayoutSettings(patch) {
    const u = requireRole('owner');
    const next = { ...payoutConf(), ...patch, funding: { ...payoutConf().funding, ...(patch.funding || {}) } };
    const fd = next.funding;
    if (!PAYOUT_MODES.includes(next.mode) || !/^\d{2}:\d{2}$/.test(next.time) || ![0, 1].includes(Number(next.lagDays))
      || !(next.minPaise >= 100) || next.perFarmerCapPaise < 0 || next.dailyCapPaise < 0 || next.perTxnLimitPaise < 0 || next.feePaise < 0
      || !['center', 'farmer'].includes(next.feeBy)) throw new ApiError('invalid');
    if (fd.accountNo && !/^\d{9,18}$/.test(fd.accountNo)) throw new ApiError('invalid-account');
    if (fd.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(fd.ifsc).toUpperCase())) throw new ApiError('invalid-ifsc');
    if (next.mode !== 'off' && !(fd.accountNo && fd.ifsc && fd.accountName)) throw new ApiError('funding-required');
    fd.ifsc = String(fd.ifsc || '').toUpperCase();
    next.lagDays = Number(next.lagDays); next.eodApproval = !!next.eodApproval;
    const before = payoutConf(); db.center.payout = next;
    audit('update', 'payout-settings', CENTER_ID, before, next, u.id); save();
    return clone(next);
  },
  /** Every farmer: how they are paid (UPI / bank), its ₹1 check, when they want money, deduction consent. */
  async payoutFarmers() {
    requireRole('owner');
    return byCenter(db.farmers).filter((f) => f.active).sort((a, b) => a.code - b.code)
      .map((f) => ({ id: f.id, code: f.code, name: f.name, nameEn: f.nameEn || toEnglish(f.name), upiId: f.upiId || '', bankAccount: f.bankAccount || '', bankIfsc: String(f.bankIfsc || '').toUpperCase(), bankName: f.bankName || '',
        method: methodOf(f), pref: prefOf(f), check: clone(f.upiCheck || { status: 'none' }), bankCheck: clone(f.bankCheck || { status: 'none' }),
        verified: upiOk(f), bankVerified: bankOk(f), ready: destOk(f), hasDest: hasDest(f), consent: clone(f.deductionConsent || null), last: lastPayoutDate(f.id),
        approval: !!f.payApproval }));
  },
  /** ₹1 to the farmer's UPI ID: the bank tells whose name it is. The owner then confirms the name. */
  async verifyUpi(farmerId) {
    const u = requireRole('owner');
    const f = farmerById(farmerId); if (!f) throw new ApiError('farmer-not-found');
    if (!f.upiId) throw new ApiError('no-upi');
    const r = simVerify(f.upiId, f.name);
    db.payouts.push({ id: 'po-' + uuid().slice(0, 8), centerId: CENTER_ID, runId: null, kind: 'verify', method: 'upi', date: todayIST(), farmerId, upiId: f.upiId, destLabel: f.upiId,
      amountPaise: 100, creditPaise: 100, feePaise: payoutConf().feePaise, feeBy: 'center', parts: [], status: r.ok ? 'success' : 'failed',
      ref: r.ref || null, reason: r.reason || null, bankName: r.name || null, attempts: 1, createdAt: nowIso(), sentAt: nowIso(), approvedBy: u.id });
    f.upiCheck = r.ok ? { status: 'name-check', upiId: f.upiId, bankName: r.name, ref: r.ref, at: nowIso() } : { status: 'failed', upiId: f.upiId, reason: r.reason, at: nowIso() };
    audit('upi-verify', 'farmer', f.id, null, f.upiCheck, u.id); save();
    return clone(f.upiCheck);
  },
  /** ₹1 to the farmer's bank account (IMPS): the bank tells whose account it is. The owner then confirms the name. */
  async verifyBank(farmerId) {
    const u = requireRole('owner');
    const f = farmerById(farmerId); if (!f) throw new ApiError('farmer-not-found');
    if (!f.bankAccount || !f.bankIfsc) throw new ApiError('no-bank');
    const ifsc = String(f.bankIfsc).toUpperCase();
    const r = simVerifyBank(f.bankAccount, ifsc, f.name);
    const label = `XXXX${String(f.bankAccount).slice(-4)} · ${ifsc}`;
    db.payouts.push({ id: 'po-' + uuid().slice(0, 8), centerId: CENTER_ID, runId: null, kind: 'verify', method: 'bank', date: todayIST(), farmerId, upiId: `${f.bankAccount}|${ifsc}`, destLabel: label,
      amountPaise: 100, creditPaise: 100, feePaise: payoutConf().feePaise, feeBy: 'center', parts: [], status: r.ok ? 'success' : 'failed',
      ref: r.ref || null, reason: r.reason || null, bankName: r.name || null, attempts: 1, createdAt: nowIso(), sentAt: nowIso(), approvedBy: u.id });
    f.bankCheck = r.ok ? { status: 'name-check', account: f.bankAccount, ifsc, bankName: r.name, ref: r.ref, at: nowIso() } : { status: 'failed', account: f.bankAccount, ifsc, reason: r.reason, at: nowIso() };
    audit('bank-verify', 'farmer', f.id, null, f.bankCheck, u.id); save();
    return clone(f.bankCheck);
  },
  /** Owner looked at the name the bank gave: same person (ok) or not. method: 'upi' (default) or 'bank'. */
  async confirmUpiName({ farmerId, ok, method = 'upi' }) {
    const u = requireRole('owner');
    const f = farmerById(farmerId); const key = method === 'bank' ? 'bankCheck' : 'upiCheck';
    if (!f || f[key]?.status !== 'name-check') throw new ApiError('invalid');
    const before = clone(f[key]);
    f[key] = { ...f[key], status: ok ? 'verified' : 'rejected', decidedAt: nowIso(), decidedBy: u.id };
    audit(method === 'bank' ? 'bank-name' : 'upi-name', 'farmer', f.id, before, f[key], u.id); save();
    return clone(f[key]);
  },
  async setPayPref({ farmerId, pref }) {
    const u = requireRole('owner');
    const f = farmerById(farmerId); if (!f) throw new ApiError('farmer-not-found');
    if (!validPref(pref)) throw new ApiError('invalid-pay-pref');
    const before = clone(f.payPref); f.payPref = prefOf({ payPref: pref });
    audit('update', 'pay-pref', f.id, before, f.payPref, u.id); save();
    return clone(f.payPref);
  },
  async setPayMethod({ farmerId, method }) {
    const u = requireRole('owner');
    const f = farmerById(farmerId); if (!f) throw new ApiError('farmer-not-found');
    if (!PAY_METHODS.includes(method)) throw new ApiError('invalid');
    const before = f.payMethod; f.payMethod = method;
    audit('update', 'pay-method', f.id, { method: before }, { method }, u.id); save();
    return method;
  },
  /** The farmer agreed (in writing / in person) that feed, advance and dues may be taken from their payments. */
  async setDeductionConsent({ farmerId, consent }) {
    const u = requireRole('owner');
    const f = farmerById(farmerId); if (!f) throw new ApiError('farmer-not-found');
    const before = clone(f.deductionConsent || null);
    f.deductionConsent = consent ? { at: nowIso(), by: u.id } : null;
    audit('update', 'deduction-consent', f.id, before, f.deductionConsent, u.id); save();
    return clone(f.deductionConsent);
  },
  /** Mark farmers whose payouts must wait for the owner's approval (D-111). */
  async setPayApproval({ farmerIds, on }) {
    const u = requireRole('owner');
    for (const id of farmerIds || []) {
      const f = farmerById(id); if (!f) throw new ApiError('farmer-not-found');
      if (!!f.payApproval === !!on) continue;
      f.payApproval = !!on; audit('update', 'pay-approval', f.id, { on: !on }, { on: !!on }, u.id);
    }
    save();
  },
  /** Owner approves some waiting payouts (PIN): funds checked, then sent from the business account. */
  async approvePayouts({ payoutIds, pin }) {
    const u = requireRole('owner');
    if (!pinOk(u, pin)) { audit('payout-pin-failed', 'payout', null, null, null, u.id); save(); throw new ApiError('bad-pin'); }
    const list = (payoutIds || []).map((id) => db.payouts.find((x) => x.id === id && x.status === 'proposed'));
    if (!list.length || list.some((x) => !x)) throw new ApiError('not-found');
    if (sum(list, 'creditPaise') > availablePaise()) throw new ApiError('insufficient-funds');
    for (const x of list) { Object.assign(x, { status: 'approved', waitApproval: false, decidedBy: u.id, decidedAt: nowIso() }); sendPayout(x, u.id); }
    audit('approve', 'payouts', null, null, { ids: payoutIds }, u.id); save();
    return list.map((x) => clone(x));
  },
  /** Owner rejects a waiting payout with a reason: nothing is sent, the amount stays payable. */
  async rejectPayout({ payoutId, reason }) {
    const u = requireRole('owner');
    const x = db.payouts.find((p) => p.id === payoutId && p.status === 'proposed'); if (!x) throw new ApiError('not-found');
    const why = String(reason || '').trim().slice(0, 200); if (!why) throw new ApiError('reason-required');
    Object.assign(x, { status: 'rejected', waitApproval: false, reason: why, decidedBy: u.id, decidedAt: nowIso() });
    audit('reject', 'payout', x.id, null, { reason: why }, u.id); save();
    return clone(x);
  },
  /** Gateway results that have arrived (webhooks) and the set time — pages call this every few seconds. */
  async payoutPulse() {
    me();
    const a = processWebhooks(); const b = payoutTick();
    if (a || b) save();
    return { changed: a || b, processing: (db.payouts || []).filter((x) => x.status === 'processing').length };
  },
  /** Today's screen: the day's waiting list (if any), what was sent today, and the live pending list. */
  async payoutToday() {
    requireRole('owner');
    if (processWebhooks() | payoutTick()) save();
    const date = todayIST();
    const runs = db.payoutRuns.filter((r) => r.date === date).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const open = runs.find((r) => r.status === 'proposed');
    return { date, now: nowHHMM(), conf: payoutConf(), run: open ? runView(open) : null, sentToday: runs.filter((r) => r.status === 'sent').map(runView),
      preview: payoutPreview(date, open?.id || null), availablePaise: availablePaise(), heldPaise: heldPaise(), waiting: waitingApproval() };
  },
  /** Make (or rebuild) today's list for the owner to approve. */
  async createPayoutRun() {
    const u = requireRole('owner');
    const run = makeRun(todayIST(), payoutConf().mode === 'eod' ? 'eod' : 'approve', u.id); save();
    return runView(run);
  },
  /** Owner approves the list (or some of it) with their PIN: funds are checked, those are sent, the rest skipped. */
  async approvePayoutRun({ runId, payoutIds, pin }) {
    const u = requireRole('owner');
    if (!pinOk(u, pin)) { audit('payout-pin-failed', 'payout-run', runId, null, null, u.id); save(); throw new ApiError('bad-pin'); }
    const run = db.payoutRuns.find((r) => r.id === runId && r.status === 'proposed'); if (!run) throw new ApiError('not-found');
    const pick = new Set(payoutIds || []);
    const chosen = db.payouts.filter((p) => p.runId === run.id && pick.has(p.id));
    if (sum(chosen, 'creditPaise') > availablePaise()) throw new ApiError('insufficient-funds');
    for (const x of db.payouts.filter((p) => p.runId === run.id)) {
      if (!pick.has(x.id)) { x.status = 'skipped'; continue; }
      x.status = 'approved'; sendPayout(x, u.id);
    }
    Object.assign(run, { status: 'sent', sentAt: nowIso(), approvedBy: u.id });
    audit('approve', 'payout-run', run.id, null, { sent: pick.size }, u.id); save();
    return runView(run);
  },
  async cancelPayoutRun(runId) {
    const u = requireRole('owner');
    const run = db.payoutRuns.find((r) => r.id === runId && r.status === 'proposed'); if (!run) throw new ApiError('not-found');
    for (const x of db.payouts.filter((p) => p.runId === run.id)) x.status = 'cancelled';
    Object.assign(run, { status: 'cancelled', cancelledAt: nowIso() });
    audit('cancel', 'payout-run', run.id, null, null, u.id); save();
  },
  /** Try a failed (or bank-reversed) payout again — only if the farmer is still owed at least that much. */
  async retryPayout({ payoutId, pin }) {
    const u = requireRole('owner');
    if (!pinOk(u, pin)) throw new ApiError('bad-pin');
    const x = db.payouts.find((p) => p.id === payoutId && p.kind === 'payout' && ['failed', 'reversed'].includes(p.status)); if (!x) throw new ApiError('not-found');
    const f = farmerById(x.farmerId);
    if (!destOk(f)) throw new ApiError('unverified');
    const owed = sum(owedParts(f, todayIST()), 'paise');
    if (owed < x.amountPaise) throw new ApiError('no-longer-owed');
    const dest = destOf(f); Object.assign(x, { method: dest.method, upiId: dest.to, destLabel: dest.label });
    sendPayout(x, u.id); save();
    return clone(x);
  },
  async payoutRuns({ from, to } = {}) {
    requireRole('owner');
    if (processWebhooks()) save();
    return byCenter(db.payoutRuns).filter((r) => r.status !== 'proposed' && (!from || r.date >= from) && (!to || r.date <= to))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(runView);
  },
  async upiChecks({ from, to } = {}) {
    requireRole('owner');
    return clone(byCenter(db.payouts).filter((x) => x.kind === 'verify' && (!from || x.date >= from) && (!to || x.date <= to))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((x) => ({ ...x, code: farmerById(x.farmerId)?.code, name: farmerById(x.farmerId)?.name })));
  },
  /** Farmer's own page: how and when they are paid, the check, and recent payouts with the breakdown. */
  async myPayouts() {
    const s = farmerSession(); if (!s) throw new ApiError('unauthenticated');
    const f = s.farmer; const conf = payoutConf();
    if (processWebhooks()) save();
    const list = payoutsOf(f.id).filter((x) => ['success', 'processing', 'approved', 'failed', 'reversed'].includes(x.status))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 15)
      .map((x) => ({ id: x.id, date: x.date, creditPaise: x.creditPaise, status: x.status, ref: x.ref || '', method: x.method || 'upi', parts: x.parts, breakdown: x.breakdown || null }));
    const method = methodOf(f);
    return { on: conf.mode !== 'off', mode: conf.mode, canChoose: !!conf.farmerCanChoose, pref: prefOf(f), next: conf.mode === 'off' ? null : nextPayDate(prefOf(f), todayIST()),
      method, upiMasked: maskUpi(f.upiId), bankMasked: f.bankAccount ? 'XXXX' + String(f.bankAccount).slice(-4) : '',
      verified: destOk(f), checkStatus: (method === 'bank' ? f.bankCheck?.status : f.upiCheck?.status) || 'none', lagDays: conf.lagDays, payouts: list,
      pendingPref: db.changeRequests.find((r) => r.entityId === f.id && r.status === 'pending' && r.fields.payPref)?.fields.payPref.after || null };
  },
  async setMyPayPref(pref) {
    const s = farmerSession(); if (!s) throw new ApiError('unauthenticated');
    if (!payoutConf().farmerCanChoose) throw new ApiError('forbidden');
    if (!validPref(pref)) throw new ApiError('invalid-pay-pref');
    const req = makeChangeRequest(s.farmer, { payPref: pref }, ['payPref'], 'farmer:' + s.farmer.id, 'farmer'); save(); // D-108: owner approves
    return clone(req);
  },

  // payments (A6)
  async addPayment({ billId, mode, amountPaise, upiRef, date }) {
    const u = requireRole('owner');
    const b = db.bills.find((x) => x.id === billId);
    if (!b || b.status !== 'final') throw new ApiError('not-final');
    if (!['cash', 'upi'].includes(mode) || !(amountPaise > 0)) throw new ApiError('invalid');
    if (mode === 'upi' && !upiRef) throw new ApiError('upi-ref-required');
    const inPayout = payoutParts(b.farmerId, b.cycleId, PENDING); // D-125: money already on its way by UPI payout is not paid by hand too
    if (amountPaise > b.payablePaise - b.paidPaise - inPayout) throw new ApiError(inPayout ? 'in-payout' : 'overpay');
    const rec = { id: uuid(), centerId: CENTER_ID, billId, farmerId: b.farmerId, mode, amountPaise, upiRef: upiRef || '', date, createdAt: nowIso(), createdBy: u.id };
    db.payments.push(rec); b.paidPaise += amountPaise;
    audit('create', 'payment', rec.id, null, rec); save();
    return clone(rec);
  },
  async payments({ date, from, to } = {}) {
    requireRole('owner');
    return clone(byCenter(db.payments).filter((p) => !p.void && (!date || p.date === date) && (!from || p.date >= from) && (!to || p.date <= to))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  },
  async unpaidBills() {
    requireRole('owner');
    return clone(byCenter(db.bills).filter((b) => b.status === 'final' && b.paidPaise < b.payablePaise)
      .map((b) => ({ ...b, inPayoutPaise: payoutParts(b.farmerId, b.cycleId, PENDING) }))); // D-125
  },

  // dispatch (A7.1)
  async dispatches({ from, to } = {}) {
    me();
    return clone(byCenter(db.dispatches).filter((d) => (!from || d.date >= from) && (!to || d.date <= to))
      .sort((a, b) => entryOrder(b).localeCompare(entryOrder(a))));
  },
  /** Milk sold at the center per shift (daily buyers + walk-ins, D-51/D-53): { 'date|shift|milkType': litresX100 }. */
  async soldByShift({ from, to } = {}) {
    requireRole('owner', 'operator');
    const out = {};
    for (const x of [...byCenter(db.buyerSales), ...liveCounter()]) {
      if ((from && x.date < from) || (to && x.date > to) || !x.litresX100) continue;
      const k = `${x.date}|${x.shift}|${x.milkType}`; out[k] = (out[k] || 0) + x.litresX100;
    }
    return out;
  },
  async addDispatch(input) {
    const u = requirePage(requireRole('owner', 'operator'), '/dispatch');
    if (!(input.litresX100 > 0) || !(input.ratePaise > 0)) throw new ApiError('invalid');
    if (db.dispatches.some((d) => d.date === input.date && d.shift === input.shift && d.milkType === input.milkType)) throw new ApiError('duplicate');
    const rec = { id: uuid(), centerId: CENTER_ID, ...input, createdAt: nowIso(), createdBy: u.id };
    db.dispatches.push(rec); audit('create', 'dispatch', rec.id, null, rec); save();
    return clone(rec);
  },

  // messaging (A8)
  async queueDailySummary(date) {
    requirePage(requireRole('owner', 'operator'), '/messages');
    let n = 0;
    for (const f of byCenter(db.farmers)) {
      const entries = db.collections.filter((c) => !c.void && c.farmerId === f.id && c.date === date)
        .sort((a, b) => entryOrder(a).localeCompare(entryOrder(b)));
      if (!entries.length) continue;
      if (queueMessage({ farmer: f, kind: 'daily', date, texts: dailySummary({ farmer: f, date, entries }) })) n++;
    }
    audit('queue', 'daily-summary', date, null, { count: n }); save();
    return n;
  },
  /**
   * Broadcast notice (D-72), owner and operator. audience: 'all' | 'cow' | 'buffalo' | 'codes' (with codes: [101, 105]).
   * Goes to active farmers who agreed to messages: WhatsApp for those who have it; farmers without WhatsApp get it
   * by SMS only when sms is true (center notices only, never ads; counts against the daily SMS cap).
   * preview: true = only count who would get it.
   */
  async broadcast({ text, audience = 'all', codes = [], sms = false, preview = false }) {
    const u = requirePage(requireRole('owner', 'operator'), '/messages');
    const body = String(text ?? '').trim();
    if (!preview && !body) throw new ApiError('notice-empty');
    if (body.length > 500) throw new ApiError('notice-too-long');
    if (sms && body.length > SMS_NOTICE_MAX) throw new ApiError('notice-sms-too-long');
    const want = new Set(codes.map(Number));
    if (audience === 'codes' && !want.size && !preview) throw new ApiError('notice-no-codes');
    const pool = byCenter(db.farmers).filter((f) => f.active && (audience === 'all' || (audience === 'codes' ? want.has(f.code) : f.milkTypes.includes(audience))));
    const unknown = audience === 'codes' ? [...want].filter((c) => !db.farmers.some((f) => f.code === c && f.active)) : [];
    const wa = pool.filter((f) => chooseChannel(f) === 'whatsapp');
    const sm = pool.filter((f) => chooseChannel(f) === 'sms');
    const counts = { whatsapp: wa.length, sms: sms ? sm.length : 0, skipped: pool.length - wa.length - (sms ? sm.length : 0), unknown };
    if (preview) return { ...counts, smsLeft: smsAllowance(db.smsCounter, todayIST(), db.center.smsCap).remaining };
    if (!counts.whatsapp && !counts.sms) throw new ApiError('notice-no-recipients');
    const rec = { id: 'bc-' + uuid().slice(0, 8), centerId: CENTER_ID, text: body, audience, codes: [...want], sms: !!sms, counts, createdAt: nowIso(), createdBy: u.id };
    db.broadcasts ||= []; db.broadcasts.push(rec);
    const texts = noticeMessage({ text: body }); const today = todayIST();
    for (const f of [...wa, ...(sms ? sm : [])]) queueMessage({ farmer: f, kind: 'notice', date: today, texts, broadcastId: rec.id, noSms: !sms });
    audit('create', 'broadcast', rec.id, null, rec); save();
    return clone(rec);
  },
  async outbox({ farmerId, status, from, to } = {}) {
    me();
    return clone(byCenter(db.outbox).filter((m) => (!farmerId || m.farmerId === farmerId) && (!status || m.status === status)
      && (!from || (m.date || '') >= from) && (!to || (m.date || '') <= to))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  },
  async smsCounter() { me(); const today = todayIST(); return { ...smsAllowance(db.smsCounter, today, db.center.smsCap), cap: db.center.smsCap }; },
  /** Demo worker: the real one runs on the backend. Offline → every attempt fails and is retried later. */
  async runOutbox() {
    requireRole('owner', 'operator');
    const nowMs = Date.now(); const today = todayIST();
    const { send, defer } = selectDue(byCenter(db.outbox), { nowMs, today, smsCounter: db.smsCounter, smsCap: db.center.smsCap });
    const online = typeof navigator === 'undefined' || navigator.onLine;
    let sent = 0; let failed = 0;
    for (const m of send) {
      const i = db.outbox.findIndex((x) => x.id === m.id);
      if (online) {
        db.outbox[i] = { ...m, status: 'sent', sentAt: nowIso(), attempts: (m.attempts || 0) + 1 };
        if (m.channel === 'sms') {
          if (db.smsCounter.date !== today) db.smsCounter = { date: today, sent: 0 };
          db.smsCounter.sent++;
        }
        sent++;
      } else { db.outbox[i] = afterFailure(m, { nowMs, error: 'offline' }); failed++; }
    }
    for (const m of defer) { const i = db.outbox.findIndex((x) => x.id === m.id); db.outbox[i] = deferToNextDay(m, today); }
    save();
    return { sent, failed, deferred: defer.length };
  },
  async retryMessage(id) {
    requireRole('owner');
    const m = db.outbox.find((x) => x.id === id); if (!m) throw new ApiError('not-found');
    Object.assign(m, { status: 'queued', attempts: 0, nextAttemptAt: 0 }); save();
  },

  // daily milk buyers (D-51): owner manages buyers & rates, operator records daily litres, owner settles monthly
  async buyers({ includeInactive = false } = {}) {
    requireRole('owner', 'operator');
    return clone(byCenter(db.buyers).filter((b) => includeInactive || b.active).sort((a, b) => a.code - b.code)
      .map((b) => ({ ...b, balancePaise: buyerBalance(b.id), bill: buyerBill(b) })));
  },
  async saveBuyer(input) {
    requireRole('owner');
    const name = String(input.name || '').trim();
    if (!name) throw new ApiError('name-required');
    if (input.mobile && !/^[6-9]\d{9}$/.test(input.mobile)) throw new ApiError('invalid-mobile');
    if (!['cow', 'buffalo'].includes(input.milkType)) throw new ApiError('invalid');
    if (!(Number.isInteger(input.ratePaise) && input.ratePaise > 0)) throw new ApiError('invalid-rate');
    for (const k of ['morningX100', 'eveningX100']) if (!(Number.isInteger(input[k]) && input[k] >= 0)) throw new ApiError('invalid');
    // D-87: from when we give milk, and when they pay
    const startDate = input.startDate || todayIST();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new ApiError('invalid-date');
    const billing = input.billing?.kind === 'day' ? { kind: 'day', day: Number(input.billing.day) } : { kind: 'month-end' };
    if (billing.kind === 'day' && !(Number.isInteger(billing.day) && billing.day >= 1 && billing.day <= 28)) throw new ApiError('invalid-bill-day');
    const ex = input.id ? db.buyers.find((b) => b.id === input.id) : null;
    if (ex && db.buyerSales.some((s) => s.buyerId === ex.id && s.date < startDate && s.litresX100 > 0)) throw new ApiError('start-after-sales');
    const before = ex ? clone(ex) : null;
    const rec = ex || { id: 'g' + uuid().slice(0, 8), centerId: CENTER_ID, code: Math.max(0, ...db.buyers.map((b) => b.code)) + 1, createdAt: nowIso() };
    Object.assign(rec, { name, area: String(input.area || '').trim(), mobile: input.mobile || '', milkType: input.milkType, ratePaise: input.ratePaise,
      morningX100: input.morningX100, eveningX100: input.eveningX100, active: input.active !== false, note: String(input.note ?? rec.note ?? '').trim(), startDate, billing });
    if (!ex) db.buyers.push(rec);
    audit(ex ? 'update' : 'create', 'buyer', rec.id, before, clone(rec)); save();
    return clone(rec);
  },
  /** The day's sheet for one shift: every active buyer (and anyone with an entry) with the saved litres or their usual quantity. */
  async buyerDay({ date, shift }) {
    requireRole('owner', 'operator');
    const sales = byCenter(db.buyerSales).filter((s) => s.date === date && s.shift === shift);
    const list = byCenter(db.buyers).filter((b) => (b.active && (!b.startDate || b.startDate <= date)) || sales.some((s) => s.buyerId === b.id)).sort((a, b) => a.code - b.code);
    return { date, shift, locked: buyerMonthLocked(date), saved: sales.length > 0,
      rows: list.map((b) => { const s = sales.find((x) => x.buyerId === b.id) || null;
        return { buyer: clone(b), sale: clone(s), usualX100: shift === 'morning' ? b.morningX100 : b.eveningX100 }; }) };
  },
  /** Save the day's sheet. rows: [{ buyerId, litresX100 }]. New entries take the buyer's current rate; edits keep the original rate. */
  async saveBuyerDay({ date, shift, rows }) {
    const u = requirePage(requireRole('owner', 'operator'), '/buyers');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date > todayIST()) throw new ApiError('invalid-date');
    if (!['morning', 'evening'].includes(shift)) throw new ApiError('invalid');
    if (buyerMonthLocked(date)) throw new ApiError('month-locked');
    let changed = 0;
    for (const r of rows || []) {
      const b = db.buyers.find((x) => x.id === r.buyerId); if (!b) throw new ApiError('not-found');
      if (!(Number.isInteger(r.litresX100) && r.litresX100 >= 0 && r.litresX100 <= 50000)) throw new ApiError('invalid-litres');
      if (r.litresX100 > 0 && b.startDate && date < b.startDate) throw new ApiError('before-start'); // D-87
      const s = db.buyerSales.find((x) => x.buyerId === b.id && x.date === date && x.shift === shift);
      if (s) {
        if (s.litresX100 === r.litresX100) continue;
        const before = clone(s);
        Object.assign(s, { litresX100: r.litresX100, amountPaise: amountFor(r.litresX100, s.ratePaise), updatedAt: nowIso(), updatedBy: u.id });
        audit('update', 'buyer-sale', s.id, before, clone(s)); changed++;
      } else if (r.litresX100 > 0) {
        const rec = { id: uuid(), centerId: CENTER_ID, buyerId: b.id, date, shift, milkType: b.milkType, litresX100: r.litresX100,
          ratePaise: b.ratePaise, amountPaise: amountFor(r.litresX100, b.ratePaise), createdAt: nowIso(), createdBy: u.id };
        db.buyerSales.push(rec); audit('create', 'buyer-sale', rec.id, null, clone(rec)); changed++;
      }
    }
    save();
    return { changed };
  },
  /** Month account for every buyer: opening balance, litres, amount, payments, closing balance. month = 'YYYY-MM'. */
  async buyerMonth(month) {
    requireRole('owner');
    const first = month + '-01'; const last = lastDayOfMonth(first);
    const rows = byCenter(db.buyers).map((b) => {
      const sales = db.buyerSales.filter((s) => s.buyerId === b.id);
      const pays = db.buyerPayments.filter((p) => p.buyerId === b.id);
      const inM = sales.filter((s) => s.date >= first && s.date <= last && s.litresX100 > 0);
      const opening = sum(sales.filter((s) => s.date < first), 'amountPaise') - sum(pays.filter((p) => p.date < first), 'amountPaise');
      const amount = sum(inM, 'amountPaise'); const paid = sum(pays.filter((p) => p.date >= first && p.date <= last), 'amountPaise');
      return { buyer: clone(b), bill: buyerBill(b), litresX100: sum(inM, 'litresX100'), days: new Set(inM.map((s) => s.date)).size, amountPaise: amount,
        openingPaise: opening, paidPaise: paid, closingPaise: opening + amount - paid };
    }).filter((r) => r.buyer.active || r.amountPaise || r.paidPaise || r.openingPaise).sort((a, b) => a.buyer.code - b.buyer.code);
    const tot = (k) => rows.reduce((s, r) => s + r[k], 0);
    const cs = liveCounter().filter((x) => x.date >= first && x.date <= last);
    const counter = { litresX100: sum(cs, 'litresX100'), amountPaise: sum(cs, 'amountPaise'), count: cs.length,
      cashPaise: sum(cs.filter((x) => x.mode === 'cash'), 'amountPaise'), upiPaise: sum(cs.filter((x) => x.mode === 'upi'), 'amountPaise') };
    return { month, first, last, closed: !!db.buyerMonths.find((m) => m.month === month), canClose: last < todayIST(),
      counter, rows, totals: { litresX100: tot('litresX100'), amountPaise: tot('amountPaise'), openingPaise: tot('openingPaise'), paidPaise: tot('paidPaise'), closingPaise: tot('closingPaise')  },
      due: { paise: rows.reduce((x, r) => x + r.bill.duePaise, 0), overdue: rows.filter((r) => r.bill.overdue).length } };
  },
  /** One buyer's month statement: each day (morning / evening litres, amount), payments, opening and closing balance. */
  async buyerStatement({ buyerId, month, from, to }) {
    requireRole('owner');
    const b = db.buyers.find((x) => x.id === buyerId); if (!b) throw new ApiError('not-found');
    // D-87: a calendar month, or any period (from / to) — e.g. the buyer's own bill period
    const first = from || month + '-01'; const last = to || lastDayOfMonth(first);
    const inP = db.buyerSales.filter((s) => s.buyerId === buyerId && s.date >= first && s.date <= last && s.litresX100 > 0);
    const m = { openingPaise: buyerBalanceBefore(buyerId, first), litresX100: sum(inP, 'litresX100'), amountPaise: sum(inP, 'amountPaise'),
      paidPaise: sum(db.buyerPayments.filter((p) => p.buyerId === buyerId && p.date >= first && p.date <= last), 'amountPaise') };
    const sales = db.buyerSales.filter((s) => s.buyerId === buyerId && s.date >= first && s.date <= last);
    const days = [];
    for (let d = first; d <= last && d <= todayIST(); d = addDays(d, 1)) {
      const ds = sales.filter((s) => s.date === d); if (!ds.length) continue;
      const mo = ds.find((s) => s.shift === 'morning'); const ev = ds.find((s) => s.shift === 'evening');
      days.push({ date: d, morningX100: mo?.litresX100 || 0, eveningX100: ev?.litresX100 || 0, amountPaise: sum(ds, 'amountPaise') });
    }
    const payments = clone(db.buyerPayments.filter((p) => p.buyerId === buyerId && p.date >= first && p.date <= last).sort((x, y) => (x.date < y.date ? -1 : 1)));
    return { buyer: clone(b), bill: buyerBill(b), month, first, last, closed: !!db.buyerMonths.find((x) => x.month === (month || first.slice(0, 7))), days, payments,
      openingPaise: m.openingPaise, litresX100: m.litresX100, amountPaise: m.amountPaise, paidPaise: m.paidPaise, closingPaise: m.openingPaise + m.amountPaise - m.paidPaise };
  },
  async addBuyerPayment({ buyerId, date, mode, amountPaise, upiRef, note }) {
    const u = requireRole('owner');
    if (!db.buyers.find((b) => b.id === buyerId)) throw new ApiError('not-found');
    if (!['cash', 'upi'].includes(mode) || !(Number.isInteger(amountPaise) && amountPaise > 0)) throw new ApiError('invalid');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date > todayIST()) throw new ApiError('invalid-date');
    if (mode === 'upi' && !upiRef) throw new ApiError('upi-ref-required');
    const rec = { id: uuid(), centerId: CENTER_ID, buyerId, date, mode, amountPaise, upiRef: mode === 'upi' ? upiRef : '', note: note || '', createdAt: nowIso(), createdBy: u.id };
    db.buyerPayments.push(rec); audit('create', 'buyer-payment', rec.id, null, clone(rec)); save();
    return clone(rec);
  },
  /** Close (lock) a finished month: no more changes to its daily entries. */
  async closeBuyerMonth(month) {
    const u = requireRole('owner');
    if (lastDayOfMonth(month + '-01') >= todayIST()) throw new ApiError('month-not-over');
    if (db.buyerMonths.find((m) => m.month === month)) return;
    db.buyerMonths.push({ id: month, centerId: CENTER_ID, month, closedAt: nowIso(), closedBy: u.id });
    audit('close', 'buyer-month', month, null, null); save();
  },

  // walk-in (सुटी) milk sale (D-53): unknown / occasional people, ¼ · ½ · 1 L, paid on the spot (no account)
  /** One day's walk-in sales (newest first), the current rates and the day's totals. */
  async counterSales({ date }) {
    requireRole('owner', 'operator');
    const rows = byCenter(db.counterSales).filter((s) => s.date === date).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const live = rows.filter((s) => !s.void);
    const tot = (f) => { const x = live.filter(f); return { litresX100: sum(x, 'litresX100'), amountPaise: sum(x, 'amountPaise'), count: x.length }; };
    return { date, locked: buyerMonthLocked(date), rates: { cow: counterRate('cow'), buffalo: counterRate('buffalo') }, rows: clone(rows),
      totals: { ...tot(() => true), cashPaise: tot((s) => s.mode === 'cash').amountPaise, upiPaise: tot((s) => s.mode === 'upi').amountPaise,
        cowX100: tot((s) => s.milkType === 'cow').litresX100, buffaloX100: tot((s) => s.milkType === 'buffalo').litresX100 } };
  },
  /** Record one walk-in sale at the current counter rate. id = client UUID (a retry with the same id is ignored). */
  async addCounterSale({ id, date, shift, milkType, litresX100, mode, upiRef = '', name = '' }) {
    const u = requirePage(requireRole('owner', 'operator'), '/buyers');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date > todayIST()) throw new ApiError('invalid-date');
    if (!['morning', 'evening'].includes(shift) || !['cow', 'buffalo'].includes(milkType) || !['cash', 'upi'].includes(mode)) throw new ApiError('invalid');
    if (!(Number.isInteger(litresX100) && litresX100 > 0 && litresX100 <= 5000)) throw new ApiError('invalid-litres');
    if (buyerMonthLocked(date)) throw new ApiError('month-locked');
    const dup = id && db.counterSales.find((s) => s.id === id); if (dup) return clone(dup);
    const ratePaise = counterRate(milkType);
    const rec = { id: id || uuid(), centerId: CENTER_ID, date, shift, milkType, litresX100, ratePaise, amountPaise: amountFor(litresX100, ratePaise),
      mode, upiRef: mode === 'upi' ? String(upiRef).trim() : '', name: String(name).trim(), void: false, voidReason: '', createdAt: nowIso(), createdBy: u.id };
    db.counterSales.push(rec); audit('create', 'counter-sale', rec.id, null, clone(rec)); save();
    return clone(rec);
  },
  /** Cancel a wrong walk-in entry. Never deleted: marked void with a reason (audit-logged). */
  async voidCounterSale({ id, reason }) {
    requireRole('owner', 'operator');
    const s = db.counterSales.find((x) => x.id === id); if (!s) throw new ApiError('not-found');
    if (!String(reason || '').trim()) throw new ApiError('reason-required');
    if (buyerMonthLocked(s.date)) throw new ApiError('month-locked');
    if (s.void) return clone(s);
    const before = clone(s); Object.assign(s, { void: true, voidReason: String(reason).trim() });
    audit('void', 'counter-sale', s.id, before, clone(s)); save();
    return clone(s);
  },
  /** Owner: walk-in price per litre (new entries only; past entries keep their rate). */
  async saveCounterRates({ cowPaise, buffaloPaise }) {
    requireRole('owner');
    if (![cowPaise, buffaloPaise].every((v) => Number.isInteger(v) && v > 0)) throw new ApiError('invalid-rate');
    const before = { cow: db.center.counterRateCowPaise, buffalo: db.center.counterRateBuffaloPaise };
    Object.assign(db.center, { counterRateCowPaise: cowPaise, counterRateBuffaloPaise: buffaloPaise });
    audit('update', 'counter-rates', CENTER_ID, before, { cow: cowPaise, buffalo: buffaloPaise }); save();
  },

  // dashboard (A7)
  /**
   * Owner dashboard for an inclusive IST date range (default: today).
   * Period figures: litres/amount, shift × milk type, daily trend, shrinkage & margin, top/low suppliers.
   * Balances (unpaid bills, advances, unbilled feed) are always "as of now", whatever the range.
   */
  async dashboard({ from, to } = {}) {
    requireRole('owner');
    const today = todayIST();
    to = to && to <= today ? to : today;
    from = from && from <= to ? from : to;
    const cyc = currentCycle(today);
    const live = byCenter(db.collections).filter((c) => !c.void);
    const inRange = live.filter((c) => c.date >= from && c.date <= to);
    const byShiftType = {};
    for (const s of ['morning', 'evening']) for (const m of ['cow', 'buffalo']) {
      const rows = inRange.filter((c) => c.shift === s && c.milkType === m);
      byShiftType[`${s}.${m}`] = { litresX100: sum(rows, 'litresX100'), amountPaise: sum(rows, 'amountPaise'), count: rows.length };
    }
    // Trend: one point per day of the range; a short range still shows at least the last 7 days for context.
    const trendFrom = from <= addDays(to, -6) ? from : addDays(to, -6);
    const trend = [];
    for (let d = trendFrom; d <= to; d = addDays(d, 1)) {
      const rows = live.filter((c) => c.date === d);
      const l = sum(rows, 'litresX100');
      const disp = byCenter(db.dispatches).filter((x) => x.date === d);
      trend.push({ date: d, litresX100: l, amountPaise: sum(rows, 'amountPaise'),
        cowX100: sum(rows.filter((c) => c.milkType === 'cow'), 'litresX100'), buffaloX100: sum(rows.filter((c) => c.milkType === 'buffalo'), 'litresX100'),
        avgFatX100: l ? Math.round(rows.reduce((s, c) => s + c.fatX10 * c.litresX100, 0) * 10 / l) : 0,
        avgSnfX100: l ? Math.round(rows.reduce((s, c) => s + c.snfX10 * c.litresX100, 0) * 10 / l) : 0,
        dispatchedX100: sum(disp, 'litresX100'), receivedPaise: sum(disp, 'amountPaise'), inRange: d >= from });
    }
    // Shrinkage & margin: only shifts in the range that have a dispatch entry.
    const dispRange = byCenter(db.dispatches).filter((d) => d.date >= from && d.date <= to);
    const keys = new Set(dispRange.map((d) => `${d.date}|${d.shift}|${d.milkType}`));
    const collMatched = inRange.filter((c) => keys.has(`${c.date}|${c.shift}|${c.milkType}`));
    // milk sold to daily buyers in those same shifts also left the center (D-51)
    const buyerRange = byCenter(db.buyerSales).filter((s) => s.date >= from && s.date <= to && s.litresX100 > 0);
    const buyerMatched = buyerRange.filter((s) => keys.has(`${s.date}|${s.shift}|${s.milkType}`));
    // and walk-in (सुटी) sales (D-53)
    const counterRange = liveCounter().filter((s) => s.date >= from && s.date <= to);
    const counterMatched = counterRange.filter((s) => keys.has(`${s.date}|${s.shift}|${s.milkType}`));
    // Per farmer: litres, milk days, profit (dairy rate for the same date/shift/milk type − amount paid;
    // dispatched shifts only) and what the farmer owes us now (advance outstanding + feed not yet billed).
    const dispByKey = new Map(dispRange.map((d) => [`${d.date}|${d.shift}|${d.milkType}`, d]));
    const perFarmer = new Map(); // farmerId → { l, days:Set, profit }
    let chartRev = 0, chartCost = 0, chartL = 0; // whole range, by the dairy chart (D-80)
    for (const c of inRange) {
      const x = perFarmer.get(c.farmerId) || { l: 0, days: new Set(), profit: 0, amt: 0, fat: 0, snf: 0, cow: 0, buf: 0, am: 0, pm: 0, last: '' };
      x.l += c.litresX100; x.days.add(c.date);
      // extra figures for the dashboard side panel (D-60)
      x.amt += c.amountPaise; x.fat += c.fatX10 * c.litresX100; x.snf += c.snfX10 * c.litresX100;
      if (c.milkType === 'cow') x.cow += c.litresX100; else x.buf += c.litresX100;
      if (c.shift === 'morning') x.am += c.litresX100; else x.pm += c.litresX100;
      if (c.date > x.last) x.last = c.date;
      const pr = entryProfit(c, dispByKey); // D-80: dairy chart value − farmer amount
      if (pr) { x.profit += pr.revenuePaise - pr.costPaise; chartRev += pr.revenuePaise; chartCost += pr.costPaise; chartL += c.litresX100; }
      perFarmer.set(c.farmerId, x);
    }
    const ranked = [...perFarmer.entries()].map(([id, x]) => {
      const bal = balances(id);
      return { farmer: clone(farmerById(id)), litresX100: x.l, days: x.days.size, avgPerDayX100: Math.round(x.l / x.days.size),
        profitPaise: x.profit, advancePaise: bal.advanceOutstandingPaise, feedPaise: bal.feedUnbilledPaise,
        receivablePaise: bal.advanceOutstandingPaise + bal.feedUnbilledPaise,
        amountPaise: x.amt, avgFatX100: x.l ? Math.round(x.fat * 10 / x.l) : 0, avgSnfX100: x.l ? Math.round(x.snf * 10 / x.l) : 0,
        cowX100: x.cow, buffaloX100: x.buf, morningX100: x.am, eveningX100: x.pm, lastDate: x.last,
        previousDuesPaise: bal.duesPaise, unpaidBillsPaise: bal.unpaidPaise };
    }).sort((a, b) => b.litresX100 - a.litresX100);
    const unpaid = byCenter(db.bills).filter((b) => b.status === 'final').reduce((s, b) => s + Math.max(0, b.payablePaise - b.paidPaise), 0);
    const advOut = byCenter(db.farmers).reduce((s, f) => s + advanceState(f.id).outstandingPaise, 0);
    const feedOut = byCenter(db.farmers).reduce((s, f) => s + balances(f.id).feedUnbilledPaise, 0);
    const lr = sum(inRange, 'litresX100');
    const activeDays = new Set(inRange.map((c) => c.date)).size;
    return {
      today, from, to, cycle: cyc, byShiftType, trend,
      litresX100: lr, amountPaise: sum(inRange, 'amountPaise'), farmers: new Set(inRange.map((r) => r.farmerId)).size,
      entries: inRange.length, avgPerDayX100: activeDays ? Math.round(lr / activeDays) : 0,
      avgFatX100: lr ? Math.round(inRange.reduce((s, c) => s + c.fatX10 * c.litresX100, 0) * 10 / lr) : 0,
      avgSnfX100: lr ? Math.round(inRange.reduce((s, c) => s + c.snfX10 * c.litresX100, 0) * 10 / lr) : 0,
      collectedX100: sum(collMatched, 'litresX100'), dispatchedX100: sum(dispRange, 'litresX100'),
      buyerSoldX100: sum(buyerMatched, 'litresX100'), buyerSalePaise: sum(buyerMatched, 'amountPaise'),
      buyerRangeX100: sum(buyerRange, 'litresX100'), buyerRangePaise: sum(buyerRange, 'amountPaise'),
      counterSoldX100: sum(counterMatched, 'litresX100'), counterRangeX100: sum(counterRange, 'litresX100'), counterRangePaise: sum(counterRange, 'amountPaise'),
      purchasePaise: sum(collMatched, 'amountPaise'), salePaise: sum(dispRange, 'amountPaise') + sum(buyerMatched, 'amountPaise') + sum(counterMatched, 'amountPaise'),
      top: ranked.slice(0, 5), low: ranked.length > 5 ? ranked.slice(-5).reverse() : [],
      unpaidPaise: unpaid, advanceOutstandingPaise: advOut, feedUnbilledPaise: feedOut,
      pendingCorrections: db.corrections.filter((c) => c.status === 'pending').length,
      pendingChanges: byCenter(db.changeRequests).filter((r) => r.status === 'pending').length, // D-108
      // D-126: expenses for the range (monthly ones spread per day), costs the app counts itself, and what waits
      expenses: expenseTotals(byCenter(db.expenses), from, to), autoCosts: autoCostsFor(from, to),
      pendingExpenseChanges: byCenter(db.expenses).filter((e) => !e.void && e.pending).length,
      monthlyDueCount: monthlyDue(byCenter(db.expenses), todayIST()).length,
      unpaidBillsCount: byCenter(db.bills).filter((b) => b.status === 'final' && b.paidPaise < b.payablePaise).length,
      profitByChart: { revenuePaise: chartRev, costPaise: chartCost, profitPaise: chartRev - chartCost, coveredX100: chartL, hasDairyChart: dairyCharts().length > 0 },
      // D-85: figures for the optional dashboard sections
      dispatchPaise: sum(dispRange, 'amountPaise'), dispatchRangeX100: sum(dispRange, 'litresX100'),
      counterSalePaise: sum(counterMatched, 'amountPaise'), // D-117: walk-in sales of the shifts that have a dispatch
      pendingDispatchX100: sum(inRange.filter((c) => !keys.has(`${c.date}|${c.shift}|${c.milkType}`)), 'litresX100'), // collected, dispatch not entered yet
      payouts: payoutSummary(from, to), // D-113: paid / owed / waiting for approval / failed
      payments: (() => { const ps = byCenter(db.payments).filter((p) => p.date >= from && p.date <= to);
        return { cashPaise: sum(ps.filter((p) => p.mode === 'cash'), 'amountPaise'), upiPaise: sum(ps.filter((p) => p.mode === 'upi'), 'amountPaise'), count: ps.length }; })(),
      ledger: (() => { const adv = byCenter(db.advances).filter((a) => a.date >= from && a.date <= to);
        const sales = byCenter(db.feedMoves).filter((m) => m.type === 'sale' && m.date >= from && m.date <= to);
        return { advancePaise: sum(adv, 'amountPaise'), advances: adv.length, feedPaise: sum(sales, 'amountPaise'), feedSales: sales.length,
          stock: byCenter(db.feedItems).filter((i) => i.active).map((i) => ({ name: i.name, unit: i.unit, stock: stockOf(i.id) })) }; })(),
      messages: (() => { const ms = byCenter(db.outbox).filter((m) => { const day = toIstDate(m.createdAt); return day >= from && day <= to; });
        const n = (s) => ms.filter((m) => m.status === s).length;
        return { sent: n('sent') + n('delivered'), queued: n('queued') + n('deferred'), failed: n('failed'), sms: ms.filter((m) => m.channel === 'sms').length }; })(),
    };
  },

  // government schemes (D-71): the owner manages them; published ones show on the public website until their last date
  /** Website: published, not past their last date. all: true = every scheme (owner page). */
  async schemes({ all = false } = {}) {
    if (all) requireRole('owner');
    const today = todayIST();
    const list = byCenter(db.schemes || []).filter((s) => all || (s.published && (!s.lastDate || s.lastDate >= today)));
    return clone(list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  },
  async saveScheme(input) {
    requireRole('owner');
    const str = (v, max) => String(v ?? '').trim().slice(0, max);
    const rec = { title: str(input.title, 120), summary: str(input.summary, 800), benefit: str(input.benefit, 800), eligibility: str(input.eligibility, 1000),
      documents: str(input.documents, 800), howTo: str(input.howTo, 1000), lastDate: str(input.lastDate, 10), link: str(input.link, 300), published: !!input.published };
    if (!rec.title) throw new ApiError('scheme-title-required');
    if (!rec.summary) throw new ApiError('scheme-summary-required');
    if (rec.link && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(rec.link)) throw new ApiError('invalid-link');
    if (rec.lastDate && !/^\d{4}-\d{2}-\d{2}$/.test(rec.lastDate)) throw new ApiError('invalid');
    db.schemes ||= [];
    const ex = input.id ? db.schemes.find((s) => s.id === input.id) : null;
    if (input.id && !ex) throw new ApiError('not-found');
    const before = clone(ex);
    const out = ex ? Object.assign(ex, rec, { updatedAt: nowIso() }) : { id: 'sch-' + uuid().slice(0, 8), centerId: CENTER_ID, ...rec, createdAt: nowIso(), updatedAt: nowIso() };
    if (!ex) db.schemes.push(out);
    audit(ex ? 'update' : 'create', 'scheme', out.id, before, out); save();
    return clone(out);
  },
  async deleteScheme(id) {
    requireRole('owner');
    const i = (db.schemes || []).findIndex((s) => s.id === id);
    if (i < 0) throw new ApiError('not-found');
    const [gone] = db.schemes.splice(i, 1);
    audit('delete', 'scheme', id, gone, null); save();
  },

  // veterinary doctors (D-83): the owner manages them; shown (published ones) on the farmers' page and the website
  async doctors({ all = false } = {}) {
    if (all) requireRole('owner'); else if (!farmerSession()) me(); // D-88: farmers' page (and staff) only, not the public website
    const list = byCenter(db.doctors || []).filter((x) => all || x.published);
    return clone(list.sort((a, b) => (a.sort || 0) - (b.sort || 0) || (a.createdAt < b.createdAt ? -1 : 1)));
  },
  async saveDoctor(input) {
    requireRole('owner');
    const str = (v, max) => String(v ?? '').trim().slice(0, max);
    const rec = { name: str(input.name, 80), qualification: str(input.qualification, 80), kind: input.kind === 'private' ? 'private' : 'govt',
      mobile: str(input.mobile, 10), place: str(input.place, 120), areas: str(input.areas, 160), timings: str(input.timings, 120),
      services: str(input.services, 200), emergency: !!input.emergency, published: !!input.published };
    if (!rec.name) throw new ApiError('doctor-name-required');
    if (rec.mobile && !/^[6-9]\d{9}$/.test(rec.mobile)) throw new ApiError('invalid-mobile');
    db.doctors ||= [];
    const ex = input.id ? db.doctors.find((x) => x.id === input.id) : null;
    if (input.id && !ex) throw new ApiError('not-found');
    const before = clone(ex);
    const out = ex ? Object.assign(ex, rec, { updatedAt: nowIso() })
      : { id: 'doc-' + uuid().slice(0, 8), centerId: CENTER_ID, ...rec, sort: Math.max(0, ...db.doctors.map((x) => x.sort || 0)) + 1, createdAt: nowIso(), updatedAt: nowIso() };
    if (!ex) db.doctors.push(out);
    audit(ex ? 'update' : 'create', 'doctor', out.id, before, out); save();
    return clone(out);
  },
  async deleteDoctor(id) {
    requireRole('owner');
    const i = (db.doctors || []).findIndex((x) => x.id === id);
    if (i < 0) throw new ApiError('not-found');
    const [gone] = db.doctors.splice(i, 1);
    audit('delete', 'doctor', id, gone, null); save();
  },

  // audit & demo
  /** Audit log, newest first. Filters: userId (who did it, or whose login it was), actions (list), limit. */
  async audit({ userId, actions, limit = 300 } = {}) {
    requireRole('owner');
    const rows = byCenter(db.audit).filter((a) => (!userId || a.userId === userId || (a.entity === 'user' && a.entityId === userId))
      && (!actions?.length || actions.includes(a.action)));
    return clone(rows.slice(-limit).reverse());
  },
  async resetDemo() {
    db = migrate(buildSeed()); firstRun = true; await bootstrapDemo(); save();
  },
  async exportBackup() { requireRole('owner'); return JSON.stringify(db, null, 1); },
};

function billView(b) {
  const farmer = farmerById(b.farmerId);
  const entries = b.entryIds.map((id) => db.collections.find((c) => c.id === id)).filter(Boolean);
  const pays = db.payments.filter((p) => p.billId === b.id);
  const adv = advanceState(b.farmerId);
  return clone({ ...b, farmer, entries, payments: pays, center: db.center,
    after: { advanceOutstandingPaise: b.advanceRemainingPaise, feedDuePaise: 0, advanceNowPaise: adv.outstandingPaise } });
}

const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
const toIstDate = (iso) => todayIST(new Date(iso));

function checkChartInput({ milkType, effectiveFrom, effectiveTo, fats, snfs }) {
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!['cow', 'buffalo'].includes(milkType) || !isDate(effectiveFrom) || !fats?.length || !snfs?.length) throw new ApiError('invalid');
  if (effectiveTo && (!isDate(effectiveTo) || effectiveTo < effectiveFrom)) throw new ApiError('invalid');
  if (isLocked(effectiveFrom)) throw new ApiError('cycle-locked');
}

/**
 * Re-price recorded entries of `milkType` dated from..(to or today), using the charts now in force.
 * Entries in finalized cycles are never touched. Draft bills overlapping the change are flagged stale.
 * apply=false only reports. Returns { count, changed, skipped, beforePaise, afterPaise }.
 */
function repriceEntries(milkType, from, to, apply) {
  const today = todayIST();
  const last = to && to < today ? to : today;
  const out = { count: 0, changed: 0, skipped: 0, beforePaise: 0, afterPaise: 0 };
  if (from > last) return out;
  const charts = farmerCharts();
  for (const e of byCenter(db.collections)) {
    if (e.void || e.milkType !== milkType || e.date < from || e.date > last || isLocked(e.date)) continue;
    out.count++; out.beforePaise += e.amountPaise;
    const p = priceEntry(e, charts, db.center.rateRule);
    if (!p.ok) { out.skipped++; out.afterPaise += e.amountPaise; continue; } // Fat/SNF outside the new chart: keep old price
    out.afterPaise += p.amountPaise;
    if (p.ratePaise === e.ratePaise && p.chartId === e.chartId) continue;
    out.changed++;
    if (apply) {
      const before = { ratePaise: e.ratePaise, amountPaise: e.amountPaise, chartId: e.chartId };
      Object.assign(e, { ratePaise: p.ratePaise, amountPaise: p.amountPaise, chartId: p.chartId, repricedAt: nowIso() });
      audit('reprice', 'collection', e.id, before, { ratePaise: e.ratePaise, amountPaise: e.amountPaise, chartId: e.chartId });
    }
  }
  if (apply && out.changed) {
    for (const c of db.cycles) if (c.status === 'generated' && c.start <= last && c.end >= from) c.stale = true;
  }
  return out;
}
/** Base URL for public bill links: the configured domain (Cloudflare Tunnel), else the address the app is opened from. */
const publicBase = () => (db.center.publicBaseUrl || (typeof location === 'undefined' ? '' : location.origin + location.pathname)).replace(/\/+$/, '');
/** Sort key: date, then morning before evening, then cow before buffalo. */
const entryOrder = (e) => `${e.date}|${e.shift === 'morning' ? 0 : 1}|${e.milkType === 'cow' ? 0 : 1}`;

/** First run: bill and finalize EVERY past period in order (so advances and dues carry forward like real use),
 *  pay them — the latest period mixed (3 of 4 paid), older ones all paid — so every screen has history. */
async function bootstrapDemo() {
  if (!firstRun) return;
  firstRun = false;
  const keep = sessionUserId;
  sessionUserId = 'u-owner';
  try {
    const prev = previousCycle(currentCycle(), ...cycleConf());
    const first = db.collections.reduce((m, c) => (c.date < m ? c.date : m), prev.start);
    const periods = [];
    for (let c = cycleFor(first, ...cycleConf()); c.start <= prev.start; c = cycleFor(addDays(c.end, 1), ...cycleConf())) periods.push(c);
    let n = 0;
    for (const per of periods) {
      const latest = per.start === prev.start;
      await api.generateBills(per);
      await api.finalizeCycle(cycleKey(per));
      db.bills.filter((b) => b.cycleId === cycleKey(per)).forEach((b, i) => {
        if (b.payablePaise === 0 || (latest && i % 4 === 3)) return;
        const mode = farmerById(b.farmerId).upiId && i % 5 !== 2 ? 'upi' : 'cash'; // mostly UPI, some cash
        n++;
        db.payments.push({ id: uuid(), centerId: CENTER_ID, billId: b.id, farmerId: b.farmerId, mode, amountPaise: b.payablePaise,
          upiRef: mode === 'upi' ? 'UTR' + String(400000000 + n * 7919) : '', date: addDays(per.end, 1 + (i % 2)), createdAt: nowIso(), createdBy: 'u-owner' });
        b.paidPaise = b.payablePaise;
      });
    }
    await api.runOutbox();
    backfillMessages();
    db.audit = db.seedAudit || []; delete db.seedAudit;
  } finally { sessionUserId = keep; }
  save();
}

// ---------- shared test mode (D-67) ----------
// With the dev server (npm run dev), every phone, tablet and PC browser works on ONE copy of the data kept by the
// server, so an entry made on the operator's phone shows on the owner's dashboard. Before each API call the newest
// copy is fetched (only if it changed); after a call that changed something the whole copy is sent back. If another
// device saved in between, the server refuses (409), the newer copy is loaded and the call is run again on it.
// Without the dev server (tests, the real backend later) this does nothing and the data stays in this browser.
const SHARED_URL = '/__dev/db';
let sharedOn = false, sharedVersion = 0, unsent = false;
const inBrowser = typeof window !== 'undefined' && typeof location !== 'undefined' && /^https?:$/.test(location.protocol);

async function pullShared() {
  const r = await fetch(`${SHARED_URL}?since=${sharedVersion}`, { cache: 'no-store' });
  if (r.status === 204) return;
  if (!r.ok) throw new Error('shared ' + r.status);
  const j = await r.json();
  if (j.db) { db = migrate(j.db); sharedVersion = j.version; try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* ignore */ } }
}
/** true = saved; false = someone else saved first (newer copy now loaded). Network errors throw. */
async function pushShared() {
  const r = await fetch(`${SHARED_URL}?base=${sharedVersion}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(db) });
  if (r.status === 409) { const j = await r.json(); db = migrate(j.db); sharedVersion = j.version; return false; }
  if (!r.ok) throw new Error('shared ' + r.status);
  sharedVersion = (await r.json()).version; unsent = false; return true;
}
async function startShared() {
  if (!inBrowser) return;
  try {
    const r = await fetch(`${SHARED_URL}?since=-1`, { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    if (!r.ok) return; // not the dev server
    const j = await r.json();
    sharedOn = true;
    if (j.db) { db = migrate(j.db); sharedVersion = j.version; firstRun = false; try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* ignore */ } }
    else { await bootstrapDemo(); await pushShared(); } // first device: its data becomes the shared copy
  } catch { /* no dev server: stay local */ }
}

let queue = Promise.resolve();
/** Run one API call on the newest shared copy and send the change back (one call at a time per device). */
function synced(fn) {
  return (...args) => {
    if (!sharedOn) return fn(...args);
    const run = queue.then(async () => {
      try { if (unsent) await pushShared(); await pullShared(); } catch { /* server unreachable: work on what we have */ }
      for (let attempt = 0; ; attempt++) {
        dirty = false;
        let result, error;
        try { result = await fn(...args); } catch (e) { error = e; }
        if (dirty) {
          try { if (!(await pushShared()) && attempt < 3) continue; } // someone saved first: run again on their copy
          catch { unsent = true; } // send later
        }
        if (error) throw error;
        return result;
      }
    });
    queue = run.catch(() => {});
    return run;
  };
}
// only the data calls (async) go through the sync; quick helpers like cycleFor() must answer at once
const isAsync = (f) => f.constructor.name === 'AsyncFunction';
const sharedApi = Object.fromEntries(Object.entries(api).map(([k, v]) => [k, typeof v === 'function' && isAsync(v) ? synced(v) : v]));
export { sharedApi as api };
/** true when this browser works on the dev server's shared test data. */
export const isSharedData = () => sharedOn;

/**
 * D-79: keep the demo current. Adds milk, buyer and walk-in sales, dispatches and logins for every shift since the
 * history ended that has no entries at all (never a shift you entered yourself), sends each new entry's message,
 * and bills + finalizes every finished bill period that has not been billed yet (most bills paid, some left unpaid).
 */
/** D-112: example data for the payout, approval, request and help screens (run once, as the owner / operator / farmer / support). */
async function featureDemo(owner) {
  const keep = sessionUserId;
  const as = (id) => { sessionUserId = id; };
  const F = (code) => db.farmers.find((f) => f.code === code);
  try {
    as(owner.id);
    // ₹1 checks: UPI for most; 105 is paid to the bank account; 109's bank name still to be looked at; 110's name did not match
    if (F(105)?.bankAccount) F(105).payMethod = 'bank';
    if (F(109)?.bankAccount) F(109).payMethod = 'bank';
    for (const f of db.farmers.filter((x) => x.active && /^f1\d\d$/.test(x.id))) {
      try {
        const bank = f.payMethod === 'bank';
        const c = bank ? await api.verifyBank(f.id) : await api.verifyUpi(f.id);
        if (c.status !== 'name-check' || f.code === 109) continue;
        await api.confirmUpiName({ farmerId: f.id, ok: !/^(SHRI|SMT) /.test(c.bankName), method: bank ? 'bank' : 'upi' });
      } catch { /* no UPI / bank: shown as such */ }
    }
    for (const code of [101, 103, 105, 106, 107, 108]) if (F(code)) await api.setDeductionConsent({ farmerId: F(code).id, consent: true });
    await api.setPayApproval({ farmerIds: [102, 104].map((c) => F(c)?.id).filter(Boolean), on: true });
    const conf = payoutConf();
    db.center.payout = { ...conf, mode: 'eod', time: '21:30', eodApproval: false, lagDays: 0, simDelayMs: 3000,
      funding: conf.funding.accountNo ? conf.funding : { accountName: 'आरग दूध संकलन केंद्र', bankName: 'बँक ऑफ महाराष्ट्र', accountNo: '60123456789', ifsc: 'MAHB0000123' } };
    const date = todayIST();
    // farmers marked "needs approval" wait in the approval list (as the fixed-time run does)
    const marked = new Set([F(102)?.id, F(104)?.id]);
    const wait = makeRun(date, 'eod', 'system', { only: (f) => marked.has(f.id), auto: false });
    for (const x of db.payouts.filter((p) => p.runId === wait.id)) x.waitApproval = true;
    Object.assign(wait, { status: 'sent', sentAt: nowIso(), approvedBy: 'system' });
    // everyone else due today: paid; one fails ("bank down") and one is later reversed by the bank, so every status shows
    const run = makeRun(date, 'approve', owner.id, { only: (f) => !marked.has(f.id) });
    const items = db.payouts.filter((p) => p.runId === run.id);
    items.forEach((x, i) => {
      x.status = 'approved'; sendPayout(x, owner.id);
      if (x.status !== 'processing') return;
      if (i === 0) x.sim = { outcome: 'failed', failReason: 'bank-down' };
      if (i === 1) x.sim = { ...x.sim, outcome: 'success', reverse: true };
      x.webhookDueAt = Date.now() + 2000 + i * 400;
    });
    Object.assign(run, { status: 'sent', sentAt: nowIso(), approvedBy: owner.id });
    // detail-change requests: the operator's, and two farmers' own
    as('u-op1');
    try { await api.saveFarmer({ ...F(109), mobile: '9822000109', changeNote: 'शेतकऱ्याने नवीन मोबाईल नंबर दिला' }); } catch { /* already asked */ }
    as('farmer:' + F(108).id);
    try { await api.requestMyChange({ fields: { upiId: 'anita.kulkarni@oksbi' }, note: 'नवीन बँक खाते उघडले' }); } catch { /* */ }
    as('farmer:' + F(111).id);
    try { await api.requestMyChange({ fields: { payPref: { kind: 'day', day: 10 } }, note: 'महिन्याच्या १० तारखेला पैसे हवेत' }); } catch { /* */ }
    // help tickets in different states
    as('u-op1');
    await api.createTicket({ category: 'app', subject: 'प्रिंटर जोडला जात नाही', text: 'ब्लूटूथ प्रिंटर यादीत दिसत नाही. फोन रीस्टार्ट केला तरी तसेच.' });
    as('farmer:' + F(103).id);
    const t1 = await api.createTicket({ category: 'milk', subject: 'कालचे संध्याकाळचे दूध दिसत नाही', text: 'कालचे संध्याकाळचे दूध माझ्या नोंदीत दिसत नाही.', priority: 'urgent' });
    as('farmer:' + F(106).id);
    const t2 = await api.createTicket({ category: 'upi', subject: 'UPI पेमेंट आले नाही', text: 'आज पेमेंट झाले असे दिसते पण खात्यात अजून आले नाही.' });
    as(owner.id);
    const t3 = await api.createTicket({ category: 'bill', subject: 'बिल PDF मध्ये मराठी अंक हवेत', text: 'छापील बिलावर मराठी अंक दिसावेत अशी सेटिंग आहे का?' });
    as('u-support');
    await api.replyTicket(t1.id, 'तपासले — ती नोंद आता दिसेल. कृपया पुन्हा पहा.'); await api.setTicketStatus(t1.id, 'resolved');
    await api.replyTicket(t2.id, 'बँकेकडे चौकशी सुरू आहे. १-२ तासांत कळवतो.');
    await api.replyTicket(t3.id, 'हो — सेटिंग्ज → बिल मध्ये "मराठी अंक" निवडा. ते दिसले का?'); await api.setTicketStatus(t3.id, 'waiting');
  } finally { sessionUserId = keep; }
}

async function catchUpDemo() {
  const added = topUpDemo(db);
  const keep = sessionUserId;
  sessionUserId = 'u-owner';
  let billed = 0;
  try {
    const today = todayIST();
    for (const e of added) {
      const f = farmerById(e.farmerId);
      const m = f && queueMessage({ farmer: f, kind: 'pour', date: e.date, texts: pourMessage({ farmer: f, entry: e }), entryId: e.id });
      if (m && e.date < today) Object.assign(m, { status: 'sent', attempts: 1, createdAt: e.createdAt, sentAt: e.createdAt });
    }
    // finished periods not billed yet, oldest first
    const todo = [];
    for (let c = previousCycle(currentCycle(), ...cycleConf()); todo.length < 12; c = previousCycle(c, ...cycleConf())) {
      if (db.cycles.some((x) => x.id === cycleKey(c))) break;
      if (!db.collections.some((x) => x.date >= c.start && x.date <= c.end)) break;
      todo.unshift(c);
    }
    let n = db.payments.length;
    for (const per of todo) {
      await api.generateBills(per);
      await api.finalizeCycle(cycleKey(per));
      db.bills.filter((b) => b.cycleId === cycleKey(per)).forEach((b, i) => {
        if (b.payablePaise === 0 || i % 4 === 3) return; // 1 in 4 still unpaid
        const mode = farmerById(b.farmerId).upiId && i % 5 !== 2 ? 'upi' : 'cash';
        n++;
        const date = addDays(per.end, 1 + (i % 2)) > today ? today : addDays(per.end, 1 + (i % 2));
        db.payments.push({ id: uuid(), centerId: CENTER_ID, billId: b.id, farmerId: b.farmerId, mode, amountPaise: b.payablePaise,
          upiRef: mode === 'upi' ? 'UTR' + String(400000000 + n * 7919) : '', date, createdAt: nowIso(), createdBy: 'u-owner' });
        b.paidPaise = b.payablePaise;
      });
      billed++;
    }
    if (added.length || billed) await api.runOutbox();
  } finally { sessionUserId = keep; }
  if (added.length || billed) save();
}

await startShared();
await bootstrapDemo();
if (!db.msgHistory) { backfillMessages(); save(); } // older saved data: add the message history once
await catchUpDemo().catch((e) => console.warn('demo catch-up skipped:', e?.code || e)); // D-79
if (sharedOn && dirty) { try { if (!(await pushShared())) await catchUpDemo().then(() => dirty && pushShared()).catch(() => {}); } catch { unsent = true; } }
