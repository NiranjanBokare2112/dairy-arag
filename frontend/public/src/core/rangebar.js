// One date filter for every list (D-55): आज · ७ / १५ / ३० दिवस · सुरुवातीपासून · निवडक तारखा.
// Same look and URL as the dashboard (?range=7 | ?range=all | ?from=…&to=…); other query keys
// (tab, user, status…) are kept when the range changes.
import { html, on } from './dom.js';
import { t } from './i18n.js';
import * as fmt from './format.js';
import { openRangePicker } from './datepicker.js';
import { navigate } from './router.js';
import { customRange, presetRange, rangeDays } from '../lib/ranges.js';

const CHIPS = ['today', '7', '15', '30', 'all'];

/** The range asked for in the URL. def = preset used when the URL has none ('today' | '7' | '15' | '30' | 'all'). */
export function rangeOf(query, today, def = '30') {
  if (query.from || query.to) { const r = customRange(query.from, query.to, today); if (r) return { ...r, preset: 'custom' }; }
  const p = CHIPS.includes(query.range) ? query.range : def;
  if (p === 'all') return { from: '0000-01-01', to: today, preset: 'all', all: true };
  return { ...presetRange(p, today), preset: p };
}

/** true if an IST date 'YYYY-MM-DD' (or an ISO timestamp) falls in the range. */
export const inRange = (r, d) => { const x = String(d || '').slice(0, 10); return x >= r.from && x <= r.to; };

const keep = (query) => Object.fromEntries(Object.entries(query).filter(([k, v]) => !['range', 'from', 'to'].includes(k) && v !== '' && v != null));
const href = (path, query, extra) => `#${path}?${new URLSearchParams({ ...keep(query), ...extra })}`;

/** The chip bar + "DD/MM/YYYY – DD/MM/YYYY · n दिवस · count" line. */
export function rangeBar(path, query, range, { count, unit = '' } = {}) {
  const chip = (p) => html`<a class="chip-btn ${range.preset === p ? 'on' : ''}" href="${href(path, query, { range: p })}" ${range.preset === p ? html`aria-current="true"` : ''}>${t(p === 'all' ? 'my.range.all' : 'dash.range.' + p)}</a>`;
  const period = range.all ? t('my.range.all') : range.from === range.to ? fmt.date(range.from) : `${fmt.date(range.from)} – ${fmt.date(range.to)}`;
  return html`<div class="range-bar" role="group" aria-label="${t('dash.filter')}">
    <div class="chips">${CHIPS.map(chip)}<button type="button" class="chip-btn ${range.preset === 'custom' ? 'on' : ''}" data-range-custom aria-haspopup="dialog" aria-expanded="false">${t('dash.range.custom')}</button></div>
    <p class="dash-period"><b>${period}</b>${range.all ? '' : html` <span class="muted">· ${t('dash.days', { n: rangeDays(range) })}</span>`}${count != null ? html` <span class="muted">· ${count} ${unit}</span>` : ''}</p>
  </div>`;
}

/**
 * The one place for the date filter on every page (D-66): a full-width card right under the page title, or under
 * the tabs when the page has tabs, before anything else. Other filters of the page (person, type…) go in `extra`,
 * on the same card; `note` is a small line under the dates.
 */
export function filterCard(path, query, range, opts = {}, { extra = '', note = '' } = {}) {
  return html`<section class="card dash-filter page-filter" aria-label="${t('dash.filter')}">
    ${extra ? html`<div class="filter-extra">${extra}</div>` : ''}${rangeBar(path, query, range, opts)}${note ? html`<p class="small muted filter-note">${note}</p>` : ''}</section>`;
}

export function bindRangeBar(el, path, query, range, today) {
  on(el, 'click', '[data-range-custom]', (_, b) => openRangePicker(b, {
    from: range.all ? today : range.from, to: range.to, max: today, title: t('dash.range.custom'),
    onApply: (r) => { const c = customRange(r.from, r.to, today); if (c) navigate(href(path, query, { from: c.from, to: c.to }).slice(1)); },
  }));
}

/** Newest first: by date, then by when it was written. */
export const newestFirst = (a, b) => (a.date === b.date ? String(b.createdAt || '').localeCompare(String(a.createdAt || '')) : a.date < b.date ? 1 : -1);
