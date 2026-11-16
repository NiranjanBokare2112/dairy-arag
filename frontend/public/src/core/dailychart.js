// "रोजचे दूध" — daily milk as a stacked column chart (cow + buffalo = day total).
// Built per the dataviz method: one y-axis in litres with a "nice" 0-based scale, recessive gridlines,
// thin columns with rounded tops, a 2px gap between the stacked segments, a legend (2 series) plus
// selective direct labels (totals on top only when they fit), a dashed average line and a hover/tap/focus
// tooltip. Exact numbers per day are in each column's tooltip and screen-reader label. Colours: brand blue (cow) / brand green (buffalo) — validated for
// colour-blind separation and ≥3:1 contrast. Days outside the chosen period (context) are faded.
import { html, raw } from './dom.js';
import { t } from './i18n.js';
import * as fmt from './format.js';
import { fmtDayMonth } from '../lib/dates.js';

/** 0-based axis: ~4 ticks on a 1/2/2.5/5 × 10ⁿ step. Values in litres×100. */
function niceScale(maxX100) {
  const max = Math.max(1, maxX100 / 100);
  const raw0 = max / 4; const p = 10 ** Math.floor(Math.log10(raw0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw0);
  const top = Math.ceil(max / step) * step;
  const ticks = []; for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return { top: top * 100, ticks };
}

const l = (x100) => fmt.litres(x100);
const tickLabel = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/**
 * rows: [{ date, cowX100, buffaloX100, litresX100, inRange }]; today: 'YYYY-MM-DD'.
 * Returns html; call bindDailyChart(root) once to enable the tooltip.
 */
export function dailyChart(rows, { today }) {
  if (!rows.length) return '';
  const { top, ticks } = niceScale(Math.max(...rows.map((r) => r.litresX100)));
  const pct = (x100) => (x100 / top) * 100;
  const shown = rows.filter((r) => r.inRange && r.litresX100 > 0); // average over days with collection only
  const avg = shown.length ? Math.round(shown.reduce((s, r) => s + r.litresX100, 0) / shown.length) : 0;
  const n = rows.length;
  // x labels: day number only (full date is in the tooltip); thin them out so they never collide on phones
  const labelEvery = n > 20 ? Math.ceil(n / 8) : n > 10 ? 2 : 1;
  // Direct labels only where they fit: every column up to 10 days, otherwise just the highest and today.
  const maxRow = rows.reduce((a, b) => (b.litresX100 > a.litresX100 ? b : a), rows[0]);
  const showTotal = (r) => n <= 10 || r === maxRow || r.date === today;

  return html`<div class="dchart" data-dchart>
    <div class="legend dc-legend"><span><i style="background:var(--series-cow)"></i>${t('milk.cow')}</span><span><i style="background:var(--series-buf)"></i>${t('milk.buffalo')}</span>
      ${avg ? html`<span><i class="dc-avg-key"></i>${t('dash.avgLine', { l: l(avg) })}</span>` : ''}</div>
    <div class="dc-area">
      <div class="dc-y" aria-hidden="true">${ticks.slice().reverse().map((v) => html`<span style="bottom:${pct(v * 100)}%">${tickLabel(v)}</span>`)}</div>
      <div class="dc-plot">
        ${ticks.map((v) => html`<div class="dc-grid ${v === 0 ? 'base' : ''}" style="bottom:${pct(v * 100)}%"></div>`)}
        ${avg ? html`<div class="dc-avg" style="bottom:${pct(avg)}%" aria-hidden="true"></div>` : ''}
        <div class="dc-cols" style="--n:${n}">
          ${rows.map((r, i) => html`<button type="button" class="dc-col ${r.inRange ? '' : 'ctx'} ${r.date === today ? 'is-today' : ''}" data-i="${i}"
              aria-label="${fmt.date(r.date)}: ${t('milk.cow')} ${l(r.cowX100)}, ${t('milk.buffalo')} ${l(r.buffaloX100)}, ${t('common.total')} ${l(r.litresX100)} ${t('unit.l')}">
            <span class="dc-stack" style="height:${pct(r.litresX100).toFixed(2)}%">
              ${showTotal(r) && r.litresX100 ? html`<b class="dc-total">${Math.round(r.litresX100 / 100)}</b>` : ''}
              ${r.cowX100 ? html`<i class="dc-seg cow" style="flex:${r.cowX100}"></i>` : ''}
              ${r.buffaloX100 ? html`<i class="dc-seg buf" style="flex:${r.buffaloX100}"></i>` : ''}
            </span>
          </button>`)}
        </div>
        <div class="dc-tip" role="status" hidden></div>
      </div>
    </div>
    <div class="dc-x" style="--n:${n}" aria-hidden="true">${rows.map((r, i) => html`<span class="${r.date === today ? 'is-today' : ''}">${r.date === today ? t('dp.today') : ((n - 1 - i) % labelEvery === 0 ? (n <= 7 ? fmtDayMonth(r.date) : String(Number(r.date.slice(8)))) : '')}</span>`)}</div>
    <p class="dc-unit small muted">${t('dash.unitNote')}</p>
    <script type="application/json" class="dc-data">${raw(JSON.stringify(rows.map((r) => [r.date, r.cowX100, r.buffaloX100, r.litresX100])).replace(/</g, '\\u003c'))}</script>
  </div>`;
}

/** Tooltip on hover, keyboard focus and tap; follows the column, stays inside the plot. */
export function bindDailyChart(root) {
  root.querySelectorAll('[data-dchart]').forEach((chart) => {
    const rows = JSON.parse(chart.querySelector('.dc-data').textContent);
    const tip = chart.querySelector('.dc-tip'); const plot = chart.querySelector('.dc-plot');
    let pinned = null;
    const show = (btn) => {
      const [date, cow, buf, total] = rows[Number(btn.dataset.i)];
      tip.innerHTML = String(html`<b>${fmt.date(date)}</b>
        <div><i style="background:var(--series-cow)"></i>${t('milk.cow')}<span>${l(cow)}</span></div>
        <div><i style="background:var(--series-buf)"></i>${t('milk.buffalo')}<span>${l(buf)}</span></div>
        <div class="tot">${t('common.total')}<span>${l(total)} ${t('unit.l')}</span></div>`);
      tip.hidden = false;
      const pr = plot.getBoundingClientRect(); const br = btn.getBoundingClientRect(); const w = tip.offsetWidth;
      const x = Math.min(Math.max(0, br.left - pr.left + br.width / 2 - w / 2), pr.width - w);
      tip.style.left = x + 'px';
      chart.querySelectorAll('.dc-col.hot').forEach((c) => c.classList.remove('hot')); btn.classList.add('hot');
    };
    const hide = () => { if (pinned) return; tip.hidden = true; chart.querySelectorAll('.dc-col.hot').forEach((c) => c.classList.remove('hot')); };
    chart.addEventListener('pointerover', (e) => { const b = e.target.closest('.dc-col'); if (b && e.pointerType === 'mouse') show(b); });
    chart.addEventListener('pointerleave', () => hide());
    chart.addEventListener('focusin', (e) => { const b = e.target.closest('.dc-col'); if (b) show(b); });
    chart.addEventListener('focusout', () => { pinned = null; hide(); });
    chart.addEventListener('click', (e) => { // tap on phones: pin / unpin
      const b = e.target.closest('.dc-col'); if (!b) return;
      if (pinned === b) { pinned = null; hide(); } else { pinned = b; show(b); }
    });
  });
}
