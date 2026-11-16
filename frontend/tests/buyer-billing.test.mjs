// D-87: daily milk buyers — start date and payment schedule (month end, or a fixed day each month).
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const { buyerCycle, prevCycle } = await import('../public/src/lib/buyerbill.js');
const { todayIST, addDays } = await import('../public/src/lib/dates.js');

test('bill periods', () => {
  assert.deepEqual(buyerCycle({ kind: 'day', day: 10 }, '2026-11-13'), { start: '2026-11-10', end: '2026-12-09', due: '2026-12-10' });
  assert.deepEqual(buyerCycle({ kind: 'day', day: 10 }, '2026-11-09'), { start: '2026-10-10', end: '2026-11-09', due: '2026-11-10' });
  assert.deepEqual(buyerCycle({ kind: 'day', day: 10 }, '2026-01-05'), { start: '2025-12-10', end: '2026-01-09', due: '2026-01-10' });
  assert.deepEqual(buyerCycle({ kind: 'month-end' }, '2026-02-14'), { start: '2026-02-01', end: '2026-02-28', due: '2026-02-28' });
  assert.deepEqual(prevCycle({ kind: 'month-end' }, buyerCycle({ kind: 'month-end' }, '2026-03-02')).start, '2026-02-01');
});

test('a new buyer paying on the 10th: start date, sheet, dues', async () => {
  await api.login('u-owner', '1234');
  const today = todayIST();
  let start = addDays(today, -25); // inside an open (not closed) month
  if ((await api.buyerDay({ date: start, shift: 'morning' })).locked) start = today.slice(0, 7) + '-01';
  await assert.rejects(api.saveBuyer({ name: 'x', milkType: 'cow', ratePaise: 6000, morningX100: 100, eveningX100: 0, billing: { kind: 'day', day: 31 } }), { code: 'invalid-bill-day' });
  const b = await api.saveBuyer({ name: 'नवीन हॉटेल', milkType: 'cow', ratePaise: 6000, morningX100: 200, eveningX100: 0, startDate: start, billing: { kind: 'day', day: 10 } });
  // not on the sheet before the start date; entries before it are refused
  assert.ok(!(await api.buyerDay({ date: addDays(start, -1), shift: 'morning' })).rows.some((r) => r.buyer.id === b.id));
  assert.ok((await api.buyerDay({ date: start, shift: 'morning' })).rows.some((r) => r.buyer.id === b.id));
  await assert.rejects(api.saveBuyerDay({ date: addDays(start, -1), shift: 'morning', rows: [{ buyerId: b.id, litresX100: 200 }] }), { code: 'before-start' });
  // 2 L every morning from the start date to today
  for (let d = start; d <= today; d = addDays(d, 1)) await api.saveBuyerDay({ date: d, shift: 'morning', rows: [{ buyerId: b.id, litresX100: 200 }] });
  const row = (await api.buyers()).find((x) => x.id === b.id);
  const last = prevCycle({ kind: 'day', day: 10 }, buyerCycle({ kind: 'day', day: 10 }, today));
  let days = 0; for (let d = start; d <= last.end; d = addDays(d, 1)) days++;
  assert.equal(row.bill.duePaise, days * 12000, 'due = milk of finished periods (2 L × ₹60 a day)');
  assert.equal(row.bill.dueDate, last.due);
  assert.equal(row.bill.overdue, today > last.due);
  // paying it clears the due
  await api.addBuyerPayment({ buyerId: b.id, date: today, mode: 'cash', amountPaise: row.bill.duePaise });
  assert.equal((await api.buyers()).find((x) => x.id === b.id).bill.duePaise, 0);
  // statement of the buyer's own period
  const st = await api.buyerStatement({ buyerId: b.id, from: last.start, to: last.end });
  assert.equal(st.first, last.start); assert.equal(st.last, last.end);
  // the start date cannot move after milk already recorded
  await assert.rejects(api.saveBuyer({ ...b, startDate: addDays(start, 5) }), { code: 'start-after-sales' });
  await api.logout();
});
