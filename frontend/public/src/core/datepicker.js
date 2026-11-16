// Marathi date pickers (design: design-assets/date-picker.html).
//  dateField(): single date — field "रविवार, 08 नोव्हेंबर 2026" opening a calendar (popover on desktop,
//               bottom sheet on phones); आज / काल chips; Sundays red; today ringed; selected solid blue;
//               future dates/months disabled (unless max is ''); optional green dots for days with entries.
//               A hidden <input name=…> keeps the 'YYYY-MM-DD' value, so forms read it like a normal input,
//               and 'input' + 'change' events fire on it when the date changes.
//  openRangePicker(): from–to range: tap start + end (reverse taps swapped), tinted band,
//               "dd/mm/yyyy ते dd/mm/yyyy • N दिवस" footer; "निवडा" only for a complete range.
//               Optional snap(date) → {start,end} makes a tap select a whole bill cycle.
//               D-129: tapping the month name opens the 12 months of the year (‹ year ›),
//               and a tap on a month selects that whole month (the current month ends today).
// No libraries; dates are IST calendar strings throughout.
import { html, raw, mount } from './dom.js';
import { t } from './i18n.js';
import { todayIST, addDays, daysBetween, fmtDate } from '../lib/dates.js';

const pad = (n) => String(n).padStart(2, '0');
const parts = (s) => [Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))];
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const dow = (s) => { const [y, m, d] = parts(s); return new Date(Date.UTC(y, m, d)).getUTCDay(); };
const lastDay = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const shiftMonth = (y, m, n) => { const k = y * 12 + m + n; return [Math.floor(k / 12), ((k % 12) + 12) % 12]; };
const list = (key) => t(key).split(',');

export const longDate = (s) => { const [y, m, d] = parts(s); return `${list('dp.days')[dow(s)]}, ${pad(d)} ${list('dp.months')[m]} ${y}`; };
const monthTitle = (y, m) => `${list('dp.months')[m]} ${y}`;

/** Cells for a month view, Sunday-first, padded with days of the neighbouring months. */
function monthCells(y, m) {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const n = Math.ceil((first + lastDay(y, m)) / 7) * 7;
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m, 1 - first + i)).toISOString().slice(0, 10);
    return { d, inMonth: parts(d)[1] === m, day: parts(d)[2] };
  });
}

const CAL_ICON = raw('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/><rect x="7" y="13" width="4" height="4" rx="1" fill="currentColor" stroke="none"/></svg>');
const CHEVRON = raw('<svg class="dp-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>');

// ---------------------------------------------------------------- shared popup
const isPhone = () => window.matchMedia('(max-width: 640px)').matches;

/** Show `render(close)` content in a <dialog>: anchored under `anchor` on desktop, bottom sheet on phones. */
function popup(anchor, label, build) {
  const d = document.createElement('dialog');
  d.className = 'dp-pop' + (isPhone() ? ' dp-sheet' : '');
  d.setAttribute('aria-label', label);
  document.body.append(d);
  // D-131: while the calendar is open the page behind does not scroll (the scrollbar's width is kept, so nothing jumps)
  const root = document.documentElement; const was = { o: root.style.overflow, p: root.style.paddingRight };
  const bar = window.innerWidth - root.clientWidth;
  root.style.overflow = 'hidden'; if (bar > 0) root.style.paddingRight = bar + 'px';
  const unlock = () => { root.style.overflow = was.o; root.style.paddingRight = was.p; };
  const close = () => { if (d.open) d.close(); d.remove(); unlock(); anchor?.focus?.(); anchor?.setAttribute?.('aria-expanded', 'false'); };
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.addEventListener('mousedown', (e) => { if (e.target === d) close(); }); // tap on the backdrop
  build(d, close);
  d.showModal();
  if (!isPhone() && anchor) { // place under (or above) the field, inside the viewport
    const r = anchor.getBoundingClientRect(); const w = d.offsetWidth; const h = d.offsetHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    d.style.left = left + 'px';
    d.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - 6 - h)) + 'px';
  }
  anchor?.setAttribute?.('aria-expanded', 'true');
  (d.querySelector('[aria-pressed="true"]:not([disabled])') || d.querySelector('.dp-day:not([disabled])'))?.focus();
  return close;
}

/** Arrow keys move between days (±1 day, ±1 week); Home/End = week start/end. */
function dayKeys(d, onMove) {
  d.addEventListener('keydown', (e) => {
    const b = e.target.closest('.dp-day'); if (!b) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault(); onMove(addDays(b.dataset.d, step));
  });
}

// ---------------------------------------------------------------- single date
/**
 * Markup for a single-date field. opts: { name, value, min, max ('' = no limit, default today), disabled, label, id, attrs }
 * Call bindDateFields(root, { marked }) once per page to make the fields work.
 */
export function dateField({ name, value, min = '', max, disabled = false, label = '', id = '', attrs = '' } = {}) {
  const mx = max === undefined ? todayIST() : max;
  const v = value || todayIST();
  return html`<span class="dp-wrap">
    ${label ? html`<span class="dp-label">${label}</span>` : ''}
    <input type="hidden" name="${name}" value="${v}" ${raw(attrs)}>
    <button type="button" class="dp-field" data-dp="${name}" data-min="${min}" data-max="${mx}" aria-haspopup="dialog" aria-expanded="false" ${id ? html`id="${id}"` : ''} ${disabled ? 'disabled' : ''}
      aria-label="${(label || t('common.date')) + ': ' + longDate(v)}">${CAL_ICON}<span class="dp-text">${longDate(v)}</span>${disabled ? '' : CHEVRON}</button>
  </span>`;
}

/** Wire every dateField inside `root`. opts.marked(from, to) → Promise<Set<'YYYY-MM-DD'>> adds green dots. */
export function bindDateFields(root, opts = {}) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.dp-field'); if (!btn || btn.disabled || !root.contains(btn)) return;
    const input = btn.parentElement.querySelector(`input[type=hidden][name="${btn.dataset.dp}"]`);
    openDate(btn, input, { min: btn.dataset.min, max: btn.dataset.max, marked: opts.marked });
  });
}

/** Programmatically change a dateField's value (fires input + change). */
export function setDateField(input, value) {
  input.value = value;
  const btn = input.parentElement.querySelector('.dp-field');
  if (btn) { btn.querySelector('.dp-text').textContent = longDate(value); btn.setAttribute('aria-label', `${t('common.date')}: ${longDate(value)}`); }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function openDate(btn, input, { min, max, marked }) {
  const today = todayIST(); const yesterday = addDays(today, -1);
  let sel = input.value || today;
  let [vy, vm] = parts(sel);
  let dots = new Set();
  const allowed = (d) => (!max || d <= max) && (!min || d >= min);
  const futureMonth = (y, m) => !!max && y * 12 + m >= parts(max)[0] * 12 + parts(max)[1]; // no months after max

  popup(btn, t('dp.pickDate'), (d, close) => {
    const pick = (day) => { if (!allowed(day)) return; setDateField(input, day); close(); };
    const draw = () => {
      const cells = monthCells(vy, vm);
      mount(d, html`<div class="dp-box">
        <div class="dp-chips">
          ${allowed(today) ? html`<button type="button" class="dp-chip ${sel === today ? 'on' : ''}" data-go="${today}">${t('dp.today')}</button>` : ''}
          ${allowed(yesterday) ? html`<button type="button" class="dp-chip ${sel === yesterday ? 'on' : ''}" data-go="${yesterday}">${t('dp.yesterday')}</button>` : ''}
        </div>
        <div class="dp-head">
          <button type="button" class="dp-nav" data-nav="-1" aria-label="${t('dp.prevMonth')}" ${min && iso(vy, vm, 1) <= min ? 'disabled' : ''}>‹</button>
          <div class="dp-title" aria-live="polite">${monthTitle(vy, vm)}</div>
          <button type="button" class="dp-nav" data-nav="1" aria-label="${t('dp.nextMonth')}" ${futureMonth(vy, vm) ? 'disabled' : ''}>›</button>
        </div>
        <div class="dp-week">${list('dp.weekdays').map((w, i) => html`<div class="${i === 0 ? 'sun' : ''}">${w}</div>`)}</div>
        <div class="dp-grid" role="grid">${cells.map((c) => {
          const dis = !allowed(c.d); const on = c.d === sel; const isToday = c.d === today;
          return html`<button type="button" class="dp-day ${c.inMonth ? '' : 'out'} ${dow(c.d) === 0 ? 'sun' : ''} ${isToday ? 'today' : ''} ${on ? 'sel' : ''}"
            data-d="${c.d}" ${dis ? 'disabled' : ''} aria-pressed="${String(on)}" aria-label="${longDate(c.d)}${dis ? ' — ' + t('dp.notAllowed') : ''}">${c.day}${marked && dots.has(c.d) && !dis ? html`<i class="dp-dot"></i>` : ''}</button>`;
        })}</div>
        ${marked ? html`<div class="dp-legend"><span><i class="lg-dot"></i>${t('dp.hasEntries')}</span><span><i class="lg-today"></i>${t('dp.today')}</span><span><i class="lg-sel"></i>${t('dp.selected')}</span></div>` : ''}
      </div>`);
    };
    const load = async () => {
      if (!marked) return;
      const from = iso(vy, vm, 1); const to = iso(vy, vm, lastDay(vy, vm));
      try { dots = await marked(from, to); } catch { dots = new Set(); }
      if (d.open) { const focused = document.activeElement?.dataset?.d; draw(); if (focused) d.querySelector(`[data-d="${focused}"]`)?.focus(); }
    };
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.close != null) close();
      else if (b.dataset.go) pick(b.dataset.go);
      else if (b.dataset.nav) { [vy, vm] = shiftMonth(vy, vm, Number(b.dataset.nav)); draw(); load(); d.querySelector('.dp-nav[data-nav="' + b.dataset.nav + '"]')?.focus(); }
      else if (b.dataset.d) pick(b.dataset.d);
    });
    dayKeys(d, (to) => {
      if (!allowed(to)) return;
      const [y, m] = parts(to); if (y !== vy || m !== vm) { vy = y; vm = m; draw(); load(); }
      d.querySelector(`[data-d="${to}"]`)?.focus();
    });
    draw(); load();
  });
}

// ---------------------------------------------------------------- range
/**
 * Open the range picker. opts: { from, to, max (default today), presets: [{label, from, to}] (optional quick chips), snap(date)→{start,end}, title, onApply({from,to}) }
 */
export function openRangePicker(anchor, { from, to, max, presets = [], snap, title, onApply }) {
  const today = todayIST(); const mx = max === undefined ? today : max;
  let rs = from || today, re = to || from || today, picking = false, view = 'days'; // view: 'days' | 'months'
  let [vy, vm] = parts(re > mx && mx ? mx : re);
  const allowed = (d) => !mx || d <= mx;
  // D-129: whole months — the month on view, this month, last month (a month never goes past max / today)
  const monthRange = (y, m) => { const a = iso(y, m, 1); const b = iso(y, m, lastDay(y, m)); return { from: a, to: mx && b > mx ? mx : b }; };
  const chips = presets;

  popup(anchor, title || t('dp.pickRange'), (d, close) => {
    const draw = () => {
      const lo = rs, hi = picking ? rs : re;
      const complete = !picking && !!re;
      const presetOn = chips.findIndex((p) => !picking && p.from === rs && p.to === re);
      // no ✕ (D-130): close with रद्द करा, a tap outside or Esc
      const chipRow = chips.length ? html`<div class="dp-chips">${chips.map((p, i) => html`<button type="button" class="dp-chip ${i === presetOn ? 'on' : ''}" data-preset="${i}">${p.label}</button>`)}</div>` : '';
      const foot = html`<div class="dp-foot">
          <div><div class="dp-rtext">${complete ? `${fmtDate(rs)} ${t('dp.to')} ${fmtDate(re)}` : `${fmtDate(rs)} ${t('dp.to')} …`}</div>
            <div class="dp-rhint">${complete ? t('dp.daysN', { n: daysBetween(rs, re) + 1 }) : t('dp.tapEnd')}</div></div>
          <div class="row"><button type="button" class="btn btn-ghost" data-close>${t('common.cancel')}</button>
            <button type="button" class="btn btn-green" data-apply ${complete ? '' : 'disabled'}>${t('dp.apply')}</button></div>
        </div>`;
      if (view === 'months') { // D-129: the 12 months of the year; a tap selects the whole month
        const [my, mm] = parts(mx || '9999-12-31');
        mount(d, html`<div class="dp-box dp-range">${chipRow}
          <div class="dp-head">
            <button type="button" class="dp-nav" data-ynav="-1" aria-label="${t('dp.prevYear')}">‹</button>
            <button type="button" class="dp-title dp-title-btn" data-days aria-label="${t('dp.backToDays')}">${vy}</button>
            <button type="button" class="dp-nav" data-ynav="1" aria-label="${t('dp.nextYear')}" ${vy >= my ? 'disabled' : ''}>›</button>
          </div>
          <div class="dp-months">${list('dp.months').map((name, m) => { const r = monthRange(vy, m); const on = !picking && rs === r.from && re === r.to;
            const future = vy > my || (vy === my && m > mm); const now = vy === parts(today)[0] && m === parts(today)[1];
            return html`<button type="button" class="dp-mon ${on ? 'sel' : ''} ${now ? 'today' : ''}" data-m="${m}" ${future ? 'disabled' : ''} aria-pressed="${String(on)}">${name}</button>`; })}</div>
          ${foot}</div>`);
        return;
      }
      mount(d, html`<div class="dp-box dp-range">
        ${chipRow}
        <div class="dp-head">
          <button type="button" class="dp-nav" data-nav="-1" aria-label="${t('dp.prevMonth')}">‹</button>
          ${snap ? html`<div class="dp-title" aria-live="polite">${monthTitle(vy, vm)}</div>`
            : html`<button type="button" class="dp-title dp-title-btn" data-months aria-live="polite" aria-label="${t('dp.pickMonth')}">${monthTitle(vy, vm)} ${CHEVRON}</button>`}
          <button type="button" class="dp-nav" data-nav="1" aria-label="${t('dp.nextMonth')}" ${mx && vy * 12 + vm >= parts(mx)[0] * 12 + parts(mx)[1] ? 'disabled' : ''}>›</button>
        </div>
        <div class="dp-week">${list('dp.weekdays').map((w, i) => html`<div class="${i === 0 ? 'sun' : ''}">${w}</div>`)}</div>
        <div class="dp-grid" role="grid">${monthCells(vy, vm).map((c) => {
          const dis = !allowed(c.d); const edge = c.d === lo || c.d === hi; const inside = c.d > lo && c.d < hi;
          const band = c.inMonth && (inside || (edge && lo !== hi));
          const cap = c.d === lo && lo !== hi ? 'start' : c.d === hi && lo !== hi ? 'end' : '';
          return html`<div class="dp-cell ${band ? 'band' : ''} ${cap}"><button type="button" class="dp-day ${c.inMonth ? '' : 'out'} ${dow(c.d) === 0 ? 'sun' : ''} ${c.d === today ? 'today' : ''} ${edge && c.inMonth ? 'sel' : ''} ${inside && c.inMonth ? 'mid' : ''}"
            data-d="${c.d}" ${dis ? 'disabled' : ''} aria-pressed="${String(edge || inside)}" aria-label="${longDate(c.d)}">${c.day}</button></div>`;
        })}</div>
        ${foot}
      </div>`);
    };
    const tap = (day) => {
      if (!allowed(day)) return;
      if (snap) { const c = snap(day); rs = c.start; re = c.end; picking = false; return; }
      if (!picking) { rs = day; re = null; picking = true; }
      else if (day < rs) { re = rs; rs = day; picking = false; }
      else { re = day; picking = false; }
    };
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.close != null) { close(); return; }
      if (b.dataset.apply != null) { close(); onApply?.({ from: rs, to: re }); return; }
      if (b.dataset.preset) { const p = chips[+b.dataset.preset]; rs = p.from; re = p.to; picking = false; [vy, vm] = parts(p.from); view = 'days'; }
      else if (b.dataset.months != null) view = 'months';
      else if (b.dataset.days != null) view = 'days';
      else if (b.dataset.ynav) vy += Number(b.dataset.ynav);
      else if (b.dataset.m != null) { vm = Number(b.dataset.m); const r = monthRange(vy, vm); rs = r.from; re = r.to; picking = false; view = 'days'; }
      else if (b.dataset.nav) { [vy, vm] = shiftMonth(vy, vm, Number(b.dataset.nav)); }
      else if (b.dataset.d) tap(b.dataset.d);
      const focusD = b.dataset.d; draw();
      if (focusD) d.querySelector(`[data-d="${focusD}"]`)?.focus();
    });
    dayKeys(d, (to) => { if (!allowed(to)) return; const [y, m] = parts(to); if (y !== vy || m !== vm) { vy = y; vm = m; draw(); } d.querySelector(`[data-d="${to}"]`)?.focus(); });
    draw();
  });
}

/** A field-looking button that shows a range and opens the range picker. */
export const rangeButton = ({ from, to, attrs = '' }) => html`<button type="button" class="dp-field dp-range-field" ${raw(attrs)} aria-haspopup="dialog" aria-expanded="false">${CAL_ICON}<span class="dp-text">${fmtDate(from)} ${t('dp.to')} ${fmtDate(to)}</span><span class="dp-days">${t('dp.daysN', { n: daysBetween(from, to) + 1 })}</span>${CHEVRON}</button>`;
