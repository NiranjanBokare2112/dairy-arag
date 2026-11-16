// D-69: the operator can add a new farmer; editing an existing farmer stays with the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');

test('operator adds a new farmer; an edit waits for the owner (D-108)', async () => {
  await api.login('u-op1', '1111');
  const code = await api.nextFarmerCode();
  const f = await api.saveFarmer({ code, name: 'नवीन शेतकरी', village: 'आरग', mobile: '', milkTypes: ['cow'], aadhaar: '512345678901', active: true });
  assert.equal(f.code, code);
  assert.equal(f.aadhaarLast4, '8901');
  assert.equal('aadhaar' in f, false);
  const r = await api.saveFarmer({ ...f, id: f.id, name: 'बदल' });
  assert.equal(r.pendingRequest.status, 'pending'); assert.notEqual((await api.farmer(f.id)).name, 'बदल', 'not applied before approval');
  await assert.rejects(api.saveFarmer({ code: code + 1, name: 'x', milkTypes: ['cow'] }), { code: 'aadhaar-required' });
  await assert.rejects(api.saveFarmer({ code, name: 'y', milkTypes: ['cow'], aadhaar: '512345678902' }), { code: 'duplicate-code' });
  const log = (await (async () => { await api.logout(); await api.login('u-owner', '1234'); return api.audit({ limit: 50 }); })()).find((a) => a.entity === 'farmer' && a.entityId === f.id);
  assert.equal(log.userId, 'u-op1');
  assert.equal(log.action, 'create');
  // the owner still edits
  const g = await api.saveFarmer({ ...f, id: f.id, name: 'बदललेले नाव' });
  assert.equal(g.name, 'बदललेले नाव');
  await api.logout();
});
