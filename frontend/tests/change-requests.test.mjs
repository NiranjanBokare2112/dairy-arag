// D-108: changes to a farmer's details by an operator or by the farmer wait for the owner's approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');

const byCode = async (code) => (await api.farmers({ includeInactive: true })).find((f) => f.code === code);

test("an operator's edit becomes a request; the owner approves it", async () => {
  await api.login('u-op1', '1111');
  const f = await byCode(106);
  const r = await api.saveFarmer({ ...f, mobile: '9876500106', village: 'बेडग', changeNote: 'शेतकऱ्याने नवीन नंबर दिला' });
  assert.equal(r.pendingRequest.status, 'pending');
  assert.equal((await byCode(106)).mobile, f.mobile, 'nothing changes yet');
  assert.deepEqual(Object.keys(r.pendingRequest.fields).sort(), ['mobile', 'village']);
  await assert.rejects(api.saveFarmer({ ...f }), { code: 'no-change' });
  await assert.rejects(api.saveFarmer({ ...f, mobile: '12345' }), { code: 'invalid-mobile' });
  await assert.rejects(api.decideChange(r.pendingRequest.id, true), { code: 'forbidden' });
  await api.logout();

  await api.login('u-owner', '1234');
  assert.ok((await api.dashboard({})).pendingChanges >= 1);
  const list = await api.changeRequests({ status: 'pending' });
  const req = list.find((x) => x.id === r.pendingRequest.id);
  assert.equal(req.byName, 'ऑपरेटर १');
  assert.equal((await api.farmer(f.id)).pendingChanges.length, 1);
  await api.decideChange(req.id, true);
  const after = await byCode(106);
  assert.equal(after.mobile, '9876500106'); assert.equal(after.village, 'बेडग');
  assert.equal((await api.farmer(f.id)).pendingChanges.length, 0);
});

test('the owner can reject; a stale request cannot be approved', async () => {
  await api.login('u-op1', '1111');
  const f = await byCode(107);
  const r1 = (await api.saveFarmer({ ...f, bankIfsc: 'sbin0001234' })).pendingRequest;
  assert.equal(r1.fields.bankIfsc.after, 'SBIN0001234');
  await api.logout();
  await api.login('u-owner', '1234');
  await api.decideChange(r1.id, false, 'IFSC चुकीचा');
  assert.equal((await api.changeRequests()).find((x) => x.id === r1.id).status, 'rejected');
  await api.logout();
  // operator asks, then the owner changes the same field directly: the request is now stale
  await api.login('u-op1', '1111');
  const r2 = (await api.saveFarmer({ ...(await byCode(107)), village: 'मिरज' })).pendingRequest;
  await api.logout();
  await api.login('u-owner', '1234');
  await api.saveFarmer({ ...(await byCode(107)), village: 'सांगली' });
  await assert.rejects(api.decideChange(r2.id, true), { code: 'changed-meanwhile' });
});

test("a farmer's own request (blank fields unchanged); approving a new UPI ID needs a new ₹1 check", async () => {
  await api.login('u-owner', '1234');
  const f = await byCode(108);
  await api.verifyUpi(f.id); await api.confirmUpiName({ farmerId: f.id, ok: true });
  await api.logout();
  await api.farmerLogin(108);
  await assert.rejects(api.requestMyChange({ fields: { mobile: '', upiId: '' } }), { code: 'no-change' });
  await assert.rejects(api.requestMyChange({ fields: { upiId: 'not a upi' } }), { code: 'invalid-upi' });
  const r = await api.requestMyChange({ fields: { upiId: 'anita.k@oksbi', mobile: '' }, note: 'नवीन UPI' });
  assert.deepEqual(Object.keys(r.fields), ['upiId']);
  const mine = await api.myChangeRequests();
  assert.equal(mine[0].status, 'pending'); assert.equal(mine[0].fields.upiId.after, 'an•••@oksbi', 'masked for the farmer');
  await api.logout();
  await api.login('u-owner', '1234');
  await api.decideChange(r.id, true);
  const pf = (await api.payoutFarmers()).find((x) => x.code === 108);
  assert.equal(pf.upiId, 'anita.k@oksbi'); assert.equal(pf.verified, false, 'must be checked again');
});

test('a second request keeps the first one (only the same fields are replaced)', async () => {
  await api.logout();
  await api.farmerLogin(111);
  await api.requestMyChange({ fields: { upiId: 'tukaram.g@okhdfc' } });
  await api.requestMyChange({ fields: { mobile: '9822011111' } });
  await api.requestMyChange({ fields: { mobile: '9822022222' } });
  const mine = (await api.myChangeRequests()).filter((r) => r.status === 'pending');
  assert.equal(mine.length, 2, 'UPI request and the latest mobile request');
  assert.ok(mine.some((r) => r.fields.upiId)); assert.ok(mine.some((r) => r.fields.mobile?.after === '98XXXXXX22'));
  await api.logout();
});
