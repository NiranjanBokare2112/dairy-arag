// Money is always integer paise. Never floats. (CLAUDE.md §6)
// Rounding rule R1: amount = litres × rate, rounded to the nearest paisa, half-up.

/** Parse a rupee string like "33.5" / "1,450.00" into integer paise, or null if invalid. */
export function toPaise(input) {
  if (typeof input === 'number') input = String(input);
  if (typeof input !== 'string') return null;
  const s = input.replace(/,/g, '').trim();
  const m = /^(-)?(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const paise = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0'));
  return m[1] ? -paise : paise;
}

/** Integer division with half-up rounding (for non-negative numerator, positive divisor). */
export function divRoundHalfUp(num, den) {
  if (!Number.isInteger(num) || !Number.isInteger(den) || den <= 0) throw new TypeError('integers required');
  const sign = num < 0 ? -1 : 1;
  const a = Math.abs(num);
  return sign * Math.floor((a + Math.floor(den / 2)) / den);
}

/** litresX100 (centilitres) × rate (paise per litre) → paise, rule R1. */
export function amountFor(litresX100, ratePaise) {
  return divRoundHalfUp(litresX100 * ratePaise, 100);
}

/** Format paise as "3,831.51" (Indian grouping). */
export function formatRupees(paise, { symbol = false } = {}) {
  const neg = paise < 0;
  const a = Math.abs(paise);
  const rupees = Math.floor(a / 100);
  const ps = String(a % 100).padStart(2, '0');
  const s = groupIndian(String(rupees)) + '.' + ps;
  return (neg ? '-' : '') + (symbol ? '₹ ' : '') + s;
}

function groupIndian(digits) {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return rest + ',' + last3;
}
