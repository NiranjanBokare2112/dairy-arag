// D-126: centre expenses — spreading monthly costs, totals, reminders, operator changes through the owner, net profit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { expenseShare, expenseTotals, autoCosts, monthlyDue, expenseError } = await import('../public/src/lib/expenses.js');
const { api } = await import('../public/src/api/mock.js');
const { todayIST } = await import('../public/src/lib/dates.js');

const rent = { categoryId: 'ec-rent', amountPaise: 600000, period: 'month', date: '2026-11-01' }; // ₹6,000 for November (30 days)

test('a one-time expense counts only on its date', () => {
  const e = { categoryId: 'ec-chem', amountPaise: 64000, period: 'once', date: '2026-11-18' };
  assert.equal(expenseShare(e, '2026-11-18', '2026-11-18'), 64000);
  assert.equal(expenseShare(e, '2026-11-01', '2026-11-17'), 0);
  assert.equal(expenseShare({ ...e, void: true }, '2026-11-18', '2026-11-18'), 0);
});

test('a monthly expense is spread over its month; the full month is exact', () => {
  assert.equal(expenseShare(rent, '2026-11-15', '2026-11-15'), 20000);      // ₹200 a day
  assert.equal(expenseShare(rent, '2026-11-09', '2026-11-15'), 140000);     // 7 days
  assert.equal(expenseShare(rent, '2026-11-01', '2026-11-30'), 600000);     // whole month
  assert.equal(expenseShare(rent, '2026-10-20', '2026-12-10'), 600000);     // range wider than the month
  assert.equal(expenseShare(rent, '2026-12-01', '2026-12-31'), 0);          // another month
  // rounding: ₹1,000 over 31 days, one day = 3225.8… → 3226 paise (half up)
  assert.equal(expenseShare({ ...rent, amountPaise: 100000, date: '2026-12-05' }, '2026-12-05', '2026-12-05'), 3226);
});

test('totals by category, largest first', () => {
  const t = expenseTotals([rent, { categoryId: 'ec-chem', amountPaise: 64000, period: 'once', date: '2026-11-15' }, { categoryId: 'ec-chem', amountPaise: 1000, period: 'once', date: '2026-11-15' }], '2026-11-15', '2026-11-15');
  assert.equal(t.totalPaise, 20000 + 65000);
  assert.deepEqual(t.byCategory.map((c) => [c.categoryId, c.paise, c.count]), [['ec-chem', 65000, 2], ['ec-rent', 20000, 1]]);
});

test('costs the app counts itself', () => {
  assert.deepEqual(autoCosts({ whatsappSent: 100, msgCostPaise: 13, payoutFeesPaise: 600, payoutCount: 3 }), { messagesPaise: 1300, whatsappSent: 100, payoutFeesPaise: 600, payoutCount: 3, totalPaise: 1900 });
});

test('monthly reminders: last month entered, this month not yet', () => {
  const list = [{ ...rent, date: '2026-10-01', note: 'जागा' }, { ...rent, date: '2026-11-01', note: 'जागा' }, { categoryId: 'ec-power', amountPaise: 184000, period: 'month', date: '2026-10-10', note: 'वीज' }];
  assert.deepEqual(monthlyDue(list, '2026-11-15').map((e) => e.categoryId), ['ec-power']);
});

test('checks before saving', () => {
  const cats = [{ id: 'ec-rent' }];
  assert.equal(expenseError({ ...rent, mode: 'cash' }, { categories: cats, today: '2026-11-15' }), null);
  assert.equal(expenseError({ ...rent, mode: 'cash', amountPaise: 0 }, { categories: cats }), 'invalid-amount');
  assert.equal(expenseError({ ...rent, mode: 'cash', date: '2026-11-20' }, { categories: cats, today: '2026-11-15' }), 'invalid-date');
  assert.equal(expenseError({ ...rent, mode: 'cash', categoryId: 'x' }, { categories: cats }), 'invalid-category');
});

test('operator adds; an operator change or delete waits for the owner', async () => {
  const today = todayIST();
  await api.login('u-op1', '1111');
  const id = 'exp-test-1';
  const e = await api.addExpense({ id, date: today, categoryId: 'ec-clean', amountPaise: 25000, mode: 'cash', period: 'once', note: 'फिनाईल' });
  assert.equal(e.amountPaise, 25000);
  assert.equal((await api.addExpense({ id, date: today, categoryId: 'ec-clean', amountPaise: 25000, mode: 'cash', period: 'once' })).id, id, 'a retry does not add it twice');
  const q = await api.updateExpense({ id, changes: { amountPaise: 30000 } });
  assert.equal(q.queued, true); assert.equal(q.amountPaise, 25000, 'not changed yet');
  await assert.rejects(api.deleteExpense({ id, reason: 'चुकीची' }), { code: 'already-pending' });
  await api.login('u-owner', '1234');
  const reqs = await api.expenseRequests(); assert.ok(reqs.some((r) => r.id === id && r.pending.kind === 'edit'));
  const ok = await api.decideExpense({ id, ok: true }); assert.equal(ok.amountPaise, 30000); assert.equal(ok.pending, null);
  await assert.rejects(api.deleteExpense({ id, reason: ' ' }), { code: 'reason-required' });
  await api.deleteExpense({ id, reason: 'दोनदा नोंदले' });
  assert.ok(!(await api.expenses({ from: today, to: today })).some((x) => x.id === id), 'deleted expense is gone from the list');
});

test('the dashboard has the expenses for the range (net profit)', async () => {
  await api.login('u-owner', '1234');
  const today = todayIST();
  await api.addExpense({ date: today, categoryId: 'ec-chem', amountPaise: 50000, mode: 'cash', period: 'once', note: 'test' });
  const d = await api.dashboard({ from: today, to: today });
  const s = await api.expenseSummary({ from: today, to: today });
  assert.equal(d.expenses.totalPaise, s.totalPaise);
  assert.ok(d.expenses.totalPaise >= 50000);
  assert.equal(typeof d.autoCosts.totalPaise, 'number');
});

test('the खर्च list shows only expenses entered on the chosen days (D-128)', async () => {
  await api.login('u-owner', '1234');
  const today = todayIST();
  const first = today.slice(0, 8) + '01';
  if (first === today) return; // on the 1st every monthly one is dated today
  const list = await api.expenses({ from: today, to: today });
  assert.ok(list.every((e) => e.date === today), 'only today’s entries');
  assert.ok(!list.some((e) => e.categoryId === 'ec-rent' && e.date === first), 'this month’s rent (dated the 1st) is not in today’s list');
  const month = await api.expenses({ from: first, to: today });
  assert.ok(month.some((e) => e.categoryId === 'ec-rent'), 'but it is in the month’s list');
});
