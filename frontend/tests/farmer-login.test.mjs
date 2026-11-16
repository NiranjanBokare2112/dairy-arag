// Farmer login by code (D-47): own data only, read-only, masked contact details, wrong-code limit, logged.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const { todayIST } = await import('../public/src/lib/dates.js');

test('a valid code logs in as that farmer and shows only their own data', async () => {
  const me = await api.farmerLogin('101');
  assert.equal(me.role, 'farmer');
  assert.equal(me.code, 101);
  const d = await api.myDetails();
  assert.equal(d.farmer.code, 101);
  assert.match(d.farmer.mobileMasked, /^\d{2}X{6}\d{2}$/);
  assert.ok(!('mobile' in d.farmer) && !('upiId' in d.farmer), 'full mobile / UPI are not sent');
  assert.ok(!('profit' in d) && !('profit' in d.summary), 'farmers never see the center profit');
  assert.ok(d.entries.every((e) => e.farmerId === me.farmerId));
  assert.ok(d.today.every((e) => e.date === todayIST()));
  assert.ok(d.bills.filter((b) => b.status === 'final').every((b) => b.token), 'final bills carry the public bill link');
});

test('date filter: default 30 days, custom range, and since the beginning', async () => {
  const today = todayIST();
  const d30 = await api.myDetails();
  assert.equal(d30.range.to, today); assert.equal(d30.range.days, 30); assert.equal(d30.trend.length, 30);
  assert.equal(d30.summary.litresX100, d30.entries.reduce((s, e) => s + e.litresX100, 0));
  assert.equal(d30.summary.litresX100, d30.trend.reduce((s, x) => s + x.litresX100, 0));
  const all = await api.myDetails({ all: true });
  assert.equal(all.range.from, all.firstDate); assert.ok(all.range.all);
  assert.ok(all.entries.length >= d30.entries.length);
  assert.equal(all.entries.at(-1).date, all.firstDate, 'oldest entry is the first date');
  const one = await api.myDetails({ from: all.firstDate, to: all.firstDate });
  assert.equal(one.range.days, 1);
  assert.ok(one.entries.every((e) => e.date === all.firstDate));
  assert.ok(one.bills.every((b) => b.end >= all.firstDate && b.start <= all.firstDate), 'only bills overlapping the range');
  const future = await api.myDetails({ from: today, to: '2099-01-01' });
  assert.equal(future.range.to, today, 'never past today');
});

test('a farmer cannot read another farmer or use staff functions', async () => {
  const other = (await api.myDetails()).farmer.id === 'f102' ? 'f101' : 'f102';
  await assert.rejects(api.farmerInsights(other), { code: 'forbidden' });
  await assert.rejects(api.collections({ date: todayIST() }), { code: 'unauthenticated' });
  await assert.rejects(api.dashboard({}), { code: 'unauthenticated' });
  await assert.rejects(api.addCollection({ id: 'x', farmerId: 'f101', date: todayIST(), shift: 'morning', milkType: 'cow', litresX100: 500, fatX10: 40, snfX10: 85 }));
});

test('logout ends the farmer session; login and logout are in the audit log', async () => {
  await api.logout();
  assert.equal(await api.me(), null);
  await assert.rejects(api.myDetails(), { code: 'unauthenticated' });
  await api.login('u-owner', '1234');
  const log = await api.audit({ actions: ['login', 'logout'] });
  assert.ok(log.some((a) => a.entity === 'farmer' && a.action === 'login' && a.after?.code === 101));
  assert.ok(log.some((a) => a.entity === 'farmer' && a.action === 'logout'));
  const hist = await api.loginHistory({});
  assert.ok(hist.sessions.every((s) => s.userId), 'staff login history lists staff sessions only');
  await api.logout();
});

test('unknown / inactive codes are refused, and 10 wrong codes pause farmer login', async () => {
  await assert.rejects(api.farmerLogin('999'), { code: 'farmer-code-not-found' });
  await assert.rejects(api.farmerLogin('abc'), { code: 'farmer-code-not-found' });
  for (let i = 0; i < 8; i++) await assert.rejects(api.farmerLogin(String(900 + i)), { code: 'farmer-code-not-found' });
  await assert.rejects(api.farmerLogin('101'), { code: 'too-many-attempts' });
});
