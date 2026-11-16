// Bill cycles (A5.1). Rule C1:
//  10-day: 1–10, 11–20, 21–end of month (the third cycle is 8–11 days, as in most Maharashtra dairies).
//  7-day : consecutive weeks counted from the center's anchor date (default a Monday).
import { addDays, daysBetween, lastDayOfMonth } from './dates.js';

export function cycleFor(date, lengthDays, anchor = '2026-01-05') {
  if (lengthDays === 10) {
    const day = Number(date.slice(8, 10));
    const ym = date.slice(0, 8);
    if (day <= 10) return { start: ym + '01', end: ym + '10' };
    if (day <= 20) return { start: ym + '11', end: ym + '20' };
    return { start: ym + '21', end: lastDayOfMonth(date) };
  }
  if (lengthDays === 7) {
    const n = Math.floor(daysBetween(anchor, date) / 7);
    const start = addDays(anchor, n * 7);
    return { start, end: addDays(start, 6) };
  }
  throw new RangeError('cycle length must be 7 or 10');
}

export const previousCycle = (cycle, lengthDays, anchor) => cycleFor(addDays(cycle.start, -1), lengthDays, anchor);
export const cycleKey = (c) => `${c.start}_${c.end}`;
