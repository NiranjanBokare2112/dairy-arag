// D-140: daily report — milk in / out per shift, balance, profit, missing dispatch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { dayReport } = await import('../public/src/lib/dayreport.js');

const D = '2026-11-17';
const c = (farmerId, shift, milkType, l, fat, snf, rate) => ({ date: D, farmerId, shift, milkType, litresX100: l, fatX10: fat, snfX10: snf, ratePaise: rate, amountPaise: Math.round((l * rate) / 100) });
const collections = [
  c('f1', 'morning', 'cow', 1000, 40, 85, 3500), c('f2', 'morning', 'cow', 500, 43, 86, 3700),
  c('f3', 'morning', 'buffalo', 800, 65, 90, 5500), c('f1', 'evening', 'cow', 900, 41, 85, 3550),
  { ...c('f9', 'morning', 'cow', 999, 40, 85, 3500), void: true }, { ...c('f1', 'morning', 'cow', 700, 40, 85, 3500), date: '2026-11-16' },
];
const dispatches = [{ date: D, shift: 'morning', milkType: 'cow', litresX100: 1300, fatX10: 41, snfX10: 85, ratePaise: 3800, amountPaise: 49400 }];
const buyerSales = [{ date: D, shift: 'morning', milkType: 'cow', litresX100: 150, amountPaise: 8400 }, { date: D, shift: 'morning', milkType: 'cow', litresX100: 0, amountPaise: 0 }];
const counterSales = [{ date: D, shift: 'morning', milkType: 'cow', litresX100: 25, amountPaise: 1500, mode: 'cash' }, { date: D, shift: 'morning', milkType: 'buffalo', litresX100: 50, amountPaise: 3800, mode: 'upi', void: true }];

test('morning shift: in, out, balance, profit', () => {
  const r = dayReport({ date: D, shift: 'morning', collections, dispatches, buyerSales, counterSales });
  assert.equal(r.in.total.litresX100, 2300); assert.equal(r.in.total.farmers, 3); assert.equal(r.in.total.entries, 3);
  assert.equal(r.in.cow.litresX100, 1500); assert.equal(r.in.cow.fatX10, 41); // (40×10 + 43×5) / 15 = 41
  assert.equal(r.in.total.amountPaise, 35000 + 18500 + 44000);
  assert.equal(r.out.dairy.total.litresX100, 1300); assert.equal(r.out.buyers.litresX100, 150); assert.equal(r.out.buyers.count, 1);
  assert.equal(r.out.counter.litresX100, 25); assert.equal(r.out.counter.cashPaise, 1500); assert.equal(r.out.counter.upiPaise, 0); // the void UPI sale does not count
  assert.equal(r.out.balanceX100, 2300 - 1300 - 150 - 25);
  assert.equal(r.salePaise, 49400 + 8400 + 1500);
  // profit only on milk whose dispatch is entered (morning cow): sale 49400 + 8400 + 1500 − purchase 35000 + 18500
  assert.equal(r.profitPaise, 59300 - 53500); assert.equal(r.profitPartial, true); assert.equal(r.coveredX100, 1500);
  assert.deepEqual(r.missingDispatch, [{ shift: 'morning', milkType: 'buffalo' }]);
});
test('whole day adds both shifts; other dates and void entries never count', () => {
  const r = dayReport({ date: D, collections, dispatches, buyerSales, counterSales });
  assert.equal(r.in.total.litresX100, 3200); assert.equal(r.in.total.entries, 4); assert.equal(r.in.total.farmers, 3);
  assert.deepEqual(r.missingDispatch.map((x) => x.shift + ' ' + x.milkType).sort(), ['evening cow', 'morning buffalo']);
});
test('an empty shift is all zeros, not an error', () => {
  const r = dayReport({ date: '2026-01-01', shift: 'evening', collections, dispatches });
  assert.equal(r.in.total.litresX100, 0); assert.equal(r.in.total.fatX10, null); assert.equal(r.out.balancePct, 0); assert.equal(r.profitPaise, null); // no milk → no profit figure
});
test('nothing sent to the dairy yet: no profit figure (not a loss)', () => {
  const r = dayReport({ date: D, shift: 'evening', collections, dispatches, buyerSales, counterSales });
  assert.ok(r.in.total.litresX100 > 0); assert.equal(r.profitPaise, null); assert.equal(r.perLitrePaise, 0);
});
test('dispatch not entered but a dairy rate is known: estimated profit, not a loss (D-141)', () => {
  // evening cow: 9.00 L collected, nothing sold here, no dispatch; dairy rate ₹38.00
  const r = dayReport({ date: D, shift: 'evening', collections, dispatches, buyerSales, counterSales, estimateRates: { 'evening|cow': 3800 } });
  assert.equal(r.profitEstimated, true);
  assert.deepEqual(r.estimatedDairy, [{ shift: 'evening', milkType: 'cow', litresX100: 900, ratePaise: 3800, amountPaise: 34200 }]);
  assert.equal(r.profitPaise, 34200 - 31950); // estimated dairy amount − purchase (9 L × ₹35.50)
  assert.equal(r.profitPartial, false); assert.equal(r.coveredX100, 900);
  // the whole day: morning cow is real, morning buffalo + evening cow estimated → all milk counted
  const d = dayReport({ date: D, collections, dispatches, buyerSales, counterSales, estimateRates: { 'morning|buffalo': 5600, 'evening|cow': 3800 } });
  assert.equal(d.coveredX100, d.in.total.litresX100); assert.equal(d.estimatedDairy.length, 2);
  assert.equal(d.out.dairy.total.litresX100, 1300, 'estimates are not added to the real dispatch total');
});
