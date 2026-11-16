// Bill calculation (A5.2). All money in paise.
// Rule B1: net = gross − feed − advance installment − previous dues.
// Rule B2: feed and previous dues are always deducted in full. The advance installment is
//          min(installment, outstanding advance, what is left after feed and dues), so an
//          installment never pushes a bill negative.
// Rule B3: if net is still negative, payable = 0 and the shortfall carries forward as
//          "previous dues" on the next bill.
// Rule B4: averages are litre-weighted; avg Fat/SNF kept as ×100 integers (2 decimals);
//          avg rate = gross / litres, rounded half-up to the paisa.
import { divRoundHalfUp } from './money.js';

export function computeBill({ entries = [], feedPaise = 0, advanceOutstandingPaise = 0, advanceInstallmentPaise = 0, previousDuesPaise = 0 }) {
  let litresX100 = 0; let grossPaise = 0; let fatW = 0; let snfW = 0;
  for (const e of entries) {
    litresX100 += e.litresX100;
    grossPaise += e.amountPaise;
    fatW += e.fatX10 * e.litresX100;
    snfW += e.snfX10 * e.litresX100;
  }
  const avgFatX100 = litresX100 ? divRoundHalfUp(fatW * 10, litresX100) : 0;
  const avgSnfX100 = litresX100 ? divRoundHalfUp(snfW * 10, litresX100) : 0;
  const avgRatePaise = litresX100 ? divRoundHalfUp(grossPaise * 100, litresX100) : 0;

  const afterFixed = grossPaise - feedPaise - previousDuesPaise;
  const advancePaise = Math.max(0, Math.min(advanceInstallmentPaise, advanceOutstandingPaise, afterFixed));
  const totalDeductPaise = feedPaise + advancePaise + previousDuesPaise;
  const netPaise = grossPaise - totalDeductPaise;
  return {
    litresX100, grossPaise, avgFatX100, avgSnfX100, avgRatePaise,
    feedPaise, advancePaise, previousDuesPaise, totalDeductPaise, netPaise,
    payablePaise: Math.max(0, netPaise),
    carryForwardDuesPaise: Math.max(0, -netPaise),
    advanceRemainingPaise: advanceOutstandingPaise - advancePaise,
  };
}
