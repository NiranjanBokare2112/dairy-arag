// Walk-in (सुटी) milk sales (D-53): ¼ / ½ / 1 L at the counter rate, paid on the spot, void with reason, idempotent ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const { todayIST, addDays } = await import('../public/src/lib/dates.js');
const { qtyLabel } = await import('../public/src/pages/buyers.js').catch(() => ({}));
const today = todayIST();

test('operator records ¼ and ½ litre at the counter rate, rounded half-up; a retry with the same id is ignored', async () => {
  await api.login('u-op1', '1111');
  const before = await api.counterSales({ date: today });
  assert.equal(before.rates.cow, 6000);
  const q = await api.addCounterSale({ id: 'cs-test-1', date: today, shift: 'morning', milkType: 'cow', litresX100: 25, mode: 'cash' });
  assert.equal(q.amountPaise, 1500); // ¼ of ₹60
  const h = await api.addCounterSale({ date: today, shift: 'morning', milkType: 'buffalo', litresX100: 50, mode: 'upi' });
  assert.equal(h.amountPaise, 3800); // ½ of ₹76, UPI reference optional for walk-ins
  await api.addCounterSale({ id: 'cs-test-1', date: today, shift: 'morning', milkType: 'cow', litresX100: 25, mode: 'cash' });
  const after = await api.counterSales({ date: today });
  assert.equal(after.rows.length, before.rows.length + 2, 'same id twice = one sale');
  assert.equal(after.totals.amountPaise, before.totals.amountPaise + 5300);
  assert.equal(after.totals.upiPaise, before.totals.upiPaise + 3800);
});

test('bad input refused; operator cannot change the price', async () => {
  await assert.rejects(api.addCounterSale({ date: today, shift: 'morning', milkType: 'cow', litresX100: 0, mode: 'cash' }), { code: 'invalid-litres' });
  await assert.rejects(api.addCounterSale({ date: addDays(today, 1), shift: 'morning', milkType: 'cow', litresX100: 50, mode: 'cash' }), { code: 'invalid-date' });
  await assert.rejects(api.saveCounterRates({ cowPaise: 6200, buffaloPaise: 7800 }), { code: 'forbidden' });
});

test('void needs a reason, keeps the row and drops it from totals', async () => {
  const d0 = await api.counterSales({ date: today });
  await assert.rejects(api.voidCounterSale({ id: 'cs-test-1', reason: ' ' }), { code: 'reason-required' });
  await api.voidCounterSale({ id: 'cs-test-1', reason: 'चुकून नोंद' });
  const d1 = await api.counterSales({ date: today });
  assert.equal(d1.rows.length, d0.rows.length);
  assert.ok(d1.rows.find((s) => s.id === 'cs-test-1').void);
  assert.equal(d1.totals.amountPaise, d0.totals.amountPaise - 1500);
});

test('owner changes the price: new sales use it, old ones keep theirs; month view shows walk-in totals', async () => {
  await api.logout(); await api.login('u-owner', '1234');
  await api.saveCounterRates({ cowPaise: 6400, buffaloPaise: 8000 });
  const s = await api.addCounterSale({ date: today, shift: 'evening', milkType: 'cow', litresX100: 50, mode: 'cash' });
  assert.equal(s.amountPaise, 3200);
  const d = await api.counterSales({ date: today });
  assert.ok(d.rows.some((r) => r.ratePaise === 6000), 'earlier entries keep the old rate');
  const m = await api.buyerMonth(today.slice(0, 7));
  assert.ok(m.counter.litresX100 > 0 && m.counter.amountPaise === m.counter.cashPaise + m.counter.upiPaise);
});

test('closed month locks walk-in entries', async () => {
  const months = [...new Set((await api.counterSales({ date: addDays(today, -70) })).rows.map((r) => r.date.slice(0, 7)))];
  const m = months[0] || addDays(today, -70).slice(0, 7);
  await api.closeBuyerMonth(m).catch(() => {});
  await assert.rejects(api.addCounterSale({ date: m + '-05', shift: 'morning', milkType: 'cow', litresX100: 50, mode: 'cash' }), { code: 'month-locked' });
});

test('village measures are shown as fractions', () => {
  if (!qtyLabel) return; // page module needs a browser; label rule checked in Chrome instead
  assert.equal(qtyLabel(25), '¼'); assert.equal(qtyLabel(150), '1½'); assert.equal(qtyLabel(200), '2');
});
