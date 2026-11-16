// Dashboard date ranges. All dates are IST 'YYYY-MM-DD'; ranges are inclusive.
import { addDays, daysBetween } from './dates.js';

export const PRESETS = ['today', '7', '15', '30'];
export const MAX_RANGE_DAYS = 366;

/** 'today' → today only; '7' → the last 7 days including today; and so on. */
export function presetRange(preset, today) {
  if (preset === 'today') return { from: today, to: today };
  const n = Number(preset);
  if (!Number.isInteger(n) || n < 1) throw new RangeError('bad preset');
  return { from: addDays(today, -(n - 1)), to: today };
}

/**
 * Normalise a custom range: swap if reversed, never past today, at most MAX_RANGE_DAYS long.
 * Returns null if either date is missing or malformed.
 */
export function customRange(from, to, today) {
  const ok = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!ok(from) || !ok(to)) return null;
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;
  if (from > to) from = to;
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  return { from, to };
}

/** Read the range from the URL query: ?range=7 | ?from=…&to=… ; default = today. */
export function rangeFromQuery(query, today) {
  if (query.from || query.to) {
    const r = customRange(query.from, query.to, today);
    if (r) return { ...r, preset: 'custom' };
  }
  const preset = PRESETS.includes(query.range) ? query.range : 'today';
  return { ...presetRange(preset, today), preset };
}

export const rangeDays = (r) => daysBetween(r.from, r.to) + 1;
