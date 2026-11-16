// Collection entry rules (A3).
import { lookupRate, chartFor } from './rates.js';
import { amountFor } from './money.js';
import { LIMITS } from './qty.js';

/** One entry per farmer + date + shift + milk type (A3.3). */
export const duplicateKey = (e) => `${e.centerId}|${e.farmerId}|${e.date}|${e.shift}|${e.milkType}`;

/** Existing non-void entry clashing with `candidate`, ignoring the same UUID (an idempotent retry). */
export function findDuplicate(entries, candidate) {
  const k = duplicateKey(candidate);
  return entries.find((e) => !e.void && e.id !== candidate.id && duplicateKey(e) === k) || null;
}

/** Validate inputs and price an entry. Returns { ok, errors, ratePaise, amountPaise, fatUsed, snfUsed }. */
export function priceEntry({ litresX100, fatX10, snfX10, milkType, date }, charts, rule) {
  const errors = {};
  const inRange = (v, k) => v != null && v >= LIMITS[k].min && v <= LIMITS[k].max;
  if (!inRange(litresX100, 'litresX100')) errors.litres = 'invalid';
  if (!inRange(fatX10, 'fatX10')) errors.fat = 'invalid';
  if (!inRange(snfX10, 'snfX10')) errors.snf = 'invalid';
  if (Object.keys(errors).length) return { ok: false, errors };
  const chart = chartFor(charts, milkType, date);
  const r = lookupRate(chart, fatX10, snfX10, rule);
  if (!r.ok) return { ok: false, errors: { rate: r.reason } };
  return { ok: true, errors: {}, chartId: chart.id, ratePaise: r.ratePaise, amountPaise: amountFor(litresX100, r.ratePaise), fatUsed: r.fatUsed, snfUsed: r.snfUsed };
}
