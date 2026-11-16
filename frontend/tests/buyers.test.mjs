// Daily milk buyers (D-51): roles, daily sheet, rates kept per entry, monthly account, closed months, payments.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const { todayIST, addDays } = await import('../public/src/lib/dates.js');
const { amountFor } = await import('../public/src/lib/money.js');
const today = todayIST();
const month = today.slice(0, 7);

test('operator fills the daily sheet; amounts use the rate, unchanged rows are not re-saved', async () => {
  await api.login('u-op1', '1111');
  const day = await api.buyerDay({ date: today, shift: 'morning' });
  assert.ok(day.rows.length >= 6);
  const r = await api.saveBuyerDay({ date: today, shift: 'morning', rows: day.rows.map((x) => ({ buyerId: x.buyer.id, litresX100: x.sale ? x.sale.litresX100 : x.usualX100 })) });
  const again = await api.saveBuyerDay({ date: today, shift: 'morning', rows: day.rows.map((x) => ({ buyerId: x.buyer.id, litresX100: x.sale ? x.sale.litresX100 : x.usualX100 })) });
  assert.equal(again.changed, 0, 'saving the same sheet twice changes nothing');
  assert.ok(r.changed >= 0);
  const after = await api.buyerDay({ date: today, shift: 'morning' });
  for (const x of after.rows.filter((y) => y.sale)) assert.equal(x.sale.amountPaise, amountFor(x.sale.litresX100, x.sale.ratePaise));
});

test('operator cannot see accounts, change buyers or record payments; future dates refused', async () => {
  await assert.rejects(api.buyerMonth(month), { code: 'forbidden' });
  await assert.rejects(api.saveBuyer({ name: 'x', milkType: 'cow', ratePaise: 5000, morningX100: 100, eveningX100: 0 }), { code: 'forbidden' });
  await assert.rejects(api.addBuyerPayment({ buyerId: 'g1', date: today, mode: 'cash', amountPaise: 100 }), { code: 'forbidden' });
  await assert.rejects(api.saveBuyerDay({ date: addDays(today, 1), shift: 'morning', rows: [] }), { code: 'invalid-date' });
  await api.logout();
});

test('a new rate applies to new entries only; month account adds up; payments reduce the balance', async () => {
  await api.login('u-owner', '1234');
  const b = (await api.buyers()).find((x) => x.id === 'g1');
  const yesterday = addDays(today, -1);
  const before = (await api.buyerDay({ date: yesterday, shift: 'morning' })).rows.find((x) => x.buyer.id === 'g1').sale;
  await api.saveBuyer({ ...b, ratePaise: b.ratePaise + 200 });
  const kept = (await api.buyerDay({ date: yesterday, shift: 'morning' })).rows.find((x) => x.buyer.id === 'g1').sale;
  if (before) assert.equal(kept.ratePaise, before.ratePaise, 'earlier entry keeps its rate');
  const m = await api.buyerMonth(month);
  for (const r of m.rows) assert.equal(r.closingPaise, r.openingPaise + r.amountPaise - r.paidPaise);
  const row = m.rows.find((r) => r.buyer.id === 'g1');
  await api.addBuyerPayment({ buyerId: 'g1', date: today, mode: 'upi', amountPaise: 10000, upiRef: 'UTR1' });
  const m2 = await api.buyerMonth(month);
  assert.equal(m2.rows.find((r) => r.buyer.id === 'g1').closingPaise, row.closingPaise - 10000);
  await assert.rejects(api.addBuyerPayment({ buyerId: 'g1', date: today, mode: 'upi', amountPaise: 100 }), { code: 'upi-ref-required' });
  const st = await api.buyerStatement({ buyerId: 'g1', month });
  assert.equal(st.amountPaise, st.days.reduce((s, d) => s + d.amountPaise, 0));
});

test('closed months are locked; the current month cannot be closed', async () => {
  const closed = (await api.buyerMonth(addDays(today.slice(0, 8) + '01', -40).slice(0, 7)));
  assert.ok(closed.closed, 'older demo months are closed');
  await assert.rejects(api.saveBuyerDay({ date: closed.first, shift: 'morning', rows: [{ buyerId: 'g1', litresX100: 100 }] }), { code: 'month-locked' });
  await assert.rejects(api.closeBuyerMonth(month), { code: 'month-not-over' });
});

test('dashboard: buyer sales count as milk that left the center', async () => {
  const d = await api.dashboard({ from: addDays(today, -20), to: addDays(today, -1) });
  const shrink = d.collectedX100 - d.dispatchedX100 - d.buyerSoldX100 - d.counterSoldX100;
  assert.ok(d.buyerSoldX100 > 0);
  assert.ok(shrink >= 0 && shrink < d.collectedX100 * 0.01, 'shrinkage stays under 1 % once buyer and walk-in sales are counted');
});
