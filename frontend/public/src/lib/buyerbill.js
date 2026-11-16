// Daily milk buyers: when each one pays (D-87).
//  'month-end'  calendar month, paid at month end:            01/11 – 30/11, due 30/11
//  'day' + N    from day N to the day before N next month,     10/10 – 09/11, due 10/11   (N = 1…28)
import { addDays, lastDayOfMonth } from './dates.js';

const ym = (y, m) => { const k = y * 12 + (m - 1); return [Math.floor(k / 12), (k % 12) + 1]; };
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Normalised billing: { kind: 'month-end' } or { kind: 'day', day: 1…28 }. */
export function billingOf(b) {
  const day = Number(b?.billing?.day);
  return b?.billing?.kind === 'day' && Number.isInteger(day) && day >= 1 && day <= 28 ? { kind: 'day', day } : { kind: 'month-end' };
}

/** The bill period that contains `date`: { start, end, due } (all 'YYYY-MM-DD'). */
export function buyerCycle(billing, date) {
  const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)); const d = Number(date.slice(8, 10));
  if (billing.kind !== 'day') { const start = iso(y, m, 1); const end = lastDayOfMonth(start); return { start, end, due: end }; }
  const n = billing.day;
  const [sy, sm] = d >= n ? [y, m] : ym(y, m - 1);
  const [ny, nm] = ym(sy, sm + 1);
  const start = iso(sy, sm, n); const due = iso(ny, nm, n);
  return { start, end: addDays(due, -1), due };
}

/** The period before / after a period. */
export const prevCycle = (billing, c) => buyerCycle(billing, addDays(c.start, -1));
export const nextCycle = (billing, c) => buyerCycle(billing, addDays(c.end, 1));
