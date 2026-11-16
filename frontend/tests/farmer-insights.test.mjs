// Farmer profile figures: totals, weighted Fat, profit vs dairy rate, bills list, owner-only profit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const { todayIST, addDays } = await import('../public/src/lib/dates.js');

test('30-day figures match the farmer\'s own entries', async () => {
  await api.login('u-owner', '1234');
  const today = todayIST(); const from = addDays(today, -29);
  const ins = await api.farmerInsights('f101');
  const rows = await api.collections({ farmerId: 'f101', from, to: today });
  const lit = rows.reduce((s, e) => s + e.litresX100, 0);
  assert.equal(ins.litresX100, lit);
  assert.equal(ins.amountPaise, rows.reduce((s, e) => s + e.amountPaise, 0));
  assert.equal(ins.morningX100 + ins.eveningX100, lit);
  assert.equal(ins.cowX100 + ins.buffaloX100, lit);
  const fat = Math.round(rows.reduce((s, e) => s + e.fatX10 * e.litresX100, 0) * 10 / lit);
  assert.equal(ins.avgFatX100, fat);
  assert.equal(ins.trend.length, 30);
  assert.equal(ins.trend.reduce((s, d) => s + d.litresX100, 0), lit);
});

test('profit (D-80) = dairy-chart value of each entry − amount paid to the farmer', async () => {
  const ins = await api.farmerInsights('f101');
  const today = todayIST(); const from = addDays(today, -29);
  const rows = await api.collections({ farmerId: 'f101', from, to: today });
  const { lookupRate } = await import('../public/src/lib/rates.js');
  const { amountFor } = await import('../public/src/lib/money.js');
  const center = await api.center();
  let rev = 0, cost = 0;
  for (const e of rows) {
    const ch = await api.chartOn(e.milkType, e.date, 'dairy');
    const r = lookupRate(ch, e.fatX10, e.snfX10, center.rateRule);
    rev += amountFor(e.litresX100, r.ratePaise); cost += e.amountPaise;
  }
  assert.equal(ins.profit.revenuePaise, rev);
  assert.equal(ins.profit.profitPaise, rev - cost);
  assert.equal(ins.profit.coveredX100, ins.litresX100, 'every entry has a dairy rate');
  assert.ok(ins.profit.profitPaise > 0, 'the demo dairy chart pays ₹2/L more than the farmer chart');
});

test('dairy charts never price farmer entries, and saving one does not re-price milk', async () => {
  const farmer = await api.chartOn('cow', todayIST());
  const dairy = await api.chartOn('cow', todayIST(), 'dairy');
  assert.equal(farmer.side, 'farmer'); assert.equal(dairy.side, 'dairy');
  const q = await api.quote({ milkType: 'cow', date: todayIST(), litresX100: 100, fatX10: 40, snfX10: 85 });
  const qd = await api.quote({ milkType: 'cow', date: todayIST(), litresX100: 100, fatX10: 40, snfX10: 85, side: 'dairy' });
  assert.equal(q.chartId, farmer.id); assert.equal(qd.chartId, dairy.id); assert.ok(qd.ratePaise > q.ratePaise);
  const before = (await api.collections({ date: todayIST() })).map((e) => e.amountPaise).join();
  const saved = await api.saveChart({ side: 'dairy', milkType: 'cow', effectiveFrom: todayIST(), fats: dairy.fats, snfs: dairy.snfs, rates: dairy.rates.map((r) => r.map((x) => x + 100)), reprice: true });
  assert.equal(saved.repriced, null);
  assert.equal((await api.collections({ date: todayIST() })).map((e) => e.amountPaise).join(), before, 'farmer amounts unchanged');
  assert.equal((await api.charts({ side: 'dairy' }))[0].id, saved.id);
  assert.ok(!(await api.charts()).some((c) => c.side === 'dairy'), 'the default list is farmer charts only');
});

test('bills: newest first, at most 7, with payment status; operators never see profit', async () => {
  const ins = await api.farmerInsights('f101');
  assert.ok(ins.bills.length <= 7);
  for (let i = 1; i < ins.bills.length; i++) assert.ok(ins.bills[i - 1].start > ins.bills[i].start);
  const paid = ins.bills.find((b) => b.paidPaise > 0);
  if (paid) assert.ok(paid.lastPayment?.date);
  await api.logout(); await api.login('u-op1', '1111');
  assert.equal((await api.farmerInsights('f101')).profit, null);
});

test('dashboard suppliers: profit matches the farmer profile, due = advance + unbilled feed', async () => {
  await api.logout(); await api.login('u-owner', '1234');
  const today = todayIST(); const from = addDays(today, -29);
  const d = await api.dashboard({ from, to: today });
  for (const r of [...d.top, ...d.low]) {
    assert.equal(r.receivablePaise, r.advancePaise + r.feedPaise);
    // side-panel figures (D-60): splits add up to the total, fat/SNF present
    assert.equal(r.cowX100 + r.buffaloX100, r.litresX100);
    assert.equal(r.morningX100 + r.eveningX100, r.litresX100);
    assert.ok(r.avgFatX100 > 0 && r.avgSnfX100 > 0);
    const ins = await api.farmerInsights(r.farmer.id);
    assert.equal(r.profitPaise, ins.profit.profitPaise);
  }
});

test('a bill never recovers an advance given after its period (D-50)', async () => {
  await api.logout(); await api.login('u-owner', '1234');
  const advances = await api.advances();
  const bills = await api.bills({});
  for (const b of bills.filter((x) => x.advancePaise > 0)) {
    assert.ok(advances.some((a) => a.farmerId === b.farmerId && a.date <= b.end), `bill ${b.no} deducts an advance given after ${b.end}`);
  }
  // every advance is recovered at most once in full
  for (const f of new Set(advances.map((a) => a.farmerId))) {
    const given = advances.filter((a) => a.farmerId === f).reduce((s, a) => s + a.amountPaise, 0);
    const recovered = bills.filter((b) => b.farmerId === f).reduce((s, b) => s + b.advancePaise, 0);
    assert.ok(recovered <= given);
  }
});
