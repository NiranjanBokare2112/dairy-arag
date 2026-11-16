// D-125: a bill waiting in a UPI payout cannot also be paid by hand (cash / own UPI) — nobody is paid twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const FUND = { bankName: 'SBI', accountName: 'आरग दूध संकलन केंद्र', accountNo: '123456789012', ifsc: 'SBIN0001234' };

test('a bill in a waiting UPI payout is blocked for payment by hand', async () => {
  await api.login('u-owner', '1234');
  const bills = await api.unpaidBills();
  assert.ok(bills.length, 'demo data has unpaid final bills');
  const b = bills[0];
  await api.verifyUpi(b.farmerId); await api.confirmUpiName({ farmerId: b.farmerId, ok: true });
  await api.setPayPref({ farmerId: b.farmerId, pref: { kind: 'approval' } });
  await api.savePayoutSettings({ mode: 'eod', time: '00:00', eodApproval: false, lagDays: 0, simDelayMs: 0, funding: FUND });
  const day = await api.payoutToday();
  const w = day.waiting.find((x) => x.farmerId === b.farmerId);
  assert.ok(w && w.parts.some((p) => p.billId === b.id), 'the bill is in the waiting payout');
  const after = (await api.unpaidBills()).find((x) => x.id === b.id);
  assert.ok(after.inPayoutPaise > 0, 'the bill shows the amount waiting in the payout');
  const left = after.payablePaise - after.paidPaise;
  if (after.inPayoutPaise >= left) {
    await assert.rejects(api.addPayment({ billId: b.id, mode: 'cash', amountPaise: 100, upiRef: '', date: '2026-11-15' }), { code: 'in-payout' });
  } else {
    await assert.rejects(api.addPayment({ billId: b.id, mode: 'cash', amountPaise: left, upiRef: '', date: '2026-11-15' }), { code: 'in-payout' });
  }
  // rejected payout → the bill can be paid by hand again
  await api.rejectPayout({ payoutId: w.id, reason: 'रोख देणार' });
  const p = await api.addPayment({ billId: b.id, mode: 'cash', amountPaise: left, upiRef: '', date: '2026-11-15' });
  assert.equal(p.amountPaise, left);
  await api.savePayoutSettings({ mode: 'off' });
});
