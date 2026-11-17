// Daily report (दैनिक अहवाल, D-140): what came in and what went out for one date, per shift or the whole day.
// Pure function over the day's records; money in paise, litres ×100, Fat/SNF ×10. Averages are weighted by litres.
//   in     — farmers' milk: per milk type and total (farmers, entries, litres, avg Fat/SNF, avg rate, amount payable)
//   out    — dairy dispatch (per milk type), milk buyers, walk-in sales; balance = in − out (shrinkage), % of in
//   profit — sale (dairy + buyers + walk-in) − purchase from farmers. Milk goes to the dairy after every shift (D-141):
//            for a shift + milk type whose dispatch is not entered yet, the dairy amount is ESTIMATED when a rate is
//            given in `estimateRates` ({ 'morning|cow': ratePaise }): litres = collected − sold here, × that rate.
//            Then `profitEstimated` is true and `estimatedDairy` lists the estimates. Without a rate that milk is left
//            out of the profit (`profitPartial`); with nothing to go on, profitPaise is null — never a false "loss".
const sum = (xs, k) => xs.reduce((a, x) => a + (x[k] || 0), 0);
const wavg = (xs, k) => { const l = sum(xs, 'litresX100'); return l ? Math.round(xs.reduce((a, x) => a + (x[k] || 0) * x.litresX100, 0) / l) : null; };
const MILKS = ['cow', 'buffalo'];

function milkIn(xs) {
  const l = sum(xs, 'litresX100'); const amt = sum(xs, 'amountPaise');
  return { farmers: new Set(xs.map((x) => x.farmerId)).size, entries: xs.length, litresX100: l, fatX10: wavg(xs, 'fatX10'), snfX10: wavg(xs, 'snfX10'),
    ratePaise: l ? Math.round((amt * 100) / l) : 0, amountPaise: amt };
}
function dispatchOut(xs) {
  const l = sum(xs, 'litresX100'); const amt = sum(xs, 'amountPaise');
  return { count: xs.length, litresX100: l, fatX10: wavg(xs.filter((x) => x.fatX10 != null), 'fatX10'), snfX10: wavg(xs.filter((x) => x.snfX10 != null), 'snfX10'),
    ratePaise: l ? Math.round((amt * 100) / l) : 0, amountPaise: amt };
}

/** shift: 'morning' | 'evening' | null (whole day). Records may hold other dates/shifts; only matching ones count. */
export function dayReport({ date, shift = null, collections = [], dispatches = [], buyerSales = [], counterSales = [], estimateRates = {} }) {
  const match = (x) => x.date === date && (!shift || x.shift === shift);
  const coll = collections.filter((c) => !c.void && match(c));
  const disp = dispatches.filter(match);
  const buy = buyerSales.filter((s) => match(s) && s.litresX100 > 0);
  const ctr = counterSales.filter((s) => !s.void && match(s));

  const inn = { total: milkIn(coll) };
  for (const m of MILKS) inn[m] = milkIn(coll.filter((c) => c.milkType === m));
  const dairy = { total: dispatchOut(disp) };
  for (const m of MILKS) dairy[m] = dispatchOut(disp.filter((d) => d.milkType === m));
  const buyers = { count: buy.length, litresX100: sum(buy, 'litresX100'), amountPaise: sum(buy, 'amountPaise') };
  const counter = { count: ctr.length, litresX100: sum(ctr, 'litresX100'), amountPaise: sum(ctr, 'amountPaise'),
    cashPaise: sum(ctr.filter((s) => s.mode === 'cash'), 'amountPaise'), upiPaise: sum(ctr.filter((s) => s.mode === 'upi'), 'amountPaise') };

  // a shift + milk type with farmers' milk but no dairy dispatch yet
  const keys = new Set(disp.map((d) => `${d.shift}|${d.milkType}`));
  // D-141: milk not yet entered as dispatched → estimated dairy amount (litres left after local sales × the dairy rate)
  const estimatedDairy = [];
  for (const k of new Set(coll.map((c) => `${c.shift}|${c.milkType}`))) {
    if (keys.has(k) || !(estimateRates[k] > 0)) continue;
    const [s, m] = k.split('|'); const is = (x) => x.shift === s && x.milkType === m;
    const left = sum(coll.filter(is), 'litresX100') - sum(buy.filter(is), 'litresX100') - sum(ctr.filter(is), 'litresX100');
    const l = Math.max(0, left);
    estimatedDairy.push({ shift: s, milkType: m, litresX100: l, ratePaise: estimateRates[k], amountPaise: Math.round((l * estimateRates[k]) / 100) });
  }
  const estKeys = new Set(estimatedDairy.map((e) => `${e.shift}|${e.milkType}`));
  const sent = (x) => keys.has(`${x.shift}|${x.milkType}`) || estKeys.has(`${x.shift}|${x.milkType}`);
  const coveredColl = coll.filter(sent);
  const coveredX100 = sum(coveredColl, 'litresX100');
  const coveredSale = dairy.total.amountPaise + sum(estimatedDairy, 'amountPaise') + sum(buy.filter(sent), 'amountPaise') + sum(ctr.filter(sent), 'amountPaise');
  const profitPaise = coveredColl.length ? coveredSale - sum(coveredColl, 'amountPaise') : null;
  // totals out: real dispatch + local sales + estimated dispatch (estimates are listed separately and never mixed into dairy.total)
  const estX100 = sum(estimatedDairy, 'litresX100'); const estPaise = sum(estimatedDairy, 'amountPaise');
  const outL = dairy.total.litresX100 + estX100 + buyers.litresX100 + counter.litresX100;
  const balanceX100 = inn.total.litresX100 - outL;
  const salePaise = dairy.total.amountPaise + estPaise + buyers.amountPaise + counter.amountPaise;
  const missingDispatch = [...new Set(coll.map((c) => `${c.shift}|${c.milkType}`))].filter((k) => !keys.has(k)).map((k) => { const [s, m] = k.split('|'); return { shift: s, milkType: m }; });
  return {
    date, shift, in: inn,
    out: { dairy, buyers, counter, estimatedX100: estX100, totalX100: outL, balanceX100, balancePct: inn.total.litresX100 ? (balanceX100 * 100) / inn.total.litresX100 : 0 },
    salePaise, purchasePaise: inn.total.amountPaise, profitPaise, coveredX100, estimatedDairy, profitEstimated: estimatedDairy.length > 0,
    profitPartial: profitPaise != null && coveredX100 < inn.total.litresX100,
    perLitrePaise: profitPaise != null && coveredX100 ? Math.round((profitPaise * 100) / coveredX100) : 0,
    missingDispatch,
    entries: coll,
  };
}
