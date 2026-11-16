// D-71: government schemes: owner manages them; the website sees published ones until their last date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const { todayIST, addDays } = await import('../public/src/lib/dates.js');

test('schemes: owner adds, hides, deletes; website shows only live ones', async () => {
  const today = todayIST();
  const before = (await api.schemes()).length; // public: no login needed
  await api.login('u-owner', '1234');
  const s = await api.saveScheme({ title: 'चाचणी योजना', summary: 'माहिती', lastDate: addDays(today, 5), link: 'https://example.gov.in/x', published: true });
  assert.equal((await api.schemes()).length, before + 1);
  await api.saveScheme({ ...s, published: false });
  assert.equal((await api.schemes()).length, before);
  await api.saveScheme({ ...s, published: true, lastDate: addDays(today, -1) }); // last date passed: hidden on the site
  assert.equal((await api.schemes()).length, before);
  assert.ok((await api.schemes({ all: true })).some((x) => x.id === s.id)); // still on the owner page
  await assert.rejects(api.saveScheme({ title: '', summary: 'x' }), { code: 'scheme-title-required' });
  await assert.rejects(api.saveScheme({ title: 'x', summary: 'y', link: 'not a link' }), { code: 'invalid-link' });
  await api.deleteScheme(s.id);
  assert.ok(!(await api.schemes({ all: true })).some((x) => x.id === s.id));
  await api.logout();
  await api.login('u-op1', '1111');
  await assert.rejects(api.saveScheme({ title: 'x', summary: 'y' }), { code: 'forbidden' });
  await assert.rejects(api.schemes({ all: true }), { code: 'forbidden' });
  await api.logout();
});
