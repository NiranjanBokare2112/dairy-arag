// Right-side panel (D-60, D-61): opened from the dashboard's जास्त / कमी दूध देणारे tables. Shows the farmer's
// KPIs, daily-litres and fat/SNF charts, splits, balances and recent bills without leaving the dashboard.
// Closes on ✕, Esc, or a click anywhere outside the panel. On phones it slides up from the bottom instead.
import { html, mount } from './dom.js';
import { t } from './i18n.js';
import * as fmt from './format.js';
import { api } from '../api/index.js';
import { dailyChart, bindDailyChart } from './dailychart.js';
import { qualityChart, bindQualityChart, infoTip, bindInfoTips } from './qualitychart.js';
import { addDays } from '../lib/dates.js';

const row = (label, value, cls = '') => html`<div class="sp-row ${cls}"><span>${label}</span><b>${value}</b></div>`;
const kpi = (label, value, sub = '', tone = '') => html`<div class="sp-kpi ${tone}"><span class="sp-kpi-l">${label}</span><b class="sp-kpi-v">${value}</b>${sub ? html`<span class="sp-kpi-s">${sub}</span>` : ''}</div>`;
/** Two-part bar with labels (cow / buffalo, morning / evening). */
const split = (title, a, b, la, lb, ca, cb) => {
  const tot = a + b; const pa = tot ? Math.round((a * 100) / tot) : 0;
  return html`<div class="sp-split"><div class="sp-split-h"><span>${title}</span></div>
    <div class="sp-split-bar" role="img" aria-label="${la} ${pa}%, ${lb} ${100 - pa}%">${a ? html`<i style="flex:${a};background:${ca}"></i>` : ''}${b ? html`<i style="flex:${b};background:${cb}"></i>` : ''}</div>
    <div class="sp-split-k"><span><i style="background:${ca}"></i>${la} <b>${fmt.litres(a)}</b> · ${pa}%</span><span><i style="background:${cb}"></i>${lb} <b>${fmt.litres(b)}</b> · ${tot ? 100 - pa : 0}%</span></div></div>`;
};

/** Generic panel: title, subtitle and body; returns the close function. */
export function sidePanel({ title, sub = '', body, foot = '', wide = false }) {
  document.querySelector('dialog.side-panel')?.remove();
  const d = document.createElement('dialog');
  d.className = 'side-panel' + (wide ? ' wide' : '');
  mount(d, html`<div class="sp-box">
    <div class="sp-head"><div><h2>${title}</h2>${sub ? html`<p class="muted small">${sub}</p>` : ''}</div>
      <button type="button" class="btn btn-ghost btn-sm sp-x" data-sp-close aria-label="${t('sp.close')}">✕</button></div>
    <div class="sp-body">${body}</div>${foot ? html`<div class="sp-foot">${foot}</div>` : ''}</div>`);
  document.body.append(d);
  const close = () => { d.classList.add('out'); setTimeout(() => d.remove(), 160); d.close(); };
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  // the dialog itself only receives clicks on its backdrop (the box fills it): outside click closes
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-sp-close]')) close(); });
  d.showModal();
  d.querySelector('[data-sp-close]').focus();
  return { close, el: d };
}

/** A supplier row from api.dashboard().top / .low, for the dashboard range { from, to }. */
export async function farmerPanel(r, { list, rank, days, periodText, from, to }) {
  const f = r.farmer;
  // charts show at least 7 days so a one-day range still has context (earlier days faded)
  const chartFrom = days < 7 ? addDays(to, -6) : from;
  const [ins, wide, allBills] = await Promise.all([
    api.farmerInsights(f.id, { from, to }),
    chartFrom === from ? null : api.farmerInsights(f.id, { from: chartFrom, to }),
    api.bills({ farmerId: f.id }),
  ]);
  const trend = (wide || ins).trend.map((x) => ({ ...x, inRange: x.date >= from }));
  const change = ins.prevLitresX100 ? Math.round(((ins.litresX100 - ins.prevLitresX100) * 100) / ins.prevLitresX100) : null;
  const p = ins.profit;
  const due = r.receivablePaise;
  const bills = allBills.slice(0, 3); // latest 3, whatever the dashboard range
  const billTag = (b) => (b.status === 'draft' ? html`<span class="tag tag-warn">${t('billing.draft')}</span>`
    : b.paidPaise >= b.payablePaise ? html`<span class="tag tag-green">${t('payments.paid')}</span>` : html`<span class="tag tag-danger">${t('payments.unpaid')}</span>`);

  const { el } = sidePanel({
    wide: true,
    title: html`<span class="tag">${f.code}</span> ${f.name}`,
    sub: html`${f.village || ''}${f.village ? ' · ' : ''}${t(list === 'top' ? 'sp.rankTop' : 'sp.rankLow', { n: rank })} · ${periodText}`,
    body: html`
      <div class="sp-kpis">
        ${kpi(t('farmers.totalMilk'), fmt.litres(ins.litresX100) + ' ' + t('unit.l'),
          change == null ? t('farmers.daysPoured', { n: ins.milkDays, d: ins.days }) : t('farmers.vsPrev', { p: (change > 0 ? '+' : '') + change }), 'blue')}
        ${kpi(t('dash.sup.perDay'), fmt.litres(ins.avgPerDayX100) + ' ' + t('unit.l'), t('farmers.daysPoured', { n: ins.milkDays, d: ins.days }))}
        ${kpi(t('farmers.weeklyAvg'), fmt.litres(ins.weeklyAvgX100) + ' ' + t('unit.l'))}
        ${kpi(t('sp.fatSnf'), `${fmt.hundredths(ins.avgFatX100)} / ${fmt.hundredths(ins.avgSnfX100)}`)}
        ${kpi(t('farmers.paidToFarmer'), fmt.rs(ins.amountPaise), t('farmers.avgRate', { r: fmt.rs(ins.avgRatePaise) }))}
        ${p ? kpi(t('dash.sup.profit'), fmt.rs(p.profitPaise), p.coveredX100 ? t('farmers.perLitre', { r: fmt.rs(p.perLitrePaise) }) : t('farmers.noDispatchYet'), p.profitPaise < 0 ? 'bad' : 'good') : ''}
      </div>

      <h3 class="title-info">${t('dash.dailyLitres')} ${infoTip(t('sp.info.chart'))}</h3>
      ${dailyChart(trend, { today: to })}

      <h3 class="title-info">${t('dash.avgQuality')} ${infoTip(t('dash.info.quality'))}</h3>
      ${qualityChart(trend, { today: to })}

      <div class="sp-splits">
        ${split(t('common.milk'), ins.cowX100, ins.buffaloX100, fmt.milk('cow'), fmt.milk('buffalo'), 'var(--series-cow)', 'var(--series-buf)')}
        ${split(t('sp.shifts'), ins.morningX100, ins.eveningX100, t('shift.morning'), t('shift.evening'), '#E0A526', '#5B6B8C')}
      </div>

      <h3>${t('dash.balancesNow')}</h3>
      <div class="sp-kpis sp-kpis-4">
        ${kpi(t('farmers.advanceDue'), fmt.rs(r.advancePaise))}
        ${kpi(t('farmers.feedUnbilled'), fmt.rs(r.feedPaise))}
        ${kpi(t('farmers.dues'), fmt.rs(r.previousDuesPaise || 0))}
        ${kpi(t('farmers.unpaid'), fmt.rs(r.unpaidBillsPaise || 0), '', r.unpaidBillsPaise ? 'warn' : '')}
      </div>
      ${row(t('dash.sup.due'), fmt.rs(due), 'big' + (due ? ' warn' : ''))}

      ${bills.length ? html`<h3>${t('sp.recentBills')}</h3>
        <div class="sp-bills">${bills.map((b) => html`<a class="sp-bill" href="#/bill/${b.id}" data-sp-close>
          <span><b>${fmt.date(b.start).slice(0, 5)} – ${fmt.date(b.end).slice(0, 5)}</b><span class="small muted">${fmt.litres(b.litresX100)} ${t('unit.l')}</span></span>
          <span class="num"><b>${fmt.rs(b.payablePaise)}</b>${billTag(b)}</span></a>`)}</div>` : ''}

      <h3>${t('sp.contact')}</h3>
      ${row(t('farmers.mobile'), f.mobile ? html`<a href="tel:+91${f.mobile}">${f.mobile}</a>` : '—')}
      ${row(t('farmers.lastPour'), ins.lastEntry ? fmt.date(ins.lastEntry) : '—')}`,
    foot: html`<a class="btn btn-primary" href="#/farmers/${f.id}" data-sp-close>${t('sp.openFarmer')}</a>`,
  });
  bindDailyChart(el); bindQualityChart(el); bindInfoTips(el);
}
