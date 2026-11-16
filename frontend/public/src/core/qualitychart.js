// "सरासरी फॅट / SNF" — two small line charts (Fat, SNF) sharing one date axis and one hover layer.
// Two measures on different scales → two panels, never a dual axis. Each panel has its own y labels
// (non-zero baseline is fine for a line), recessive gridlines, a 2px line, a marker on the last point,
// and gaps on days without milk. Hover / tap / keyboard: a vertical guide across both panels, dots on
// both lines and a tooltip with the date, Fat and SNF. Each day's hit area has an aria-label with the numbers.
import { html, raw } from './dom.js';
import { t } from './i18n.js';
import * as fmt from './format.js';
import { fmtDayMonth } from '../lib/dates.js';

const W = 600; const H = 100; // SVG drawing units; stretched to the panel, strokes stay 2px (non-scaling)

/** Padded y-domain on a 0.05/0.1/0.2/0.25/0.5 step, ~3 ticks. Values ×100 (e.g. 482 = 4.82). */
function domain(vals) {
  if (!vals.length) return { lo: 0, hi: 1, ticks: [] };
  let lo = Math.min(...vals) / 100; let hi = Math.max(...vals) / 100;
  if (hi - lo < 0.1) { lo -= 0.05; hi += 0.05; }
  const step = [0.05, 0.1, 0.2, 0.25, 0.5, 1].find((s) => (hi - lo) / s <= 3) || 1;
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const ticks = []; for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(2));
  return { lo, hi, ticks };
}

function panel(rows, key, color, label) {
  const vals = rows.map((r) => r[key]).filter((v) => v > 0);
  const { lo, hi, ticks } = domain(vals);
  const n = rows.length;
  const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v) => H - ((v / 100 - lo) / (hi - lo || 1)) * H;
  // break the line on days without milk
  let d = ''; let pen = false;
  rows.forEach((r, i) => { if (r[key] > 0) { d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`; pen = true; } else pen = false; });
  const lastI = rows.map((r) => r[key] > 0).lastIndexOf(true);
  const pct = (v) => ((v - lo) / (hi - lo || 1)) * 100;
  return html`<div class="qc-panel">
    <div class="qc-name"><i style="background:${color}"></i>${label}</div>
    <div class="qc-area">
      <div class="qc-y" aria-hidden="true">${ticks.map((v) => html`<span style="bottom:${pct(v)}%">${v.toFixed(2)}</span>`)}</div>
      <div class="qc-plot">
        ${ticks.map((v) => html`<div class="dc-grid" style="bottom:${pct(v)}%"></div>`)}
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
        ${lastI >= 0 ? html`<span class="qc-dot last" style="left:${(x(lastI) / W) * 100}%;bottom:${pct(rows[lastI][key] / 100)}%;background:${color}"></span>` : ''}
        <span class="qc-dot hover" data-key="${key}" style="background:${color}" hidden></span>
      </div>
    </div>
  </div>`;
}

/** rows: trend [{ date, avgFatX100, avgSnfX100, inRange }]. Call bindQualityChart(root) for the tooltip. */
export function qualityChart(rows, { today, avgFatX100, avgSnfX100 } = {}) {
  if (!rows.some((r) => r.avgFatX100 > 0)) return html`<div class="empty">—</div>`;
  // no caption above the chart: the basis is in the title's ⓘ, the period average in the figure cards above
  const n = rows.length;
  // dates as DD/MM, thinned so they never collide (≈6 labels on a 30-day range); the newest day is always labelled
  const labelEvery = n > 20 ? Math.ceil(n / 6) : n > 10 ? 3 : n > 7 ? 2 : 1;
  const cols = rows.map((r, i) => html`<button type="button" class="qc-hit" data-i="${i}" style="left:${n === 1 ? 0 : ((i - 0.5) / (n - 1)) * 100}%;width:${n === 1 ? 100 : 100 / (n - 1)}%"
    aria-label="${fmt.date(r.date)}: ${t('dash.avgFat')} ${r.avgFatX100 ? fmt.hundredths(r.avgFatX100) : '—'}, ${t('dash.avgSnf')} ${r.avgSnfX100 ? fmt.hundredths(r.avgSnfX100) : '—'}"></button>`);
  return html`<div class="qchart" data-qchart><div class="qc-body">
    ${panel(rows, 'avgFatX100', 'var(--series-fat)', t('dash.avgFat'))}
    ${panel(rows, 'avgSnfX100', 'var(--series-snf)', t('dash.avgSnf'))}
    <div class="qc-x" aria-hidden="true"><span></span><div>${rows.map((r, i) => html`<span class="${r.date === today ? 'is-today' : ''}" style="left:${n === 1 ? 50 : (i / (n - 1)) * 100}%">${(n - 1 - i) % labelEvery === 0 ? fmtDayMonth(r.date) : ''}</span>`)}</div></div>
    <div class="qc-hits"><span></span><div class="qc-hitrow">${cols}<span class="qc-guide" hidden></span><div class="dc-tip qc-tip" role="status" hidden></div></div></div>
    </div>
    <script type="application/json" class="qc-data">${raw(JSON.stringify(rows.map((r) => [r.date, r.avgFatX100, r.avgSnfX100])).replace(/</g, '\\u003c'))}</script>
  </div>`;
}

export function bindQualityChart(root) {
  root.querySelectorAll('[data-qchart]').forEach((chart) => {
    const rows = JSON.parse(chart.querySelector('.qc-data').textContent);
    const n = rows.length;
    const tip = chart.querySelector('.qc-tip'); const guide = chart.querySelector('.qc-guide'); const row = chart.querySelector('.qc-hitrow');
    const panels = [...chart.querySelectorAll('.qc-panel')];
    const doms = panels.map((p) => { const ys = [...p.querySelectorAll('.qc-y span')].map((s) => Number(s.textContent)); return { lo: ys[0], hi: ys[ys.length - 1] }; });
    let pinned = null;
    const show = (i) => {
      const [date, fat, snf] = rows[i];
      const leftPct = n === 1 ? 50 : (i / (n - 1)) * 100;
      guide.hidden = false; guide.style.left = leftPct + '%';
      [fat, snf].forEach((v, k) => {
        const dot = panels[k].querySelector('.qc-dot.hover');
        if (!v) { dot.hidden = true; return; }
        const { lo, hi } = doms[k];
        dot.hidden = false; dot.style.left = leftPct + '%'; dot.style.bottom = (((v / 100 - lo) / (hi - lo || 1)) * 100) + '%';
      });
      tip.innerHTML = String(html`<b>${fmt.date(date)}</b>
        <div><i style="background:var(--series-fat)"></i>${t('dash.avgFat')}<span>${fat ? fmt.hundredths(fat) : '—'}</span></div>
        <div><i style="background:var(--series-snf)"></i>${t('dash.avgSnf')}<span>${snf ? fmt.hundredths(snf) : '—'}</span></div>
        ${!fat ? html`<div class="small muted">${t('dash.noMilkDay')}</div>` : ''}`);
      tip.hidden = false;
      const w = row.getBoundingClientRect().width; const tw = tip.offsetWidth;
      const px = (leftPct / 100) * w;
      tip.style.left = Math.min(Math.max(0, px + 12 + tw > w ? px - 12 - tw : px + 12), w - tw) + 'px';
    };
    const hide = () => { if (pinned != null) return; tip.hidden = true; guide.hidden = true; panels.forEach((p) => { p.querySelector('.qc-dot.hover').hidden = true; }); };
    chart.addEventListener('pointerover', (e) => { const b = e.target.closest('.qc-hit'); if (b && e.pointerType === 'mouse') show(Number(b.dataset.i)); });
    chart.addEventListener('pointerleave', hide);
    chart.addEventListener('focusin', (e) => { const b = e.target.closest('.qc-hit'); if (b) show(Number(b.dataset.i)); });
    chart.addEventListener('focusout', () => { pinned = null; hide(); });
    chart.addEventListener('click', (e) => {
      const b = e.target.closest('.qc-hit'); if (!b) return;
      const i = Number(b.dataset.i);
      if (pinned === i) { pinned = null; hide(); } else { pinned = i; show(i); }
    });
  });
}

/** Small ⓘ button with an explanation; opens on hover/focus (desktop) and on tap (phones). */
export const infoTip = (text) => html`<span class="info-tip"><button type="button" class="info-btn" aria-label="${t('dash.aboutChart')}" aria-expanded="false" data-info>i</button><span class="info-pop" role="tooltip">${text}</span></span>`;

/** Shift a popover sideways so it stays fully on screen (phones). */
function keepOnScreen(pop) {
  pop.style.transform = '';
  const r = pop.getBoundingClientRect(); const pad = 8;
  const dx = r.right > innerWidth - pad ? innerWidth - pad - r.right : r.left < pad ? pad - r.left : 0;
  if (dx) pop.style.transform = `translateX(${Math.round(dx)}px)`;
}

export function bindInfoTips(root) {
  root.addEventListener('mouseover', (e) => { const tip = e.target.closest('.info-tip'); if (tip) keepOnScreen(tip.querySelector('.info-pop')); });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-info]');
    root.querySelectorAll('.info-tip.open').forEach((x) => { if (!b || x !== b.parentElement) { x.classList.remove('open'); x.querySelector('[data-info]').setAttribute('aria-expanded', 'false'); } });
    if (b) { const open = b.parentElement.classList.toggle('open'); b.setAttribute('aria-expanded', String(open)); if (open) keepOnScreen(b.parentElement.querySelector('.info-pop')); }
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') root.querySelectorAll('.info-tip.open').forEach((x) => x.classList.remove('open')); });
}
