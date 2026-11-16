// D-83 / D-88: veterinary doctors — owner manages; only logged-in farmers (and staff) see the shown ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');

test('doctors: owner adds, hides, deletes; farmers see only shown ones; not public (D-88)', async () => {
  await assert.rejects(api.doctors(), { code: 'unauthenticated' }); // the public website cannot read them
  await api.login('u-owner', '1234');
  const before = (await api.doctors()).length;
  const d = await api.saveDoctor({ name: 'डॉ. चाचणी', kind: 'govt', mobile: '9876543210', published: true });
  assert.equal((await api.doctors()).length, before + 1);
  await api.saveDoctor({ ...d, published: false });
  assert.equal((await api.doctors()).length, before);
  await assert.rejects(api.saveDoctor({ name: '' }), { code: 'doctor-name-required' });
  await assert.rejects(api.saveDoctor({ name: 'x', mobile: '12345' }), { code: 'invalid-mobile' });
  await api.deleteDoctor(d.id);
  assert.ok(!(await api.doctors({ all: true })).some((x) => x.id === d.id));
  await api.logout();
  await api.login('u-op1', '1111');
  await assert.rejects(api.saveDoctor({ name: 'x' }), { code: 'forbidden' });
  await api.logout();
  // a farmer (code login) sees the doctors and schemes
  await api.farmerLogin(101);
  assert.ok((await api.doctors()).length >= 1);
  assert.ok((await api.schemes()).length >= 1);
  await api.logout();
});
