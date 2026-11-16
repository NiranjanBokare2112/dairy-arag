// Owner's price change: effective date, "today only", quick ₹ adjustment, re-pricing of recorded entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartFor, adjustChart } from '../public/src/lib/rates.js';

test('chartFor honours effectiveTo ("today only" prices fall back next day)', () => {
  const base = { id: 'base', milkType: 'cow', effectiveFrom: '2026-10-01', createdAt: '1' };
  const oneDay = { id: 'day', milkType: 'cow', effectiveFrom: '2026-11-08', effectiveTo: '2026-11-08', createdAt: '2' };
  const later = { id: 'later', milkType: 'cow', effectiveFrom: '2026-11-10', createdAt: '3' };
  const charts = [base, oneDay, later];
  assert.equal(chartFor(charts, 'cow', '2026-11-07').id, 'base');
  assert.equal(chartFor(charts, 'cow', '2026-11-08').id, 'day');
  assert.equal(chartFor(charts, 'cow', '2026-11-09').id, 'base');
  assert.equal(chartFor(charts, 'cow', '2026-11-10').id, 'later');
});

test('a newer change on the same date wins', () => {
  const a = { id: 'a', milkType: 'cow', effectiveFrom: '2026-11-08', createdAt: '1' };
  const b = { id: 'b', milkType: 'cow', effectiveFrom: '2026-11-08', effectiveTo: '2026-11-08', createdAt: '2' };
  assert.equal(chartFor([a, b], 'cow', '2026-11-08').id, 'b');
  assert.equal(chartFor([a, b], 'cow', '2026-11-09').id, 'a');
});

test('adjustChart adds/subtracts a fixed amount per litre, keeps blanks, refuses ≤ ₹0', () => {
  const c = { fats: [30, 35], snfs: [80, 85], rates: [[2800, null], [3000, 3100]] };
  assert.deepEqual(adjustChart(c, 100).rates, [[2900, null], [3100, 3200]]);
  assert.deepEqual(adjustChart(c, -50).rates, [[2750, null], [2950, 3050]]);
  assert.equal(adjustChart(c, -2800).error, 'rate-too-low');
  assert.deepEqual(c.rates, [[2800, null], [3000, 3100]], 'original untouched');
});

// ---------- end-to-end through the mock API (browser storage shimmed) ----------
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const { todayIST, addDays } = await import('../public/src/lib/dates.js');

test('price change from a past date re-prices open entries only, and can be previewed first', async () => {
  await api.login('u-owner', '1234');
  const today = todayIST();
  const from = await api.firstOpenDate();           // first day after the finalized cycle
  const cur = await api.chartOn('cow', today);
  const grid = adjustChart(cur, 100);                // +₹1.00 / litre
  const before = await api.collections({ from, to: today });
  const cowBefore = before.filter((e) => e.milkType === 'cow');
  const lockedDay = addDays(from, -1);
  const lockedBefore = (await api.collections({ date: lockedDay })).filter((e) => e.milkType === 'cow');

  const preview = await api.previewRateChange({ milkType: 'cow', effectiveFrom: from, ...grid });
  assert.equal(preview.count, cowBefore.length);
  assert.ok(preview.changed > 0);
  const litres = cowBefore.reduce((s, e) => s + e.litresX100, 0);
  // +100 paise/L ≈ +litres (rounding per entry can move it by ≤ ½ paisa each)
  assert.ok(Math.abs(preview.afterPaise - preview.beforePaise - litres) <= cowBefore.length);
  assert.equal((await api.collections({ from, to: today })).filter((e) => e.milkType === 'cow')[0].amountPaise,
    cowBefore[0].amountPaise, 'preview changes nothing');

  const saved = await api.saveChart({ milkType: 'cow', effectiveFrom: from, ...grid, note: '+1', reprice: true });
  assert.equal(saved.repriced.changed, preview.changed);
  const after = (await api.collections({ from, to: today })).filter((e) => e.milkType === 'cow');
  const sumAfter = after.reduce((s, e) => s + e.amountPaise, 0);
  assert.equal(sumAfter, preview.afterPaise);
  const e0 = after.find((e) => e.id === cowBefore[0].id);
  assert.equal(e0.ratePaise, cowBefore[0].ratePaise + 100);
  // finalized cycle untouched; buffalo untouched
  const lockedAfter = (await api.collections({ date: lockedDay })).filter((e) => e.milkType === 'cow');
  assert.deepEqual(lockedAfter.map((e) => e.amountPaise), lockedBefore.map((e) => e.amountPaise));
  const audits = await api.audit({ limit: 1000 });
  assert.ok(audits.some((a) => a.action === 'reprice'));
});

test('"today only" price: applies today, previous price returns tomorrow; cannot start in a finalized cycle', async () => {
  const today = todayIST();
  const cur = await api.chartOn('buffalo', today);
  const grid = adjustChart(cur, 200);
  await api.saveChart({ milkType: 'buffalo', effectiveFrom: today, effectiveTo: today, ...grid, reprice: true });
  assert.equal((await api.chartOn('buffalo', today)).effectiveTo, today);
  assert.equal((await api.chartOn('buffalo', addDays(today, 1))).id, cur.id);
  const q = await api.quote({ milkType: 'buffalo', date: today, litresX100: 100, fatX10: 65, snfX10: 90 });
  const qTomorrow = await api.quote({ milkType: 'buffalo', date: addDays(today, 1), litresX100: 100, fatX10: 65, snfX10: 90 });
  assert.equal(q.ratePaise - qTomorrow.ratePaise, 200);
  const locked = addDays(await api.firstOpenDate(), -1);
  await assert.rejects(api.saveChart({ milkType: 'cow', effectiveFrom: locked, ...grid }), (e) => e.code === 'cycle-locked');
  await assert.rejects(api.saveChart({ milkType: 'cow', effectiveFrom: today, effectiveTo: addDays(today, -1), ...grid }), (e) => e.code === 'invalid');
});
