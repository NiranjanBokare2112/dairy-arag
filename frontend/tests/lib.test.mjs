// Run: npm test   (Node's built-in test runner, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaise, amountFor, formatRupees, divRoundHalfUp } from '../public/src/lib/money.js';
import { parseLitres, parseTenths, fmtLitres } from '../public/src/lib/qty.js';
import { lookupRate, chartFor, parseChartCsv, chartToCsv, generateChart } from '../public/src/lib/rates.js';
import { computeBill } from '../public/src/lib/billing.js';
import { cycleFor, previousCycle } from '../public/src/lib/cycles.js';
import { findDuplicate, priceEntry } from '../public/src/lib/collection.js';
import { chooseChannel, selectDue, afterFailure, smsAllowance, backoffMs, deferToNextDay, istMidnightMs } from '../public/src/lib/outbox.js';
import { fmtDate, addDays, todayIST, parseDisplayDate } from '../public/src/lib/dates.js';
import { toMarathiDigits } from '../public/src/lib/digits.js';

// ---------- money & rounding ----------
test('toPaise parses rupee strings strictly', () => {
  assert.equal(toPaise('33.5'), 3350);
  assert.equal(toPaise('1,450.00'), 145000);
  assert.equal(toPaise('0.05'), 5);
  assert.equal(toPaise('12'), 1200);
  assert.equal(toPaise('-2.10'), -210);
  assert.equal(toPaise('1.234'), null);
  assert.equal(toPaise('abc'), null);
  assert.equal(toPaise(''), null);
});

test('rounding rule R1: litres × rate rounds half-up to the paisa', () => {
  assert.equal(amountFor(650, 3350), 21775);   // 6.50 × 33.50 = 217.75 (bill sample)
  assert.equal(amountFor(620, 3270), 20274);   // 6.20 × 32.70 = 202.74
  assert.equal(amountFor(125, 3333), 4166);    // 1.25 × 33.33 = 41.6625 → 41.66
  assert.equal(amountFor(150, 3333), 5000);    // 1.50 × 33.33 = 49.995 → 50.00 (half-up)
  assert.equal(amountFor(101, 3349), 3382);    // 1.01 × 33.49 = 33.8249 → 33.82
  assert.equal(divRoundHalfUp(-5, 10), -1);    // symmetric half-up for negatives
});

test('formatRupees uses Indian grouping', () => {
  assert.equal(formatRupees(383151), '3,831.51');
  assert.equal(formatRupees(12345678901), '12,34,56,789.01');
  assert.equal(formatRupees(5), '0.05');
  assert.equal(formatRupees(-195000, { symbol: true }), '-₹ 1,950.00');
});

test('fixed decimals for litres and fat/snf', () => {
  assert.equal(parseLitres('6.5'), 650);
  assert.equal(parseLitres('6.55'), 655);
  assert.equal(parseLitres('6.555'), null);
  assert.equal(parseTenths('4.1'), 41);
  assert.equal(parseTenths('4.15'), null);
  assert.equal(fmtLitres(1150), '11.50');
});

// ---------- rate lookup ----------
const chart = { id: 'c1', milkType: 'cow', effectiveFrom: '2026-11-01',
  fats: [30, 35, 40], snfs: [80, 85], rates: [[2800, 2900], [3000, 3100], [3200, null]] };

test('rate lookup: exact rule', () => {
  assert.deepEqual(lookupRate(chart, 35, 85, 'exact'), { ok: true, ratePaise: 3100, fatUsed: 35, snfUsed: 85 });
  assert.equal(lookupRate(chart, 36, 85, 'exact').reason, 'fat-not-on-grid');
});

test('rate lookup: nearest-lower rule', () => {
  assert.equal(lookupRate(chart, 39, 84, 'nearest-lower').ratePaise, 3000); // fat 3.5, snf 8.0
  assert.equal(lookupRate(chart, 40, 80, 'nearest-lower').ratePaise, 3200);
});

test('rate lookup: nearest rule, ties go lower', () => {
  assert.equal(lookupRate(chart, 38, 82, 'nearest').ratePaise, 3200);       // fat 3.8→4.0, snf 8.2→8.0
  assert.equal(lookupRate(chart, 38, 83, 'nearest').reason, 'blank-cell');  // snf 8.3→8.5, cell [4.0][8.5] blank
  assert.equal(lookupRate(chart, 33, 80, 'nearest').fatUsed, 35);           // 3.3: 3 vs 2 → 3.5
  assert.equal(lookupRate(chart, 32, 80, 'nearest').ratePaise, 2800);       // 3.2: 2 vs 3 → 3.0
  assert.equal(lookupRate({ ...chart, fats: [30, 40], rates: [[1, 2], [3, 4]] }, 35, 80, 'nearest').fatUsed, 30); // tie → lower
});

test('rate lookup: out of range, blank cell, missing chart', () => {
  assert.equal(lookupRate(chart, 29, 80).reason, 'fat-out-of-range');
  assert.equal(lookupRate(chart, 41, 80).reason, 'fat-out-of-range');
  assert.equal(lookupRate(chart, 35, 90).reason, 'snf-out-of-range');
  assert.equal(lookupRate(chart, 40, 85, 'exact').reason, 'blank-cell');
  assert.equal(lookupRate(null, 35, 85).reason, 'no-chart');
});

test('chart chosen by collection date (effective_from history)', () => {
  const charts = [
    { id: 'old', milkType: 'cow', effectiveFrom: '2026-10-01', createdAt: '1' },
    { id: 'new', milkType: 'cow', effectiveFrom: '2026-11-05', createdAt: '2' },
    { id: 'buf', milkType: 'buffalo', effectiveFrom: '2026-01-01', createdAt: '3' },
  ];
  assert.equal(chartFor(charts, 'cow', '2026-11-04').id, 'old');
  assert.equal(chartFor(charts, 'cow', '2026-11-05').id, 'new');
  assert.equal(chartFor(charts, 'buffalo', '2026-11-05').id, 'buf');
  assert.equal(chartFor(charts, 'cow', '2026-09-30'), null);
});

test('chart CSV round-trips and reports bad lines', () => {
  const csv = chartToCsv(chart);
  const back = parseChartCsv(csv);
  assert.equal(back.ok, true);
  assert.deepEqual(back.rates, chart.rates);
  assert.deepEqual(back.fats, chart.fats);
  assert.equal(parseChartCsv('FAT/SNF,8.0\n3.0,abc').line, 2);
  assert.equal(parseChartCsv('FAT/SNF,8.5,8.0\n3.0,1,2').error, 'not-ascending');
  const g = generateChart({ fatFrom: 30, fatTo: 31, snfFrom: 80, snfTo: 81, basePaise: 2800, fatStepPaise: 50, snfStepPaise: 20 });
  assert.deepEqual(g.rates, [[2800, 2820], [2850, 2870]]);
});

// ---------- collection rules ----------
test('duplicate entry blocked for same farmer/date/shift/milk type; same UUID is a retry', () => {
  const base = { centerId: 'c', farmerId: 'f1', date: '2026-11-08', shift: 'morning', milkType: 'cow' };
  const existing = [{ ...base, id: 'u1' }];
  assert.ok(findDuplicate(existing, { ...base, id: 'u2' }));
  assert.equal(findDuplicate(existing, { ...base, id: 'u1' }), null);
  assert.equal(findDuplicate(existing, { ...base, id: 'u2', shift: 'evening' }), null);
  assert.equal(findDuplicate(existing, { ...base, id: 'u2', milkType: 'buffalo' }), null);
  assert.equal(findDuplicate([{ ...base, id: 'u1', void: true }], { ...base, id: 'u2' }), null);
});

test('priceEntry validates and prices', () => {
  const ok = priceEntry({ litresX100: 650, fatX10: 35, snfX10: 85, milkType: 'cow', date: '2026-11-08' }, [chart], 'exact');
  assert.equal(ok.amountPaise, 20150);
  const bad = priceEntry({ litresX100: 0, fatX10: 35, snfX10: 85, milkType: 'cow', date: '2026-11-08' }, [chart], 'exact');
  assert.equal(bad.errors.litres, 'invalid');
});

// ---------- billing & deductions ----------
const e = (l, f, s, a) => ({ litresX100: l, fatX10: f, snfX10: s, amountPaise: a });

test('bill: net = gross − feed − advance − previous dues (matches bill sample)', () => {
  const b = computeBill({ entries: [e(11500, 41, 85, 383151)], feedPaise: 145000, advanceOutstandingPaise: 500000, advanceInstallmentPaise: 50000 });
  assert.equal(b.grossPaise, 383151);
  assert.equal(b.totalDeductPaise, 195000);
  assert.equal(b.netPaise, 188151);
  assert.equal(b.payablePaise, 188151);
  assert.equal(b.advanceRemainingPaise, 450000);
});

test('bill: advance installment limited by outstanding and by what is left', () => {
  assert.equal(computeBill({ entries: [e(100, 40, 85, 10000)], advanceOutstandingPaise: 3000, advanceInstallmentPaise: 5000 }).advancePaise, 3000);
  const b = computeBill({ entries: [e(100, 40, 85, 10000)], feedPaise: 8000, advanceOutstandingPaise: 50000, advanceInstallmentPaise: 5000 });
  assert.equal(b.advancePaise, 2000);
  assert.equal(b.netPaise, 0);
});

test('bill: negative net carries forward as dues', () => {
  const b = computeBill({ entries: [e(100, 40, 85, 10000)], feedPaise: 15000, previousDuesPaise: 1000, advanceOutstandingPaise: 9000, advanceInstallmentPaise: 500 });
  assert.equal(b.advancePaise, 0);
  assert.equal(b.netPaise, -6000);
  assert.equal(b.payablePaise, 0);
  assert.equal(b.carryForwardDuesPaise, 6000);
});

test('bill: litre-weighted averages', () => {
  const b = computeBill({ entries: [e(600, 40, 85, 20000), e(400, 45, 80, 14000)] });
  assert.equal(b.avgFatX100, 420); // (4.0×6 + 4.5×4)/10 = 4.20
  assert.equal(b.avgSnfX100, 830);
  assert.equal(b.avgRatePaise, 3400);
  assert.equal(computeBill({}).avgRatePaise, 0);
});

// ---------- cycles & dates ----------
test('bill cycles: 10-day thirds and 7-day weeks', () => {
  assert.deepEqual(cycleFor('2026-11-08', 10), { start: '2026-11-01', end: '2026-11-10' });
  assert.deepEqual(cycleFor('2026-11-20', 10), { start: '2026-11-11', end: '2026-11-20' });
  assert.deepEqual(cycleFor('2026-02-25', 10), { start: '2026-02-21', end: '2026-02-28' });
  assert.deepEqual(cycleFor('2026-11-08', 7, '2026-01-05'), { start: '2026-11-02', end: '2026-11-08' });
  assert.deepEqual(previousCycle({ start: '2026-11-01', end: '2026-11-10' }, 10), { start: '2026-10-21', end: '2026-10-31' });
  assert.throws(() => cycleFor('2026-11-08', 15));
});

test('dates: IST and DD/MM/YYYY', () => {
  assert.equal(fmtDate('2026-11-08'), '08/11/2026');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(todayIST(new Date('2026-11-07T19:00:00Z')), '2026-11-08'); // 00:30 IST
  assert.equal(parseDisplayDate('8/11/2026'), '2026-11-08');
  assert.equal(toMarathiDigits('₹ 1,881.51'), '₹ १,८८१.५१');
});

// ---------- messaging: SMS cap & outbox retry ----------
test('channel choice respects consent and WhatsApp availability', () => {
  const f = { active: true, consent: true, mobile: '9000000000', hasWhatsapp: true };
  assert.equal(chooseChannel(f), 'whatsapp');
  assert.equal(chooseChannel({ ...f, hasWhatsapp: false }), 'sms');
  assert.equal(chooseChannel({ ...f, consent: false }), null);
  assert.equal(chooseChannel({ ...f, active: false }), null);
});

test('SMS daily cap: counter resets per day; overflow deferred', () => {
  assert.deepEqual(smsAllowance({ date: '2026-11-08', sent: 94 }, '2026-11-08', 95), { sent: 94, remaining: 1 });
  assert.deepEqual(smsAllowance({ date: '2026-11-07', sent: 95 }, '2026-11-08', 95), { sent: 0, remaining: 95 });
  const msgs = [1, 2, 3].map((i) => ({ id: 's' + i, channel: 'sms', status: 'queued', createdAt: String(i) }))
    .concat([{ id: 'w1', channel: 'whatsapp', status: 'queued', createdAt: '4' }]);
  const r = selectDue(msgs, { nowMs: 0, today: '2026-11-08', smsCounter: { date: '2026-11-08', sent: 93 }, smsCap: 95 });
  assert.deepEqual(r.send.map((m) => m.id), ['s1', 's2', 'w1']);
  assert.deepEqual(r.defer.map((m) => m.id), ['s3']);
  const d = deferToNextDay(r.defer[0], '2026-11-08');
  assert.equal(d.status, 'deferred');
  assert.equal(d.nextAttemptAt, istMidnightMs('2026-11-09'));
});

test('outbox retry: backoff, WhatsApp→SMS fallback, give up after max attempts', () => {
  assert.equal(backoffMs(1), 60000);
  assert.equal(backoffMs(3), 240000);
  assert.equal(backoffMs(20), 3600000);
  let m = { id: 'm', channel: 'whatsapp', status: 'queued', attempts: 0 };
  m = afterFailure(m, { nowMs: 1000, error: 'x' });
  assert.equal(m.status, 'queued'); assert.equal(m.nextAttemptAt, 61000);
  m = afterFailure(m, { nowMs: 1000 });
  m = afterFailure(m, { nowMs: 1000 });
  assert.equal(m.channel, 'sms'); assert.equal(m.fellBack, true); assert.equal(m.attempts, 0);
  for (let i = 0; i < 6; i++) m = afterFailure(m, { nowMs: 1000 });
  assert.equal(m.status, 'failed');
  const notDue = selectDue([{ id: 'x', channel: 'sms', status: 'queued', nextAttemptAt: 5000, createdAt: '1' }], { nowMs: 1000, today: 't', smsCap: 95 });
  assert.equal(notDue.send.length, 0);
});
