// Centre expenses (खर्च, D-126). Pure functions, money in integer paise.
//
// An expense is either a one-time cost on its date ('once') or a monthly cost ('month': rent, salary, electricity…)
// that covers the whole calendar month of its date and is spread evenly over that month's days when a shorter range
// is looked at. Rounding: the share of a range is round(amount × days in range ÷ days in month), half up, per
// expense — a full month always gives the exact amount.
//
// Not expenses (kept out on purpose): advances (उचल, they come back), payments to farmers (that is the milk
// purchase) and cattle feed bought for stock (it is resold).
import { addDays, lastDayOfMonth, daysBetween } from './dates.js';

export const EXPENSE_MODES = ['cash', 'upi', 'bank'];
export const EXPENSE_PERIODS = ['once', 'month'];

/** Ready-made categories; the owner can rename, hide or add more. `monthly` = new entries default to "monthly". */
export const DEFAULT_EXPENSE_CATEGORIES = Object.freeze([
  { id: 'ec-power', name: 'वीज बिल', monthly: true },
  { id: 'ec-rent', name: 'भाडे', monthly: true },
  { id: 'ec-salary', name: 'कामगार पगार', monthly: true },
  { id: 'ec-transport', name: 'डेअरीपर्यंत वाहतूक / डिझेल', monthly: false },
  { id: 'ec-repair', name: 'कॅन / उपकरणे दुरुस्ती', monthly: false },
  { id: 'ec-clean', name: 'स्वच्छता साहित्य', monthly: false },
  { id: 'ec-chem', name: 'फॅट मशीन केमिकल', monthly: false },
  { id: 'ec-phone', name: 'फोन / इंटरनेट', monthly: true },
  { id: 'ec-other', name: 'इतर', monthly: false },
]);

/** Estimated cost of one WhatsApp utility message (₹0.115–0.15 in India, 2026); the owner can change it. */
export const DEFAULT_MSG_COST_PAISE = 13;

const monthDays = (iso) => Number(lastDayOfMonth(iso).slice(8, 10));
const overlapDays = (a1, a2, b1, b2) => { const s = a1 > b1 ? a1 : b1; const e = a2 < b2 ? a2 : b2; return s > e ? 0 : daysBetween(s, e) + 1; };

/** The part of one expense that falls in [from, to] (dates YYYY-MM-DD, inclusive). */
export function expenseShare(e, from, to) {
  if (!e || e.void || !(e.amountPaise > 0)) return 0;
  if (e.period !== 'month') return e.date >= from && e.date <= to ? e.amountPaise : 0;
  const mStart = e.date.slice(0, 8) + '01'; const mEnd = lastDayOfMonth(e.date);
  const n = overlapDays(mStart, mEnd, from, to); if (!n) return 0;
  const days = monthDays(e.date);
  return n === days ? e.amountPaise : Math.floor((e.amountPaise * n) / days + 0.5);
}

/** Totals of the expenses for [from, to]: { totalPaise, byCategory: [{ categoryId, paise, count }] } (largest first). */
export function expenseTotals(expenses, from, to) {
  const by = new Map(); let total = 0;
  for (const e of expenses || []) {
    const p = expenseShare(e, from, to); if (!p) continue;
    total += p; const x = by.get(e.categoryId) || { categoryId: e.categoryId, paise: 0, count: 0 };
    x.paise += p; x.count += 1; by.set(e.categoryId, x);
  }
  return { totalPaise: total, byCategory: [...by.values()].sort((a, b) => b.paise - a.paise) };
}

/** Costs the app counts by itself: WhatsApp messages sent and payout gateway fees paid by the centre. */
export function autoCosts({ whatsappSent = 0, msgCostPaise = DEFAULT_MSG_COST_PAISE, payoutFeesPaise = 0, payoutCount = 0 } = {}) {
  const messagesPaise = whatsappSent * msgCostPaise;
  return { messagesPaise, whatsappSent, payoutFeesPaise, payoutCount, totalPaise: messagesPaise + payoutFeesPaise };
}

const key = (e) => `${e.categoryId}|${String(e.note || '').trim().toLowerCase()}`;
/**
 * Monthly expenses entered last month but not yet this month (rent, salary…): a reminder list, one per
 * category + note, with last month's amount to copy.
 */
export function monthlyDue(expenses, today) {
  const thisMonth = today.slice(0, 7); const lastMonth = addDays(thisMonth + '-01', -1).slice(0, 7);
  const live = (expenses || []).filter((e) => !e.void && e.period === 'month');
  const done = new Set(live.filter((e) => e.date.slice(0, 7) === thisMonth).map(key));
  const due = new Map();
  for (const e of live.filter((x) => x.date.slice(0, 7) === lastMonth)) if (!done.has(key(e)) && !due.has(key(e))) due.set(key(e), e);
  return [...due.values()];
}

/** Check one expense before saving; returns an error code or null. */
export function expenseError(x, { categories = [], today } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date || '') || (today && x.date > today)) return 'invalid-date';
  if (!categories.some((c) => c.id === x.categoryId)) return 'invalid-category';
  if (!Number.isInteger(x.amountPaise) || x.amountPaise <= 0 || x.amountPaise > 100000000) return 'invalid-amount';
  if (!EXPENSE_MODES.includes(x.mode)) return 'invalid';
  if (!EXPENSE_PERIODS.includes(x.period)) return 'invalid';
  if (String(x.note || '').length > 200) return 'invalid';
  return null;
}
