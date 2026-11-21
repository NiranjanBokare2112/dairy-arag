// D-107: UPI payouts to farmers — ₹1 UPI check, farmer's choice of when to be paid, owner approval, bills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
// The payout rules depend on the bill period: on its first day (1st / 11th / 21st) nothing is owed yet, which is right but
// made this test fail on those dates. Pin the clock to a mid-period day (18/11/2026, 12:00 IST) so it gives the same result every day.
const RealDate = Date; const SHIFT = new RealDate('2026-11-18T06:30:00Z').getTime() - RealDate.now();
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.now() + SHIFT])); } static now() { return RealDate.now() + SHIFT; } };
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const { anchorDate, isDue, nextPayDate, applyLimits, validPref } = await import('../public/src/lib/payout.js');
const { simVerify } = await import('../public/src/lib/payout-sim.js');
const { todayIST, addDays } = await import('../public/src/lib/dates.js');

test('when a farmer is due', () => {
  assert.equal(anchorDate({ kind: 'daily' }, '2026-11-14'), '2026-11-14');
  assert.equal(anchorDate({ kind: 'day', day: 5 }, '2026-11-14'), '2026-11-05');
  assert.equal(anchorDate({ kind: 'day', day: 20 }, '2026-11-14'), '2026-10-20');
  assert.equal(anchorDate({ kind: 'month-end' }, '2026-11-14'), '2026-10-31');
  assert.equal(anchorDate({ kind: 'month-end' }, '2026-11-30'), '2026-11-30');
  assert.equal(isDue({ kind: 'day', day: 5 }, '2026-11-14', '2026-11-05'), false, 'already paid this month');
  assert.equal(isDue({ kind: 'day', day: 5 }, '2026-11-14', '2026-10-05'), true, 'missed run is caught up');
  assert.equal(isDue({ kind: 'daily' }, '2026-11-14', '2026-11-14'), false);
  assert.equal(nextPayDate({ kind: 'day', day: 5 }, '2026-11-14'), '2026-12-05');
  assert.equal(nextPayDate({ kind: 'month-end' }, '2026-11-14'), '2026-11-30');
  assert.equal(validPref({ kind: 'day', day: 29 }), false);
  assert.equal(validPref({ kind: 'weekly' }), false);
});

test('limits: minimum, fee paid by the farmer, caps', () => {
  const c = [{ farmerId: 'a', amountPaise: 50000 }, { farmerId: 'b', amountPaise: 5000 }, { farmerId: 'c', amountPaise: 90000 }];
  const r = applyLimits(c, { minPaise: 10000, feeBy: 'farmer', feePaise: 200, perFarmerCapPaise: 80000, dailyCapPaise: 100000 });
  assert.deepEqual([r[0].sendPaise, r[0].creditPaise], [50000, 49800], 'fee comes off what the farmer gets');
  assert.equal(r[1].held, 'below-min');
  assert.equal(r[2].held, 'cap-day', '49,800 + 79,800 > ₹1,000 daily cap');
});

test('simulated ₹1 check', () => {
  assert.equal(simVerify('bad id', 'x').reason, 'invalid-vpa');
  assert.equal(simVerify('farmer103@upi', 'विठ्ठल माने').name, 'VITTHAL MANE');
});

test('UPI check, owner approval, payments and the bill', async () => {
  await api.login('u-owner', '1234');
  const farmers = await api.payoutFarmers();
  const f101 = farmers.find((f) => f.code === 103); // daily, and owed money (101 is not: feed + advance ≥ milk so far)
  assert.equal(f101.pref.kind, 'daily');
  assert.equal(f101.verified, false);
  // ₹1 check → the bank's name → owner confirms
  const chk = await api.verifyUpi(f101.id);
  assert.equal(chk.status, 'name-check'); assert.equal(chk.bankName, 'VITTHAL MANE');
  await assert.rejects(api.approvePayoutRun({ runId: 'x', payoutIds: [], pin: '1234' }), { code: 'not-found' });
  assert.equal((await api.confirmUpiName({ farmerId: f101.id, ok: true })).status, 'verified');
  await assert.rejects(api.savePayoutSettings({ mode: 'approve' }), { code: 'funding-required' }, 'no paying account yet');
  await api.savePayoutSettings({ mode: 'approve', lagDays: 1, minPaise: 10000, simDelayMs: 0, funding: { bankName: 'SBI', accountName: 'आरग दूध संकलन केंद्र', accountNo: '123456789012', ifsc: 'SBIN0001234' } });

  const today = await api.payoutToday();
  const r101 = today.preview.ready.find((x) => x.code === 103);
  assert.ok(r101 && r101.creditPaise > 0, '103 is due (daily, checked)');
  assert.ok(today.preview.waiting.some((x) => x.code === 102 && x.why === 'unverified') || today.preview.waiting.some((x) => x.code === 102 && x.why === 'not-due'), '102 is not paid (not checked / not its date)');
  assert.ok(r101.parts.every((p) => p.end <= addDays(todayIST(), -1)), "yesterday's milk at most");

  const run = await api.createPayoutRun();
  const item = run.items.find((x) => x.code === 103);
  await assert.rejects(api.approvePayoutRun({ runId: run.id, payoutIds: [item.id], pin: '0000' }), { code: 'bad-pin' });
  const done = await api.approvePayoutRun({ runId: run.id, payoutIds: [item.id], pin: '1234' });
  assert.equal(done.items.find((x) => x.code === 103).status, 'processing', 'D-110: accepted ≠ paid');
  assert.equal((await api.payments({ date: todayIST() })).filter((p) => p.payoutId === item.id).length, 0, 'nothing booked before confirmation');
  await api.payoutPulse(); // the gateway's webhook arrives
  let sent = (await api.payoutRuns()).find((r) => r.id === run.id).items.find((x) => x.code === 103);
  // the simulated gateway fails ~1 in 29 transfers ("bank down"): a failed payout stays payable and is retried by the owner
  for (let i = 0; i < 5 && sent.status === 'failed'; i++) {
    assert.equal(sent.reason, 'bank-down');
    await api.retryPayout({ payoutId: sent.id, pin: '1234' }); await api.payoutPulse();
    sent = (await api.payoutRuns()).find((r) => r.id === run.id).items.find((x) => x.code === 103);
  }
  assert.equal(sent.status, 'success'); assert.match(sent.ref, /^SIM\d+/);
  assert.equal(sent.breakdown.netPaise - sent.breakdown.alreadyPaidPaise, sent.breakdown.owedPaise, 'breakdown: net − already paid = owed');
  assert.ok(done.items.filter((x) => x.code !== 103).every((x) => x.status === 'skipped'), 'unticked rows are skipped');

  // the payment register has it, and 101 is not due again today
  const pays = (await api.payments({ date: todayIST() })).filter((p) => p.payoutId === sent.id);
  assert.equal(pays.reduce((s, p) => s + p.amountPaise, 0), sent.amountPaise);
  assert.ok((await api.payoutToday()).preview.waiting.some((x) => x.code === 103 && x.why === 'not-due'));

  // the period's bill counts the payout as already paid
  const part = sent.parts.find((p) => p.kind === 'open');
  if (part) {
    const [start, end] = part.cycleId.split('_');
    await api.generateBills({ start, end });
    const bill = (await api.bills({ farmerId: f101.id })).find((b) => b.cycleId === part.cycleId);
    assert.equal(bill.prepaidPaise, part.paise);
    assert.equal(bill.paidPaise, part.paise);
  }
  // a changed UPI ID must be checked again
  const full = (await api.farmers()).find((f) => f.code === 102);
  await api.verifyUpi(full.id); await api.confirmUpiName({ farmerId: full.id, ok: true });
  assert.equal((await api.payoutFarmers()).find((f) => f.code === 102).verified, true);
  await api.saveFarmer({ ...full, upiId: 'sunita.new@okbank' });
  assert.equal((await api.payoutFarmers()).find((f) => f.code === 102).verified, false);
});

test('a farmer chooses when to be paid (if the owner allows)', async () => {
  await api.login('u-owner', '1234');
  await api.savePayoutSettings({ farmerCanChoose: true });
  await api.logout();
  await api.farmerLogin(104);
  await api.setMyPayPref({ kind: 'day', day: 10 });
  const mine = await api.myPayouts();
  assert.notDeepEqual(mine.pref, { kind: 'day', day: 10 }, 'D-108: waits for the owner');
  assert.deepEqual(mine.pendingPref, { kind: 'day', day: 10 });
  await assert.rejects(api.setMyPayPref({ kind: 'day', day: 31 }), { code: 'invalid-pay-pref' });
  await api.logout();
  await api.login('u-owner', '1234');
  await api.savePayoutSettings({ farmerCanChoose: false });
  await api.logout();
  await api.farmerLogin(104);
  await assert.rejects(api.setMyPayPref({ kind: 'daily' }), { code: 'forbidden' });
  await api.logout();
});

test('below the minimum waits for the next run', async () => {
  await api.login('u-owner', '1234');
  await api.savePayoutSettings({ minPaise: 100000000 });
  const t = await api.payoutToday();
  assert.equal(t.preview.ready.length, 0);
  assert.ok(t.preview.held.every((x) => x.why === 'below-min'));
  await api.savePayoutSettings({ minPaise: 10000, mode: 'off' });
});
