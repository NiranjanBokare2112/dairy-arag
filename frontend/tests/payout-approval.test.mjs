// D-111: at the fixed time money goes from the business account by itself; farmers marked "needs approval" wait for the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');

const FUND = { bankName: 'SBI', accountName: 'आरग दूध संकलन केंद्र', accountNo: '123456789012', ifsc: 'SBIN0001234' };

test('fixed-time auto payout with per-farmer approval', async () => {
  await api.login('u-owner', '1234');
  const fs = await api.payoutFarmers();
  const f103 = fs.find((f) => f.code === 103); const f102 = fs.find((f) => f.code === 102); const f104 = fs.find((f) => f.code === 104);
  for (const f of [f103, f102, f104]) { await api.verifyUpi(f.id); await api.confirmUpiName({ farmerId: f.id, ok: true }); }
  await api.setPayApproval({ farmerIds: [f102.id, f104.id], on: true });
  assert.equal((await api.payoutFarmers()).find((f) => f.code === 102).approval, true);
  // end of day at 00:00 (already passed) — no global approval, so only marked farmers wait
  await api.savePayoutSettings({ mode: 'eod', time: '00:00', eodApproval: false, lagDays: 0, simDelayMs: 0, funding: FUND });
  const day = await api.payoutToday();
  const auto = day.sentToday.flatMap((r) => r.items).find((x) => x.code === 103);
  assert.ok(auto && ['processing', 'success'].includes(auto.status), '103 paid automatically from the account');
  const waits = day.waiting.map((x) => x.code).sort();
  assert.deepEqual(waits, [102, 104], 'marked farmers wait for approval');
  assert.ok(day.waiting.every((x) => x.breakdown && x.breakdown.grossPaise >= x.breakdown.owedPaise), 'breakdown shown');
  // owner decides each one
  const w102 = day.waiting.find((x) => x.code === 102); const w104 = day.waiting.find((x) => x.code === 104);
  await assert.rejects(api.approvePayouts({ payoutIds: [w102.id], pin: '0000' }), { code: 'bad-pin' });
  const [ok102] = await api.approvePayouts({ payoutIds: [w102.id], pin: '1234' });
  assert.equal(ok102.status, 'processing');
  await assert.rejects(api.rejectPayout({ payoutId: w104.id, reason: ' ' }), { code: 'reason-required' });
  const rej = await api.rejectPayout({ payoutId: w104.id, reason: 'खाते तपासायचे आहे' });
  assert.equal(rej.status, 'rejected'); assert.equal(rej.reason, 'खाते तपासायचे आहे');
  await api.payoutPulse();
  const after = await api.payoutToday();
  assert.equal(after.waiting.length, 0);
  assert.ok(after.preview.ready.some((x) => x.code === 104) || after.preview.waiting.some((x) => x.code === 104 && x.amountPaise > 0), 'rejected amount stays payable');
  // everyone needs approval: nothing goes by itself
  await api.savePayoutSettings({ eodApproval: true });
  await api.savePayoutSettings({ mode: 'off' });
});
