// UPI payouts to farmers (D-107): when each farmer is due, and the owner's limits. Pure functions, money in paise.
//
// A farmer chooses WHEN they want their money (payPref):
//   daily      — every day (the milk up to "yesterday" or "today", owner's setting)
//   bill       — on the bill date: only bills that are final are paid
//   day        — on a fixed date every month (1–28)
//   month-end  — on the last day of the month
//   approval   — only after the owner approves (D-123): owed money builds up every day, nothing is sent by itself
// A missed run (centre offline, owner did not approve) is caught up on the next run: a farmer is due whenever no
// payout went to them since their last "anchor" date.
import { addDays } from './dates.js';

export const PAY_KINDS = ['daily', 'bill', 'day', 'month-end', 'approval'];
export const PAYOUT_MODES = ['off', 'immediate', 'approve', 'eod'];
export const PAY_METHODS = ['upi', 'bank'];

// D-110 (agreed payout requirement): three owner modes; money comes from the owner's business account and goes to the
// farmer's UPI ID or bank account; success only on the gateway's confirmation.
export const PAYOUT_DEFAULTS = Object.freeze({
  mode: 'off',            // off · immediate (each confirmed collection) · approve (owner's pending list) · eod (batch at `time`)
  eodApproval: true,      // end of day: the batch waits for the owner's approval
  time: '21:30',          // end-of-day batch time; also when farmers on a date / month-end / bill choice are paid in every mode
  lagDays: 0,             // 0 = today's milk (end of day consolidates the day), 1 = up to yesterday
  minPaise: 10000,        // smaller amounts wait for the next payout (saves the per-payout fee)
  perFarmerCapPaise: 0,   // 0 = no limit
  dailyCapPaise: 0,       // 0 = no limit
  perTxnLimitPaise: 10000000, // provider / UPI limit per transfer (₹1,00,000)
  feePaise: 200,          // gateway fee per payout (₹2, simulated until a provider is chosen)
  feeBy: 'center',        // center | farmer (deducted from the amount)
  farmerCanChoose: true,  // farmers may ask to change their own payPref (owner approves, D-108)
  provider: 'sim',        // sim (no real money) until Cashfree / RazorpayX is chosen
  funding: { bankName: '', accountName: '', accountNo: '', ifsc: '' }, // the owner's business account (source of funds)
  simBalancePaise: 50000000, // simulated balance of that account (₹5,00,000)
  simDelayMs: 3000,       // simulated gateway: time until the webhook confirms
});

export const DEFAULT_PREF = Object.freeze({ kind: 'bill', day: null });

export function prefOf(f) {
  const p = f?.payPref || DEFAULT_PREF;
  if (!PAY_KINDS.includes(p.kind)) return { ...DEFAULT_PREF };
  return p.kind === 'day' ? { kind: 'day', day: Math.min(28, Math.max(1, Number(p.day) || 1)) } : { kind: p.kind, day: null };
}

/** D-123: this farmer is paid only when the owner approves. */
export const onlyOnApproval = (f) => prefOf(f).kind === 'approval';

export function validPref(p) {
  if (!p || !PAY_KINDS.includes(p.kind)) return false;
  if (p.kind === 'day') return Number.isInteger(Number(p.day)) && Number(p.day) >= 1 && Number(p.day) <= 28;
  return true;
}

const lastOfMonth = (iso) => { const [y, m] = iso.split('-').map(Number); return `${iso.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const isMonthEnd = (iso) => lastOfMonth(iso) === iso;

/** The latest date on or before `today` when this preference pays (null for "bill"). */
export function anchorDate(pref, today) {
  const p = prefOf({ payPref: pref });
  if (p.kind === 'daily' || p.kind === 'approval') return today; // approval: listed every day, waits for the owner
  if (p.kind === 'bill') return null;
  if (p.kind === 'month-end') return isMonthEnd(today) ? today : addDays(today.slice(0, 8) + '01', -1);
  const d = `${today.slice(0, 8)}${String(p.day).padStart(2, '0')}`;
  return d <= today ? d : `${addDays(today.slice(0, 8) + '01', -1).slice(0, 8)}${String(p.day).padStart(2, '0')}`;
}

/** Is a farmer with this preference due today? lastPaidOn = date of their last payout run (or null). */
export function isDue(pref, today, lastPaidOn) {
  const p = prefOf({ payPref: pref });
  if (p.kind === 'bill') return true; // only final bills count (the caller decides what is payable)
  const a = anchorDate(p, today);
  return !lastPaidOn || lastPaidOn < a;
}

/** Next date this preference pays after `today` (for the farmer's page). */
export function nextPayDate(pref, today) {
  const p = prefOf({ payPref: pref });
  if (p.kind === 'daily') return addDays(today, 1);
  if (p.kind === 'bill' || p.kind === 'approval') return null;
  for (let d = addDays(today, 1), i = 0; i < 62; d = addDays(d, 1), i++) if (anchorDate(p, d) === d) return d;
  return null;
}

/**
 * Owner's limits on a list of candidates [{ farmerId, code, amountPaise, ... }] (ordered by farmer code):
 * fee (when the farmer pays it), minimum, per-farmer cap, daily total cap. Returns items with sendPaise and a reason
 * when they are held back ('below-min' | 'cap-day').
 */
export function applyLimits(cands, conf) {
  const c = { ...PAYOUT_DEFAULTS, ...conf };
  let total = 0;
  return cands.map((x) => {
    let send = x.amountPaise;
    if (c.perFarmerCapPaise > 0) send = Math.min(send, c.perFarmerCapPaise);
    if (c.perTxnLimitPaise > 0) send = Math.min(send, c.perTxnLimitPaise);
    const fee = c.feeBy === 'farmer' ? c.feePaise : 0;
    const credit = send - fee; // what reaches the farmer
    if (credit < c.minPaise || credit <= 0) return { ...x, sendPaise: 0, creditPaise: 0, feeFromFarmerPaise: 0, held: 'below-min' };
    if (c.dailyCapPaise > 0 && total + credit > c.dailyCapPaise) return { ...x, sendPaise: 0, creditPaise: 0, feeFromFarmerPaise: 0, held: 'cap-day' };
    total += credit;
    return { ...x, sendPaise: send, creditPaise: credit, feeFromFarmerPaise: fee, held: null, capped: send < x.amountPaise };
  });
}
