// Fixed-decimal quantities stored as integers.
// Litres: 2 places (litresX100). Fat / SNF: 1 place (fatX10, snfX10).

/** Parse "6.5" with up to `places` decimals into an integer scaled by 10^places, or null. */
export function parseFixed(input, places) {
  if (typeof input === 'number') input = String(input);
  if (typeof input !== 'string') return null;
  const s = input.trim();
  const re = new RegExp('^(\\d+)(?:\\.(\\d{0,' + places + '}))?$');
  const m = re.exec(s);
  if (!m) return null;
  return Number(m[1]) * 10 ** places + Number((m[2] || '').padEnd(places, '0') || 0);
}

export function formatFixed(int, places) {
  if (int == null) return '';
  const neg = int < 0;
  const a = Math.abs(int);
  const f = 10 ** places;
  const whole = Math.floor(a / f);
  const frac = String(a % f).padStart(places, '0');
  return (neg ? '-' : '') + whole + (places ? '.' + frac : '');
}

export const parseLitres = (s) => parseFixed(s, 2);
export const parseTenths = (s) => parseFixed(s, 1);
export const fmtLitres = (n) => formatFixed(n, 2);
export const fmtTenths = (n) => formatFixed(n, 1);

// Sensible input bounds for validation (owner can widen later via settings if needed).
export const LIMITS = {
  litresX100: { min: 1, max: 20000 },  // 0.01 – 200.00 L per pour
  fatX10: { min: 10, max: 150 },       // 1.0 – 15.0 %
  snfX10: { min: 50, max: 120 },       // 5.0 – 12.0 %
};
