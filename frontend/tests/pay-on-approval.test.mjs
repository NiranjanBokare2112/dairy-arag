// D-123: pay choice "only after owner approval" — the money builds up, nothing is sent until the owner approves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const { nextPayDate, isDue, validPref } = await import('../public/src/lib/payout.js');

const FUND = { bankName: 'SBI', accountName: 'आरग दूध संकलन केंद्र', accountNo: '123456789012', ifsc: 'SBIN0001234' };

test('the choice is valid, due every day, with no next date of its own', () => {
  assert.ok(validPref({ kind: 'approval' }));
  assert.equal(isDue({ kind: 'approval' }, '2026-11-15', null), true);
  assert.equal(isDue({ kind: 'approval' }, '2026-11-15', '2026-11-15'), false);
  assert.equal(nextPayDate({ kind: 'approval' }, '2026-11-15'), null);
});

test('fixed-time auto payout: an "only after approval" farmer waits even when nobody else does', async () => {
  await api.login('u-owner', '1234');
  const fs = await api.payoutFarmers();
  const f103 = fs.find((f) => f.code === 103); const f102 = fs.find((f) => f.code === 102);
  for (const f of [f103, f102]) { await api.verifyUpi(f.id); await api.confirmUpiName({ farmerId: f.id, ok: true }); await api.setPayPref({ farmerId: f.id, pref: { kind: 'daily' } }); }
  await api.setPayPref({ farmerId: f102.id, pref: { kind: 'approval' } });
  assert.equal((await api.farmer(f102.id)).payPref.kind, 'approval');
  await api.savePayoutSettings({ mode: 'eod', time: '00:00', eodApproval: false, lagDays: 0, simDelayMs: 0, funding: FUND });
  const day = await api.payoutToday();
  const sent = day.sentToday.flatMap((r) => r.items);
  assert.ok(sent.some((x) => x.code === 103 && ['processing', 'success'].includes(x.status)), '103 paid by itself');
  assert.ok(!sent.some((x) => x.code === 102 && ['processing', 'success'].includes(x.status)), '102 not paid by itself');
  const w = day.waiting.find((x) => x.code === 102);
  assert.ok(w && w.amountPaise > 0, '102 waits for the owner');
  const [ok] = await api.approvePayouts({ payoutIds: [w.id], pin: '1234' });
  assert.equal(ok.status, 'processing', 'paid once approved');
  await api.savePayoutSettings({ mode: 'off' });
});
