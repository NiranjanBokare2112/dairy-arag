// Fat × SNF rate chart lookup.
// Chart shape: { id, centerId, milkType: 'cow'|'buffalo', effectiveFrom: 'YYYY-MM-DD',
//   fats: [fatX10 ascending], snfs: [snfX10 ascending], rates: [[paise|null]] (rates[fatIndex][snfIndex]) }
// Rules for values between grid points (A2.4):
//   exact         – value must be on a grid point on both axes
//   nearest-lower – largest grid value ≤ actual on each axis
//   nearest       – closest grid value on each axis; ties go to the lower value
// Values outside the grid range (below min / above max) are always rejected: the owner must
// extend the chart rather than the app silently paying a boundary rate.
import { toPaise, formatRupees } from './money.js';
import { parseTenths, fmtTenths } from './qty.js';

export const RULES = ['exact', 'nearest-lower', 'nearest'];

function snap(axis, v, rule) {
  if (!axis.length) return { error: 'empty-chart' };
  if (v < axis[0] || v > axis[axis.length - 1]) return { error: 'out-of-range' };
  const exact = axis.indexOf(v);
  if (exact >= 0) return { index: exact };
  if (rule === 'exact') return { error: 'not-on-grid' };
  let lo = 0;
  for (let i = 0; i < axis.length; i++) if (axis[i] <= v) lo = i;
  if (rule === 'nearest-lower') return { index: lo };
  const hi = lo + 1;
  return { index: v - axis[lo] <= axis[hi] - v ? lo : hi };
}

/** @returns {{ok:true, ratePaise:number, fatUsed:number, snfUsed:number} | {ok:false, reason:string}} */
export function lookupRate(chart, fatX10, snfX10, rule = 'nearest-lower') {
  if (!chart) return { ok: false, reason: 'no-chart' };
  if (!RULES.includes(rule)) return { ok: false, reason: 'bad-rule' };
  const f = snap(chart.fats, fatX10, rule);
  if (f.error) return { ok: false, reason: 'fat-' + f.error };
  const s = snap(chart.snfs, snfX10, rule);
  if (s.error) return { ok: false, reason: 'snf-' + s.error };
  const r = chart.rates[f.index]?.[s.index];
  if (r == null) return { ok: false, reason: 'blank-cell' };
  return { ok: true, ratePaise: r, fatUsed: chart.fats[f.index], snfUsed: chart.snfs[s.index] };
}

/**
 * Pick the chart in force on `date` for `milkType`: latest effectiveFrom ≤ date (newest upload wins a tie).
 * A chart with `effectiveTo` (e.g. a "today only" price) applies only up to and including that date;
 * after it, the previous chart is in force again automatically.
 */
export function chartFor(charts, milkType, date) {
  let best = null;
  for (const c of charts) {
    if (c.milkType !== milkType || c.effectiveFrom > date || (c.effectiveTo && c.effectiveTo < date)) continue;
    if (!best || c.effectiveFrom > best.effectiveFrom ||
      (c.effectiveFrom === best.effectiveFrom && (c.createdAt || '') > (best.createdAt || ''))) best = c;
  }
  return best;
}

/**
 * Owner's quick price change: add `deltaPaise` (negative = decrease) to every rate of a chart.
 * Blank cells stay blank. Returns { ok, fats, snfs, rates } or { ok:false, error:'rate-too-low' } if any rate would drop to ₹0 or below.
 */
export function adjustChart(chart, deltaPaise) {
  if (!chart || !Number.isInteger(deltaPaise)) return { ok: false, error: 'invalid' };
  const rates = chart.rates.map((row) => row.map((r) => (r == null ? null : r + deltaPaise)));
  if (rates.some((row) => row.some((r) => r != null && r <= 0))) return { ok: false, error: 'rate-too-low' };
  return { ok: true, fats: chart.fats.slice(), snfs: chart.snfs.slice(), rates };
}

/** Build a linear chart: rate = base + fatStep per 0.1 Fat + snfStep per 0.1 SNF (all paise). Used for seeding. */
export function generateChart({ fatFrom, fatTo, snfFrom, snfTo, basePaise, fatStepPaise, snfStepPaise }) {
  const fats = []; const snfs = [];
  for (let f = fatFrom; f <= fatTo; f++) fats.push(f);
  for (let s = snfFrom; s <= snfTo; s++) snfs.push(s);
  const rates = fats.map((f) => snfs.map((s) => basePaise + (f - fatFrom) * fatStepPaise + (s - snfFrom) * snfStepPaise));
  return { fats, snfs, rates };
}

// CSV format (Excel "Save as CSV" compatible; comma, semicolon or tab separated):
//   FAT/SNF,8.0,8.1,8.2
//   3.0,28.00,28.20,28.40
//   3.1,28.50,...
/** @returns {{ok:true, fats, snfs, rates} | {ok:false, error:string, line?:number}} */
export function parseChartCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { ok: false, error: 'too-short' };
  const split = (l) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
  const snfs = split(lines[0]).slice(1).map(parseTenths);
  if (!snfs.length || snfs.some((v) => v == null)) return { ok: false, error: 'bad-snf-header', line: 1 };
  if (!isAscending(snfs)) return { ok: false, error: 'not-ascending', line: 1 };
  const fats = []; const rates = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    const fat = parseTenths(cells[0]);
    if (fat == null) return { ok: false, error: 'bad-fat', line: i + 1 };
    fats.push(fat);
    const row = [];
    for (let j = 0; j < snfs.length; j++) {
      const c = cells[j + 1];
      if (c == null || c === '') { row.push(null); continue; }
      const p = toPaise(c);
      if (p == null || p < 0) return { ok: false, error: 'bad-rate', line: i + 1 };
      row.push(p);
    }
    rates.push(row);
  }
  if (!isAscending(fats)) return { ok: false, error: 'not-ascending' };
  return { ok: true, fats, snfs, rates };
}

export function chartToCsv(chart) {
  const head = ['FAT/SNF', ...chart.snfs.map(fmtTenths)].join(',');
  const rows = chart.fats.map((f, i) => [fmtTenths(f),
    ...chart.rates[i].map((r) => (r == null ? '' : formatRupees(r).replace(/,/g, '')))].join(','));
  return [head, ...rows].join('\r\n') + '\r\n';
}

const isAscending = (a) => a.every((v, i) => i === 0 || v > a[i - 1]);
