// All business dates are IST calendar dates as 'YYYY-MM-DD' strings. Display DD/MM/YYYY.
const IST = 'Asia/Kolkata';

function partsIST(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const o = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour), minute: Number(o.minute) };
}

export const todayIST = (now = new Date()) => partsIST(now).date;

/** Morning before 14:00 IST, evening after (UI can always override). */
export const currentShift = (now = new Date()) => (partsIST(now).hour < 14 ? 'morning' : 'evening');

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export const fmtDayMonth = (iso) => fmtDate(iso).slice(0, 5);

export function fmtDateTime(isoTs) {
  if (!isoTs) return '';
  const d = new Date(isoTs);
  const { date, hour, minute } = partsIST(d);
  return `${fmtDate(date)} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const t = (s) => Date.UTC(...s.split('-').map((x, i) => (i === 1 ? x - 1 : +x)));
  return Math.round((t(b) - t(a)) / 86400000);
}

export function lastDayOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Parse 'DD/MM/YYYY' → 'YYYY-MM-DD' or null. */
export function parseDisplayDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Current IST time as 'HH:MM' (24 h) — the owner's payout time is compared with it (D-107). */
export const nowHHMM = (now = new Date()) => { const p = partsIST(now); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
