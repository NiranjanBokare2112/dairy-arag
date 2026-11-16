// D-86: the owner chooses which tabs an operator may use; the API refuses writes in other tabs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const { allowedFor, navFor } = await import('../public/src/core/nav.js');
const { todayIST } = await import('../public/src/lib/dates.js');

test('operator limited to दूध संकलन + दूध ग्राहक', async () => {
  await api.login('u-owner', '1234');
  const op = (await api.staff()).find((u) => u.id === 'u-op1');
  const saved = await api.saveUser({ id: op.id, name: op.name, mobile: op.mobile, active: true, pages: ['/buyers'] });
  assert.deepEqual(saved.pages.sort(), ['/buyers', '/collection']);
  await api.logout();
  await api.login('u-op1', '1111');
  const me = await api.me();
  assert.ok(allowedFor(me, '/collection') && allowedFor(me, '/buyers'));
  assert.ok(!allowedFor(me, '/ledger') && !allowedFor(me, '/dispatch'));
  assert.deepEqual(navFor(me).map((n) => n.path).sort(), ['/buyers', '/collection', '/help']); // मदत is always there (D-109)
  await assert.rejects(api.addAdvance({ farmerId: 'f101', amountPaise: 10000, installmentPaise: 5000, date: todayIST() }), { code: 'page-not-allowed' });
  await assert.rejects(api.broadcast({ text: 'x' }), { code: 'page-not-allowed' });
  await api.logout();
  // owner gives everything back
  await api.login('u-owner', '1234');
  const back = await api.saveUser({ id: op.id, name: op.name, mobile: op.mobile, active: true, pages: ['/ledger', '/farmers', '/dispatch', '/buyers', '/messages'] });
  assert.equal(back.pages.length, 6);
  await api.logout();
});
