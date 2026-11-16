// Demo data so the UI can be tried before the backend exists. All names are fictional.
import { generateChart } from '../lib/rates.js';
import { govtSchemes } from './schemes-data.js';
import { amountFor } from '../lib/money.js';
import { addDays, daysBetween, todayIST, currentShift } from '../lib/dates.js';
import { lookupRate } from '../lib/rates.js';
import { uuid } from '../lib/uuid.js';
import { priceEntry } from '../lib/collection.js';

/** Demo only: a made-up Aadhaar ending for each farmer (the app only ever holds the last 4 digits). */
export const demoAadhaarLast4 = (code) => String((code * 7919 + 2468) % 10000).padStart(4, '0');

/** Government schemes the center starts with (D-71, D-92); the owner edits, hides or deletes them. */
export function sampleSchemes() { return govtSchemes(CENTER_ID); } // D-92: real Maharashtra schemes (schemes-data.js)

export const CENTER_ID = 'arag';

/** Demo history starts on the 1st of the month three months back (e.g. 01/08 when today is in November),
 *  so the demo has many complete bill periods (D-50). */
export function historyStart(today) {
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7)) - 3; // 1-based month minus 3
  const yy = m < 1 ? y - 1 : y; const mm = m < 1 ? m + 12 : m;
  return `${yy}-${String(mm).padStart(2, '0')}-01`;
}

/** Center fields added after the first release; filled into older saved data on load. */
export const CENTER_DEFAULTS = {
  morningFrom: '07:00', morningTo: '10:00', eveningFrom: '18:00', eveningTo: '21:00',
  ownerName: '', ownerTitle: '', ownerMessage: '', ownerPhoto: '',
  // walk-in (सुटी) milk sale: price per litre; ¼ / ½ L are charged pro rata (D-53)
  counterRateCowPaise: 6000, counterRateBuffaloPaise: 7600,
};

const FARMERS = [
  ['रामचंद्र पाटील', 'आरग', ['cow'], true],
  ['सुनीता जाधव', 'आरग', ['buffalo'], true],
  ['विठ्ठल माने', 'बेडग', ['cow', 'buffalo'], true],
  ['शांताबाई कांबळे', 'आरग', ['cow'], false],
  ['दत्तात्रय शिंदे', 'लिंगनूर', ['cow'], true],
  ['मीरा पवार', 'आरग', ['buffalo'], true],
  ['गणपत चव्हाण', 'बेडग', ['cow'], true],
  ['अनिता कुलकर्णी', 'आरग', ['cow'], false],
  ['बाळासाहेब देसाई', 'लिंगनूर', ['buffalo'], true],
  ['संगीता मोरे', 'आरग', ['cow'], true],
  ['तुकाराम गायकवाड', 'आरग', ['cow', 'buffalo'], true],
  ['लक्ष्मी साळुंखे', 'बेडग', ['cow'], true],
];

// Deterministic pseudo-random so the demo looks the same on every reset.
function rng(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }

export function buildSeed(now = new Date()) {
  const r = rng(42);
  const today = todayIST(now);
  const start = historyStart(today);
  const createdAt = now.toISOString();
  const center = {
    id: CENTER_ID, name: 'आरग दूध संकलन केंद्र', nameEn: 'Arag Dudh Sankalan Kendra',
    address: 'मु. पो. आरग, ता. मिरज, जि. सांगली – ४१६४०१', mobile: '9158435304',
    cycleDays: 10, cycleAnchor: '2026-01-05', rateRule: 'nearest-lower',
    dailySummaryTime: '20:30', smsCap: 95, marathiDigitsOnBill: false,
    dairyName: '', publicBaseUrl: '', // empty = the address the app is opened from
    // Public website (owner edits in Settings). Empty → the site shows default text.
    ...CENTER_DEFAULTS,
  };
  const users = [
    { id: 'u-owner', centerId: CENTER_ID, name: 'मालक', role: 'owner', pin: '1234', mobile: '9158435304', active: true, createdAt },
    { id: 'u-op1', centerId: CENTER_ID, name: 'ऑपरेटर १', role: 'operator', pin: '1111', mobile: '9876501111', active: true, createdAt }, // D-136: staff log in with mobile + OTP
  ];
  // Demo login history for the last 6 days: operator works both shifts, owner checks in the evening.
  const sessions = [];
  const at = (date, hm) => new Date(Date.parse(`${date}T${hm}:00+05:30`)).toISOString();
  const dev = { android: 'Mozilla/5.0 (Linux; Android 12; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' };
  for (let d = 6; d >= 1; d--) {
    const date = addDays(today, -d);
    const m = Math.floor(r() * 15);
    sessions.push({ id: uuid(), centerId: CENTER_ID, userId: 'u-op1', loginAt: at(date, `06:${String(40 + m).padStart(2, '0')}`), lastSeenAt: at(date, '10:12'), logoutAt: at(date, '10:15'), ua: dev.android });
    sessions.push({ id: uuid(), centerId: CENTER_ID, userId: 'u-op1', loginAt: at(date, `17:${String(45 + m).padStart(2, '0')}`), lastSeenAt: at(date, '21:05'), logoutAt: d === 3 ? null : at(date, '21:08'), ua: dev.android });
    if (d % 2) sessions.push({ id: uuid(), centerId: CENTER_ID, userId: 'u-owner', loginAt: at(date, '21:20'), lastSeenAt: at(date, '21:41'), logoutAt: at(date, '21:42'), ua: dev.windows });
  }
  const failedLogin = { id: uuid(), centerId: CENTER_ID, at: at(addDays(today, -2), '06:38'), userId: 'u-op1', action: 'login-failed', entity: 'user', entityId: 'u-op1', before: null, after: { ua: dev.android } };
  const farmers = FARMERS.map(([name, village, milkTypes, hasWhatsapp], i) => ({
    id: 'f' + (101 + i), centerId: CENTER_ID, code: 101 + i, name, village,
    mobile: '98' + String(22000000 + i * 137531).padStart(8, '0').slice(0, 8), hasWhatsapp, consent: true,
    milkTypes, upiId: hasWhatsapp ? `farmer${101 + i}@upi` : '', bankName: '', bankAccount: '', bankIfsc: '',
    aadhaarLast4: demoAadhaarLast4(101 + i), active: true, createdAt,
  }));
  const cow = { id: 'rc-cow-1', centerId: CENTER_ID, milkType: 'cow', effectiveFrom: start, createdAt, createdBy: 'u-owner', note: 'नमुना दरपत्रक',
    ...generateChart({ fatFrom: 30, fatTo: 60, snfFrom: 75, snfTo: 95, basePaise: 2500, fatStepPaise: 50, snfStepPaise: 30 }) };
  const buf = { id: 'rc-buf-1', centerId: CENTER_ID, milkType: 'buffalo', effectiveFrom: start, createdAt, createdBy: 'u-owner', note: 'नमुना दरपत्रक',
    ...generateChart({ fatFrom: 50, fatTo: 100, snfFrom: 80, snfTo: 100, basePaise: 4000, fatStepPaise: 60, snfStepPaise: 30 }) };
  const charts = [cow, buf];

  // Collections: every day from the history start up to the current shift.
  const collections = [];
  const nowShift = currentShift(now);
  for (let d = daysBetween(start, today); d >= 0; d--) {
    const date = addDays(today, -d);
    for (const shift of ['morning', 'evening']) {
      if (d === 0 && shift === 'evening' && nowShift === 'morning') continue;
      for (const f of farmers) {
        for (const milkType of f.milkTypes) {
          if (r() < 0.06) continue; // some days a farmer skips
          const isCow = milkType === 'cow';
          const litresX100 = Math.round((isCow ? 400 + r() * 350 : 300 + r() * 300) / 10) * 10;
          const fatX10 = isCow ? 38 + Math.floor(r() * 7) : 60 + Math.floor(r() * 16);
          const snfX10 = isCow ? 83 + Math.floor(r() * 5) : 88 + Math.floor(r() * 6);
          const chart = isCow ? cow : buf;
          const rate = lookupRate(chart, fatX10, snfX10, 'nearest-lower').ratePaise;
          collections.push({ id: uuid(), centerId: CENTER_ID, farmerId: f.id, date, shift, milkType, litresX100, fatX10, snfX10,
            ratePaise: rate, amountPaise: amountFor(litresX100, rate), chartId: chart.id, createdAt, createdBy: 'u-op1', void: false });
        }
      }
    }
  }

  // Daily milk buyers (D-51): hotel, tea stall, hostel, households — milk taken every day, billed per calendar month.
  const BUYERS = [
    ['हॉटेल साई', 'बस स्टँड', 'cow', 5600, 800, 600, 0.20],
    ['रमेश चहा टपरी', 'मेन रोड', 'buffalo', 7000, 500, 300, 0.25],
    ['कुलकर्णी कुटुंब', 'शिवाजी नगर', 'cow', 5800, 150, 0, 0.0],
    ['देशपांडे कुटुंब', 'गणेश कॉलनी', 'buffalo', 7200, 100, 100, 0.0],
    ['जोशी कुटुंब', 'शिवाजी नगर', 'cow', 5800, 100, 100, 0.0],
    ['शाळा वसतिगृह', 'आरग हायस्कूल', 'cow', 5400, 1000, 0, 0.10],
  ];
  const buyers = BUYERS.map(([name, area, milkType, ratePaise, morningX100, eveningX100], i) => ({
    id: 'g' + (1 + i), centerId: CENTER_ID, code: 1 + i, name, area, mobile: '97' + String(30000000 + i * 211337).padStart(8, '0').slice(0, 8),
    milkType, ratePaise, morningX100, eveningX100, active: true, note: '', createdAt }));
  const buyerSales = [];
  for (let d = daysBetween(start, today); d >= 0; d--) {
    const date = addDays(today, -d);
    for (const shift of ['morning', 'evening']) {
      if (d === 0 && shift === 'evening' && nowShift === 'morning') continue;
      buyers.forEach((b, i) => {
        const usual = shift === 'morning' ? b.morningX100 : b.eveningX100; if (!usual) return;
        if (r() < 0.04) return; // some days they don't take milk
        const swing = BUYERS[i][6];
        const litresX100 = Math.max(50, Math.round(usual * (1 + (r() * 2 - 1) * swing) / 50) * 50);
        buyerSales.push({ id: uuid(), centerId: CENTER_ID, buyerId: b.id, date, shift, milkType: b.milkType, litresX100,
          ratePaise: b.ratePaise, amountPaise: amountFor(litresX100, b.ratePaise), createdAt, createdBy: 'u-op1' });
      });
    }
  }
  // Monthly payments: every finished month paid early next month, except the last finished month
  // (the tea stall paid part, देशपांडे not yet). Months before the last finished one are closed.
  const buyerPayments = []; const buyerMonths = [];
  const monthOf = (dt) => dt.slice(0, 7);
  const thisMonth = monthOf(today);
  const months = [...new Set(buyerSales.map((s) => monthOf(s.date)))].filter((m) => m < thisMonth).sort();
  months.forEach((m, mi) => {
    const last = mi === months.length - 1;
    const next = addDays(m + '-28', 6).slice(0, 7);
    buyers.forEach((b, i) => {
      const due = buyerSales.filter((s) => s.buyerId === b.id && monthOf(s.date) === m).reduce((a, s) => a + s.amountPaise, 0);
      if (!due || (last && i === 3)) return;
      const amountPaise = last && i === 1 ? Math.round(due / 2 / 100) * 100 : due;
      const mode = i % 2 ? 'cash' : 'upi';
      const date = `${next}-0${3 + (i % 5)}`;
      if (date > today) return;
      buyerPayments.push({ id: uuid(), centerId: CENTER_ID, buyerId: b.id, date, mode, amountPaise,
        upiRef: mode === 'upi' ? 'UTR' + String(510000000 + mi * 1000 + i * 37) : '', note: '', createdAt, createdBy: 'u-owner' });
    });
    if (!last) buyerMonths.push({ id: m, centerId: CENTER_ID, month: m, closedAt: createdAt, closedBy: 'u-owner' });
  });
  // Walk-in (सुटी) sales (D-53): unknown people buying ¼ / ½ / 1 L, paid on the spot. Own random stream so the rest of the demo stays the same.
  const counterSales = [];
  const rc = rng(7);
  const QTY = [25, 50, 50, 50, 100, 100, 100, 150, 200];
  const NAMES = ['', '', '', '', '', 'पाहुणे', 'शेजारी', 'लग्न घर', 'मंदिर'];
  for (let d = daysBetween(start, today); d >= 0; d--) {
    const date = addDays(today, -d);
    for (const shift of ['morning', 'evening']) {
      if (d === 0 && shift === 'evening' && nowShift === 'morning') continue;
      const n = Math.floor(rc() * 4);
      for (let k = 0; k < n; k++) {
        const milkType = rc() < 0.6 ? 'cow' : 'buffalo';
        const litresX100 = QTY[Math.floor(rc() * QTY.length)];
        const ratePaise = milkType === 'cow' ? CENTER_DEFAULTS.counterRateCowPaise : CENTER_DEFAULTS.counterRateBuffaloPaise;
        const upi = rc() < 0.2;
        counterSales.push({ id: uuid(), centerId: CENTER_ID, date, shift, milkType, litresX100, ratePaise, amountPaise: amountFor(litresX100, ratePaise),
          mode: upi ? 'upi' : 'cash', upiRef: '', name: NAMES[Math.floor(rc() * NAMES.length)], void: false, voidReason: '',
          createdAt: new Date(`${date}T${shift === 'morning' ? '07' : '18'}:${String(5 + k * 17 + Math.floor(rc() * 12)).padStart(2, '0')}:00+05:30`).toISOString(), createdBy: 'u-op1' });
      }
    }
  }
  const soldBy = new Map();
  for (const s of counterSales) { const k = `${s.date}|${s.shift}|${s.milkType}`; soldBy.set(k, (soldBy.get(k) || 0) + s.litresX100); }
  for (const s of buyerSales) { const k = `${s.date}|${s.shift}|${s.milkType}`; soldBy.set(k, (soldBy.get(k) || 0) + s.litresX100); }

  // Dispatch to dairy: per date/shift/type, what's left after buyer and walk-in sales, ~0.4 % shrinkage, dairy pays ₹2/L more.
  const dispatches = [];
  const groups = new Map();
  for (const c of collections) {
    const k = `${c.date}|${c.shift}|${c.milkType}`;
    const g = groups.get(k) || { date: c.date, shift: c.shift, milkType: c.milkType, l: 0, a: 0, f: 0, s: 0 };
    g.l += c.litresX100; g.a += c.amountPaise; g.f += c.fatX10 * c.litresX100; g.s += c.snfX10 * c.litresX100;
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    if (g.date === today) continue; // today's dispatch not yet entered
    const litresX100 = Math.round((g.l - (soldBy.get(`${g.date}|${g.shift}|${g.milkType}`) || 0)) * 0.996);
    if (litresX100 <= 0) continue; // buyers took it all (or more): nothing went to the dairy
    const ratePaise = Math.round(g.a / (g.l / 100)) + 200;
    dispatches.push({ id: uuid(), centerId: CENTER_ID, date: g.date, shift: g.shift, milkType: g.milkType, litresX100,
      fatX10: Math.round(g.f / g.l), snfX10: Math.round(g.s / g.l), ratePaise, amountPaise: amountFor(litresX100, ratePaise),
      dairyName: 'डेअरी (निश्चित नाही)', createdAt, createdBy: 'u-owner' });
  }

  const feedItems = [
    { id: 'fi1', centerId: CENTER_ID, name: 'पशुखाद्य (५० किलो पोती)', unit: 'पोती', pricePaise: 145000, active: true },
    { id: 'fi2', centerId: CENTER_ID, name: 'मिनरल मिक्स्चर (१ किलो)', unit: 'पाकीट', pricePaise: 18000, active: true },
  ];
  const feedMoves = [
    { id: uuid(), centerId: CENTER_ID, itemId: 'fi1', date: start, type: 'in', qty: 60, pricePaise: 132000, amountPaise: 7920000, farmerId: null, note: 'सुरुवातीचा साठा', createdAt, createdBy: 'u-owner' },
    { id: uuid(), centerId: CENTER_ID, itemId: 'fi2', date: start, type: 'in', qty: 40, pricePaise: 15000, amountPaise: 600000, farmerId: null, note: 'सुरुवातीचा साठा', createdAt, createdBy: 'u-owner' },
    { id: uuid(), centerId: CENTER_ID, itemId: 'fi1', date: addDays(today, -15), type: 'in', qty: 40, pricePaise: 132000, amountPaise: 5280000, farmerId: null, note: 'खरेदी', createdAt, createdBy: 'u-owner' },
    { id: uuid(), centerId: CENTER_ID, itemId: 'fi2', date: addDays(today, -15), type: 'in', qty: 30, pricePaise: 15000, amountPaise: 450000, farmerId: null, note: 'खरेदी', createdAt, createdBy: 'u-owner' },
  ];
  for (const [fi, days, qty, item] of [[0, 3, 1, 'fi1'], [2, 5, 2, 'fi1'], [4, 2, 1, 'fi1'], [6, 1, 1, 'fi2'], [9, 4, 1, 'fi1']]) {
    const it = feedItems.find((x) => x.id === item);
    feedMoves.push({ id: uuid(), centerId: CENTER_ID, itemId: item, date: addDays(today, -days), type: 'sale', qty, pricePaise: it.pricePaise,
      amountPaise: qty * it.pricePaise, farmerId: farmers[fi].id, note: '', createdAt, createdBy: 'u-op1' });
  }
  // feed sold on credit through the history (so older bills carry a पशुखाद्य deduction too)
  for (let d = addDays(start, 3), k = 0; d < addDays(today, -6); d = addDays(d, 6), k++) {
    const item = k % 3 === 2 ? 'fi2' : 'fi1'; const it = feedItems.find((x) => x.id === item); const f = farmers[(k * 5) % farmers.length];
    feedMoves.push({ id: uuid(), centerId: CENTER_ID, itemId: item, date: d, type: 'sale', qty: 1, pricePaise: it.pricePaise,
      amountPaise: it.pricePaise, farmerId: f.id, note: '', createdAt, createdBy: 'u-op1' });
  }
  const advances = [
    { id: uuid(), centerId: CENTER_ID, farmerId: farmers[2].id, date: addDays(start, 12), amountPaise: 600000, installmentPaise: 100000, note: 'गोठा दुरुस्ती', createdAt, createdBy: 'u-owner' },
    { id: uuid(), centerId: CENTER_ID, farmerId: farmers[10].id, date: addDays(start, 40), amountPaise: 300000, installmentPaise: 75000, note: 'बियाणे', createdAt, createdBy: 'u-owner' },
    { id: uuid(), centerId: CENTER_ID, farmerId: farmers[0].id, date: addDays(today, -20), amountPaise: 500000, installmentPaise: 50000, note: 'वैद्यकीय', createdAt, createdBy: 'u-owner' },
    { id: uuid(), centerId: CENTER_ID, farmerId: farmers[4].id, date: addDays(today, -12), amountPaise: 300000, installmentPaise: 100000, note: '', createdAt, createdBy: 'u-owner' },
  ];

  return {
    version: 1, center, users, farmers, charts, collections, corrections: [], feedItems, feedMoves, advances,
    cycles: [], bills: [], payments: [], dispatches, outbox: [], buyers, buyerSales, buyerPayments, buyerMonths, counterSales, smsCounter: { date: today, sent: 0 }, audit: [], sessions, seedAudit: [failedLogin],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Demo data upkeep (D-79). Fictional values only; never used with the real backend.

const BANKS = ['सांगली जिल्हा मध्यवर्ती सहकारी बँक', 'बँक ऑफ महाराष्ट्र', 'स्टेट बँक ऑफ इंडिया', 'आरग विविध कार्यकारी सोसायटी'];
const BUYER_NOTES = ['रोज सकाळी ८ आधी', 'महिनाअखेरीस पैसे', 'घरी पोच', 'रविवारी जास्त लागते', 'सुट्टीत कमी', 'शाळा चालू असताना'];
const DEMO_FARMER = /^f1(0[1-9]|1[0-2])$/;

/** Fill blank demo columns: bank details and UPI for the demo farmers, operator mobile, buyer notes, UTRs. */
export function demoFill(d) {
  for (const f of d.farmers || []) {
    if (!DEMO_FARMER.test(f.id)) continue; // only the 12 demo farmers; farmers you added stay as you entered them
    const n = f.code;
    if (!f.bankName) f.bankName = BANKS[n % BANKS.length];
    if (!f.bankAccount) f.bankAccount = String(30000000000 + n * 7919137).slice(0, 12);
    if (!f.bankIfsc) f.bankIfsc = 'DEMO0' + String(100000 + ((n * 37) % 900000)).slice(0, 6); // fake bank code DEMO
    if (!f.upiId) f.upiId = `farmer${n}@upi`;
  }
  for (const u of d.users || []) if (u.id === 'u-op1' && !u.mobile) u.mobile = '9876501111';
  (d.buyers || []).forEach((b, i) => { if (!b.note && /^g[1-6]$/.test(b.id)) b.note = BUYER_NOTES[i % BUYER_NOTES.length]; });
  let k = 0;
  for (const s of d.counterSales || []) if (s.mode === 'upi' && !s.upiRef) s.upiRef = 'UTR' + String(600000000 + (k++) * 7919);
  if (d.center && !d.center.dairyName) d.center.dairyName = 'डेअरी (निश्चित नाही)';
  return d;
}

/**
 * Bring the demo up to "now": every date / shift after the history that has NO milk entries at all gets the day's
 * milk (demo farmers), buyer milk, walk-in sales and the operator's login; every finished day gets its dairy
 * dispatch. A shift you entered yourself (even one entry) is never touched. Returns the new milk entries.
 */
export function topUpDemo(d, now = new Date(), { until = null } = {}) {
  const today = todayIST(now);
  const end = until && until > today ? until : today; // D-112: the owner may ask for test data up to a later day (e.g. tomorrow)
  const nowShift = currentShift(now);
  const last = (d.collections || []).reduce((m, c) => (c.date > m ? c.date : m), '');
  if (!last) return [];
  const added = [];
  const at = (date, hm) => new Date(Date.parse(`${date}T${hm}:00+05:30`)).toISOString();
  const UA = 'Mozilla/5.0 (Linux; Android 12; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
  const demoFarmers = d.farmers.filter((f) => f.active && DEMO_FARMER.test(f.id));
  d.counterSales ||= []; d.sessions ||= []; d.buyerSales ||= []; d.dispatches ||= [];
  // D-89: every day of the still-open bill periods (not only after the newest entry): past days get each missing demo
  // entry; today only a shift with no entries at all (so it never clashes with milk being entered right now).
  // Finalized bill periods and closed buyer months are never changed.
  const finalized = (date) => (d.cycles || []).some((c) => c.status === 'finalized' && date >= c.start && date <= c.end);
  const closedMonth = (date) => (d.buyerMonths || []).some((m) => m.month === date.slice(0, 7));
  const firstOpen = (d.cycles || []).filter((c) => c.status === 'finalized').reduce((m, c) => (c.end >= m ? addDays(c.end, 1) : m), d.collections.reduce((m, c) => (!m || c.date < m ? c.date : m), ''));
  const from = firstOpen < last ? firstOpen : last;
  const has = new Set(d.collections.filter((c) => !c.void).map((c) => `${c.farmerId}|${c.date}|${c.shift}|${c.milkType}`));
  for (let date = from; date <= end; date = addDays(date, 1)) {
    const r = rng(Number(date.replace(/-/g, '')) % 2147483647);
    for (const shift of ['morning', 'evening']) {
      if (date === today && shift === 'evening' && nowShift === 'morning' && end === today) continue;
      const inShift = d.collections.filter((c) => c.date === date && c.shift === shift && !c.void).length;
      const slots = demoFarmers.reduce((n, f) => n + f.milkTypes.length, 0);
      // a past shift is filled only when clearly incomplete (under half the usual entries); today only when empty
      if (finalized(date) || (date >= today ? inShift > 0 : inShift * 2 >= slots)) continue;
      const hh = shift === 'morning' ? '07' : '18';
      for (const f of demoFarmers) {
        for (const milkType of f.milkTypes) {
          const skip = r() < 0.06; // the random numbers are drawn the same way every time, so a day always gets the same milk
          const isCow = milkType === 'cow';
          const e = { date, milkType, litresX100: Math.round((isCow ? 400 + r() * 350 : 300 + r() * 300) / 10) * 10,
            fatX10: isCow ? 38 + Math.floor(r() * 7) : 60 + Math.floor(r() * 16), snfX10: isCow ? 83 + Math.floor(r() * 5) : 88 + Math.floor(r() * 6) };
          if (skip || has.has(`${f.id}|${date}|${shift}|${milkType}`)) continue;
          has.add(`${f.id}|${date}|${shift}|${milkType}`);
          const p = priceEntry(e, d.charts.filter((c) => c.side !== 'dairy'), d.center.rateRule || 'nearest-lower');
          if (!p.ok) continue;
          const rec = { id: uuid(), centerId: CENTER_ID, farmerId: f.id, date, shift, milkType, litresX100: e.litresX100, fatX10: e.fatX10, snfX10: e.snfX10,
            ratePaise: p.ratePaise, amountPaise: p.amountPaise, chartId: p.chartId, createdAt: at(date, `${hh}:${String(10 + (added.length % 40)).padStart(2, '0')}`), createdBy: 'u-op1', void: false };
          d.collections.push(rec); added.push(rec);
        }
      }
      for (const b of (d.buyers || []).filter((x) => x.active)) {
        const usual = shift === 'morning' ? b.morningX100 : b.eveningX100;
        const skip = r() < 0.04;
        if (!usual || skip || closedMonth(date) || (b.startDate && date < b.startDate) || d.buyerSales.some((s) => s.buyerId === b.id && s.date === date && s.shift === shift)) continue;
        const litresX100 = Math.max(50, Math.round((usual * (1 + (r() * 2 - 1) * 0.15)) / 50) * 50);
        d.buyerSales.push({ id: uuid(), centerId: CENTER_ID, buyerId: b.id, date, shift, milkType: b.milkType, litresX100, ratePaise: b.ratePaise,
          amountPaise: amountFor(litresX100, b.ratePaise), createdAt: at(date, `${hh}:45`), createdBy: 'u-op1' });
      }
      if (!closedMonth(date) && !d.counterSales.some((s) => s.date === date && s.shift === shift)) {
        const QTY = [25, 50, 50, 100, 100, 150, 200];
        for (let k = 0, n = Math.floor(r() * 4); k < n; k++) {
          const milkType = r() < 0.6 ? 'cow' : 'buffalo'; const litresX100 = QTY[Math.floor(r() * QTY.length)];
          const ratePaise = milkType === 'cow' ? (d.center.counterRateCowPaise || 6000) : (d.center.counterRateBuffaloPaise || 7600);
          const upi = r() < 0.2;
          d.counterSales.push({ id: uuid(), centerId: CENTER_ID, date, shift, milkType, litresX100, ratePaise, amountPaise: amountFor(litresX100, ratePaise),
            mode: upi ? 'upi' : 'cash', upiRef: upi ? 'UTR' + String(610000000 + Math.floor(r() * 9999999)) : '', name: '', void: false, voidReason: '',
            createdAt: at(date, `${hh}:${String(20 + k * 9).padStart(2, '0')}`), createdBy: 'u-op1' });
        }
      }
      const from = at(date, shift === 'morning' ? '05:00' : '16:00'); const to = at(date, shift === 'morning' ? '13:00' : '23:59');
      if (date < today && !d.sessions.some((s) => s.userId === 'u-op1' && s.loginAt >= from && s.loginAt < to)) {
        d.sessions.push({ id: uuid(), centerId: CENTER_ID, userId: 'u-op1', loginAt: at(date, shift === 'morning' ? '06:45' : '17:50'),
          lastSeenAt: at(date, shift === 'morning' ? '10:10' : '21:05'), logoutAt: at(date, shift === 'morning' ? '10:12' : '21:07'), ua: UA });
      }
    }
  }
  // dairy dispatch for each finished day that has milk but no dispatch yet
  const sold = new Map();
  for (const s of [...d.counterSales.filter((x) => !x.void), ...d.buyerSales]) { const k = `${s.date}|${s.shift}|${s.milkType}`; sold.set(k, (sold.get(k) || 0) + s.litresX100); }
  const groups = new Map();
  for (const c of d.collections) {
    if (c.void || c.date < addDays(today, -40) || (end === today ? c.date >= today : c.date > end)) continue; // D-89: finished days of the last 40 days without a dispatch (D-112: up to `until` when asked)
    const k = `${c.date}|${c.shift}|${c.milkType}`;
    const g = groups.get(k) || { date: c.date, shift: c.shift, milkType: c.milkType, l: 0, a: 0, f: 0, s: 0 };
    g.l += c.litresX100; g.a += c.amountPaise; g.f += c.fatX10 * c.litresX100; g.s += c.snfX10 * c.litresX100; groups.set(k, g);
  }
  for (const g of groups.values()) {
    if (d.dispatches.some((x) => x.date === g.date && x.shift === g.shift && x.milkType === g.milkType)) continue;
    const litresX100 = Math.round((g.l - (sold.get(`${g.date}|${g.shift}|${g.milkType}`) || 0)) * 0.996);
    if (litresX100 <= 0) continue;
    const ratePaise = Math.round(g.a / (g.l / 100)) + 200;
    d.dispatches.push({ id: uuid(), centerId: CENTER_ID, date: g.date, shift: g.shift, milkType: g.milkType, litresX100, fatX10: Math.round(g.f / g.l), snfX10: Math.round(g.s / g.l),
      ratePaise, amountPaise: amountFor(litresX100, ratePaise), dairyName: d.center.dairyName || 'डेअरी (निश्चित नाही)',
      createdAt: at(g.date, g.shift === 'morning' ? '10:30' : '21:30'), createdBy: 'u-owner' });
  }
  return added;
}

/** Demo only (D-80): the dairy's chart = the first farmer chart of each milk type + ₹2.00 per litre, same grid. */
export function sampleDairyCharts(charts) {
  const out = [];
  for (const m of ['cow', 'buffalo']) {
    const base = charts.filter((c) => c.milkType === m && c.side !== 'dairy').sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
    if (!base) continue;
    out.push({ id: `rc-${m === 'cow' ? 'cow' : 'buf'}-dairy-1`, centerId: base.centerId, side: 'dairy', milkType: m, effectiveFrom: base.effectiveFrom, effectiveTo: null,
      fats: base.fats.slice(), snfs: base.snfs.slice(), rates: base.rates.map((row) => row.map((r) => (r == null ? null : r + 200))),
      note: 'नमुना डेअरी दरपत्रक (शेतकरी दर + ₹2)', createdAt: base.createdAt, createdBy: 'u-owner' });
  }
  return out;
}

/** Demo only (D-83): two sample doctors, marked (नमुना), with no mobile number (the owner fills real ones). */
export function sampleDoctors() {
  const at = new Date().toISOString();
  return [
    { id: 'doc-1', centerId: 'arag', name: 'डॉ. नमुना (शासकीय पशुवैद्यकीय दवाखाना)', qualification: 'B.V.Sc. & A.H.', kind: 'govt', mobile: '',
      place: 'पशुवैद्यकीय दवाखाना, आरग', areas: 'आरग, बेडग, लिंगनूर', timings: 'सोम–शनि, सकाळी ९ ते दुपारी १', services: 'तपासणी, लसीकरण, कृत्रिम रेतन',
      emergency: false, published: true, sort: 1, createdAt: at, updatedAt: at },
    { id: 'doc-2', centerId: 'arag', name: 'डॉ. नमुना (खाजगी)', qualification: 'B.V.Sc.', kind: 'private', mobile: '',
      place: 'मेन रोड, आरग', areas: 'आरग परिसर', timings: 'रोज, गरज असल्यास कधीही', services: 'आजारी जनावरांवर उपचार, बाळंतपण मदत',
      emergency: true, published: true, sort: 2, createdAt: at, updatedAt: at },
  ];
}

/**
 * D-126: demo expenses for last month and this month up to `today` — monthly rent / salary / electricity / phone and a
 * few one-time costs (diesel, cleaning, chemicals, a repair). Fictional values; only for demo data.
 */
export function demoExpenses(today, centerId = 'c1') {
  const thisM = today.slice(0, 7); const lastM = addDays(thisM + '-01', -1).slice(0, 7);
  const out = [];
  const add = (date, categoryId, rupees, period, note, mode = 'cash') => { if (date <= today) out.push({ id: uuid(), centerId, date, categoryId, amountPaise: rupees * 100, mode, period, note, photo: '',
    createdAt: new Date(Date.parse(`${date}T11:00:00+05:30`)).toISOString(), createdBy: 'u-owner', void: false, pending: null }); };
  for (const m of [lastM, thisM]) {
    add(`${m}-01`, 'ec-rent', 6000, 'month', 'केंद्राची जागा', 'upi');
    add(`${m}-05`, 'ec-salary', 9000, 'month', 'मदतनीस पगार', 'cash');
    add(`${m}-07`, 'ec-phone', 499, 'month', 'मोबाईल + वाय-फाय', 'upi');
    for (const d of ['03', '09', '15', '21', '27']) add(`${m}-${d}`, 'ec-transport', 350 + Number(d) * 4, 'once', 'डेअरीपर्यंत डिझेल');
    add(`${m}-12`, 'ec-clean', 260, 'once', 'डिटर्जंट, ब्रश');
    add(`${m}-18`, 'ec-chem', 640, 'once', 'फॅट टेस्ट केमिकल');
  }
  add(`${lastM}-10`, 'ec-power', 1840, 'month', 'MSEB मीटर', 'upi'); // this month's electricity not entered yet → reminder
  add(`${lastM}-23`, 'ec-repair', 1200, 'once', 'कॅनचे झाकण बदलले');
  return out;
}
export const isDemoData = (d) => (d.farmers || []).some((f) => DEMO_FARMER.test(f.id));

/** D-126: demo expenses after the newest one, up to `until` (same pattern as demoExpenses). Returns the added ones. */
export function topUpExpenses(d, until) {
  if (!isDemoData(d)) return [];
  d.expenses ||= [];
  const last = d.expenses.reduce((m, e) => (e.date > m ? e.date : m), '');
  const add = demoExpenses(until, d.center?.id || CENTER_ID).filter((e) => e.date > last && e.date <= until);
  d.expenses.push(...add);
  return add;
}
