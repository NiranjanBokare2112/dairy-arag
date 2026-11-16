// Owner dashboard (A7) with a date filter: today / 7 / 15 / 30 days / custom range.
// The range lives in the URL (#/dashboard?range=7 or ?from=…&to=…) so refresh and back keep it.
// Period figures follow the filter; balances (owed to farmers, advances, unbilled feed) are always "as of now".
// Charts are inline SVG / CSS, no chart library.
import { api } from '../api/index.js';
import { html, mount, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { stat, empty } from '../core/ui.js';
import { openRangePicker } from '../core/datepicker.js';
import { dailyChart, bindDailyChart } from '../core/dailychart.js';
import { qualityChart, bindQualityChart, infoTip, bindInfoTips } from '../core/qualitychart.js';
import * as fmt from '../core/format.js';
import { navigate } from '../core/router.js';
import { rangeFromQuery, customRange, rangeDays, PRESETS } from '../lib/ranges.js';
import { todayIST, fmtDayMonth } from '../lib/dates.js';
import { icon } from '../core/icons.js';
import { farmerPanel } from '../core/sidepanel.js';
import { dashLayout } from '../core/dashlayout.js';

export default {
  title: 'nav.dashboard',
  roles: ['owner'],
  async render(el, { query }) {
    const today = todayIST();
    const range = rangeFromQuery(query, today);
    const [d, center] = await Promise.all([api.dashboard({ from: range.from, to: range.to }), api.center()]);
    const { order, off } = dashLayout(center.dashboard); // D-85: the owner's own layout (Settings)
    const show = (id) => !off.has(id);
    const days = rangeDays(range);
    const periodText = range.from === range.to ? fmt.date(range.from) : `${fmt.date(range.from)} – ${fmt.date(range.to)}`;
    const shrink = d.collectedX100 - d.dispatchedX100 - d.buyerSoldX100 - d.counterSoldX100; // milk sold to daily buyers (D-51) and walk-ins (D-53) also left the center
    const shrinkPct = d.collectedX100 ? (shrink * 100 / d.collectedX100).toFixed(2) : '0.00';
    const margin = d.salePaise - d.purchasePaise;
    const cell = (s, m) => d.byShiftType[`${s}.${m}`];
    // Top / lowest suppliers: farmer, total litres, average per milk day (with days), profit in the period,
    // and what the farmer owes now (उचल + पशुखाद्य). Footer: average per day, total profit, total due.
    const supplierTable = (list) => {
      if (!list.length) return empty('—');
      const avgL = Math.round(list.reduce((x, r) => x + r.avgPerDayX100, 0) / list.length);
      const totP = list.reduce((x, r) => x + r.profitPaise, 0);
      const totR = list.reduce((x, r) => x + r.receivablePaise, 0);
      const due = (r) => (r.receivablePaise
        ? html`${fmt.rs(r.receivablePaise)}<span class="sub">${r.advancePaise ? t('dash.sup.adv', { v: fmt.rs(r.advancePaise) }) : ''}${r.advancePaise && r.feedPaise ? ' · ' : ''}${r.feedPaise ? t('dash.sup.feed', { v: fmt.rs(r.feedPaise) }) : ''}</span>`
        : html`<span class="muted">—</span>`);
      return html`<div class="table-wrap"><table class="tbl sup-tbl">
        <colgroup><col class="c-name"><col class="c-total"><col class="c-day"><col class="c-profit"><col class="c-due"></colgroup>
        <thead><tr><th>${t('dash.sup.farmer')}</th><th class="num col-total">${t('dash.sup.total')}</th><th class="num">${t('dash.sup.perDay')}</th><th class="num">${t('dash.sup.profit')}</th><th class="num">${t('dash.sup.due')}</th></tr></thead>
        <tbody>${list.map((r) => html`<tr class="clickable" data-farmer="${r.farmer.id}" tabindex="0"><td><b>${r.farmer.code}</b> ${r.farmer.name}<span class="sub ph-only">${t('dash.sup.total')}: ${fmt.litres(r.litresX100)}</span></td>
          <td class="num col-total">${fmt.litres(r.litresX100)}</td>
          <td class="num"><b>${fmt.litres(r.avgPerDayX100)}</b><span class="sub">${t('dash.sup.daysOf', { n: r.days, d: days })}</span></td>
          <td class="num ${r.profitPaise < 0 ? 'neg' : ''}"><b>${fmt.rs(r.profitPaise)}</b></td>
          <td class="num">${due(r)}</td></tr>`)}</tbody>
        <tfoot><tr><td>${t('dash.sup.foot')}</td><td class="col-total"></td><td class="num">${fmt.litres(avgL)}</td><td class="num ${totP < 0 ? 'neg' : ''}">${fmt.rs(totP)}</td><td class="num">${fmt.rs(totR)}</td></tr></tfoot>
      </table></div>`;
    };
    const chip = (p) => html`<a class="chip-btn ${range.preset === p ? 'on' : ''}" href="#/dashboard?range=${p}" ${range.preset === p ? html`aria-current="true"` : ''}>${t('dash.range.' + p)}</a>`;

    const milkOf = (m) => ({ l: cell('morning', m).litresX100 + cell('evening', m).litresX100, a: cell('morning', m).amountPaise + cell('evening', m).amountPaise });
    const sold = { l: d.buyerRangeX100 + d.counterRangeX100, a: d.buyerRangePaise + d.counterRangePaise };
    const head = (key, info) => html`<h2 class="dash-sub ${info ? 'title-info' : ''}">${t(key)} ${info ? infoTip(t(info)) : ''}</h2>`;
    const pr = d.profitByChart;
    // D-124: "लक्ष द्या" — what is waiting for the owner, one line each with a link (next to the profit sum on PC)
    const po = d.payouts || {};
    const todos = [
      d.pendingChanges && { ic: 'users', text: t('dash.todo.changes', { n: d.pendingChanges }), href: '#/billing?tab=approvals' },
      d.pendingCorrections && { ic: 'edit', text: t('dash.todo.corrections', { n: d.pendingCorrections }), href: '#/billing?tab=approvals' },
      po.waitingCount && { ic: 'wallet', text: t('dash.m.waiting', { n: po.waitingCount, v: fmt.rs(po.waitingPaise) }), href: '#/billing?tab=pay' },
      po.failedCount && { ic: 'rupee', text: t('dash.m.failed', { n: po.failedCount }), href: '#/billing?tab=pay', bad: true },
      !show('profit') && d.pendingDispatchX100 && { ic: 'truck', text: t('dash.todo.dispatch', { l: fmt.litres(d.pendingDispatchX100) }), href: '#/dispatch' },
      d.messages?.failed && { ic: 'chat', text: t('dash.todo.messages', { n: d.messages.failed }), href: '#/messages', bad: true },
      d.unpaidBillsCount && { ic: 'bill', text: t('dash.todo.bills', { n: d.unpaidBillsCount }), href: '#/billing?tab=pay' },
      d.pendingExpenseChanges && { ic: 'receipt', text: t('dash.todo.expChanges', { n: d.pendingExpenseChanges }), href: '#/billing?tab=approvals' },
      d.monthlyDueCount && { ic: 'clock', text: t('dash.todo.expDue', { n: d.monthlyDueCount }), href: '#/expenses' },
    ].filter(Boolean);
    const todoCard = () => html`<section class="card dash-todo">${head('dash.todo.title')}
      ${todos.length ? html`<ul class="todo-list">${todos.map((x) => html`<li><a class="${x.bad ? 'bad' : ''}" href="${x.href}"><span class="todo-ic">${icon(x.ic, 18)}</span><span class="todo-t">${x.text}</span><span class="todo-go" aria-hidden="true">›</span></a></li>`)}</ul>`
        : html`<p class="todo-ok">${icon('check', 18)} ${t('dash.todo.none')}</p>`}
    </section>`;
    // Each section of the dashboard (D-85). The owner chooses which show and their order in Settings.
    const SECTIONS = {
      // D-117: the profit calculation, line by line — only shifts whose dairy dispatch is entered (so it is exact)
      profit: () => { const soldL = d.dispatchedX100 + d.buyerSoldX100 + d.counterSoldX100; const sale = d.salePaise; const profit = sale - d.purchasePaise;
        // D-126: expenses for the range (monthly ones spread per day) and the costs the app counts itself → net profit
        const exp = d.expenses?.totalPaise || 0; const autoC = d.autoCosts?.totalPaise || 0; const costs = exp + autoC; const net = profit - costs;
        const loss = d.collectedX100 - soldL; const lossPct = d.collectedX100 ? ((loss * 100) / d.collectedX100).toFixed(1) : '0.0';
        const row = (label, l, paise, cls = '') => html`<tr class="${cls}"><th scope="row">${label}</th><td class="num">${l == null ? '' : fmt.litres(l) + ' ' + t('unit.l')}</td><td class="num">${fmt.rs(paise)}</td></tr>`;
        return html`<div class="dash-pair dash-sec"><section class="card dash-profit">${head('dash.p.title')}
          ${d.collectedX100 ? html`<table class="pl-tbl"><tbody>
            ${row(t('dash.p.dairy'), d.dispatchedX100, d.dispatchPaise)}
            ${d.buyerSoldX100 ? row('+ ' + t('dash.p.buyers'), d.buyerSoldX100, d.buyerSalePaise) : ''}
            ${d.counterSoldX100 ? row('+ ' + t('dash.p.counter'), d.counterSoldX100, d.counterSalePaise) : ''}
            ${row('= ' + t('dash.p.sale'), soldL, sale, 'pl-sub')}
            ${row('− ' + t('dash.p.purchase'), d.collectedX100, d.purchasePaise)}
            ${costs ? html`${row('= ' + t('dash.p.milkProfit'), null, profit, 'pl-sub')}
            ${exp ? row('− ' + t('dash.p.expenses'), null, exp) : ''}
            ${autoC ? row('− ' + t('dash.p.autoCosts'), null, autoC) : ''}` : ''}
            <tr class="pl-total ${net >= 0 ? 'good' : 'bad'}"><th scope="row">= ${costs ? (net >= 0 ? t('dash.p.netProfit') : t('dash.p.netLoss')) : profit >= 0 ? t('dash.p.profit') : t('dash.p.lossMoney')}</th>
              <td class="num small">${t('dash.p.perL', { v: fmt.rs(d.collectedX100 ? Math.round((net * 100) / d.collectedX100) : 0) })}</td><td class="num"><b>${fmt.rs(net)}</b></td></tr>
          </tbody></table>
          <p class="small pl-milk ${Number(lossPct) > 1 ? 'warn-text' : 'muted'}">${t('dash.p.balance', { c: fmt.litres(d.collectedX100), s: fmt.litres(soldL), l: fmt.litres(loss), p: lossPct })}</p>`
          : html`<p class="muted" style="margin:0">${t('dash.p.noDispatch')}</p>`}
          ${costs ? html`<p class="small pl-exp"><a href="#/expenses?from=${range.from}&to=${range.to}">${t('dash.p.expLink', { v: fmt.rs(costs) })} →</a></p>` : ''}
          ${d.pendingDispatchX100 ? html`<p class="small note" style="margin:8px 0 0">${t('dash.p.pending', { l: fmt.litres(d.pendingDispatchX100) })} <a href="#/dispatch">${t('dash.p.enterDispatch')} →</a></p>` : ''}
        </section>${todoCard()}</div>`; },
      // D-117: money in one row — owed to farmers, paid to them, advance and feed to come back
      money: () => { const p = d.payouts || {};
        return html`<section class="dash-sec">${head('dash.m.title')}<div class="stats dash-po">
          ${stat(t('dash.po.owed'), fmt.rs(p.owedPaise || 0), t('dash.po.owedSub', { n: p.owedFarmers || 0 }), 'blue')}
          ${stat(t('dash.m.paid'), fmt.rs((d.payments?.cashPaise || 0) + (d.payments?.upiPaise || 0)), t('dash.m.paidSub'), 'good')}
          ${stat(t('dash.m.advance'), fmt.rs(d.advanceOutstandingPaise), t('dash.m.advanceSub'))}
          ${stat(t('dash.m.feed'), fmt.rs(d.feedUnbilledPaise), t('dash.m.feedSub'))}</div>
        </section>`; },
      milk: () => html`<div class="stats stats-milk dash-sec">
        ${stat(t('dash.litresTotal'), fmt.litres(d.litresX100) + ' ' + t('unit.l'), days > 1 ? t('dash.perDay', { l: fmt.litres(d.avgPerDayX100) }) : t('dash.farmersPoured', { n: d.farmers }), 'blue')}
        ${['buffalo', 'cow'].map((m) => { const x = milkOf(m);
          return stat(t('dash.litresOf', { milk: fmt.milk(m) }), fmt.litres(x.l) + ' ' + t('unit.l'), t('dash.milkShare', { p: d.litresX100 ? Math.round((x.l * 100) / d.litresX100) : 0, a: fmt.rs(x.a) }), m === 'buffalo' ? 'milk-buf' : 'milk-cow'); })}
      </div>`,
      kpis: () => { const cards = [
          show('kpi.purchase') && stat(t('dash.purchase'), fmt.rs(d.amountPaise), t('dash.entries', { n: d.entries })),
          show('kpi.profit') && (pr.hasDairyChart ? stat(t('dash.profitChart'), fmt.rs(pr.profitPaise), t('dash.profitChartSub', { rev: fmt.rs(pr.revenuePaise), cost: fmt.rs(pr.costPaise) }), pr.profitPaise >= 0 ? 'good' : 'warn')
            : stat(t('dash.profitChart'), '—', html`<a href="#/rates?side=dairy">${t('dash.addDairyChart')}</a>`)),
          show('kpi.perLitre') && stat(t('dash.profitPerL'), pr.coveredX100 ? fmt.rs(Math.round((pr.profitPaise * 100) / pr.coveredX100)) : '—', t('dash.profitPerLSub'), pr.profitPaise >= 0 ? 'good' : 'warn'),
          show('kpi.avgRate') && stat(t('dash.avgRate'), d.litresX100 ? fmt.rs(Math.round((d.amountPaise * 100) / d.litresX100)) : '—', t('dash.avgRateSub')),
          show('kpi.quality') && stat(t('dash.avgQuality'), `${fmt.hundredths(d.avgFatX100)} / ${fmt.hundredths(d.avgSnfX100)}`, t('dash.fatSnf')),
          show('kpi.farmers') && stat(t('dash.farmersCount'), d.farmers),
        ].filter(Boolean);
        return cards.length ? html`<div class="stats dash-sec">${cards}</div>` : ''; },
      balances: () => html`<section class="dash-sec">${head('dash.balancesNow')}<div class="stats">
        ${stat(t('dash.unpaid'), fmt.rs(d.unpaidPaise), '', d.unpaidPaise ? 'warn' : 'good')}
        ${stat(t('dash.advanceOut'), fmt.rs(d.advanceOutstandingPaise))}
        ${stat(t('dash.feedOut'), fmt.rs(d.feedUnbilledPaise))}</div></section>`,
      charts: () => { const cards = [
          show('chart.byShift') && html`<section class="card"><h2>${t('dash.byShift')}</h2>
            <div class="table-wrap"><table class="tbl"><thead><tr><th></th><th class="num">${t('milk.buffalo')}</th><th class="num">${t('milk.cow')}</th><th class="num">${t('common.total')}</th></tr></thead>
            <tbody>${['morning', 'evening'].map((s) => html`<tr><td><b>${fmt.shift(s)}</b></td><td class="num">${fmt.litres(cell(s, 'buffalo').litresX100)}</td><td class="num">${fmt.litres(cell(s, 'cow').litresX100)}</td><td class="num"><b>${fmt.litres(cell(s, 'cow').litresX100 + cell(s, 'buffalo').litresX100)}</b></td></tr>`)}</tbody>
            <tfoot><tr><td>${t('common.total')}</td><td class="num">${fmt.litres(milkOf('buffalo').l)}</td><td class="num">${fmt.litres(milkOf('cow').l)}</td><td class="num">${fmt.litres(d.litresX100)}</td></tr></tfoot></table></div></section>`,
          show('chart.daily') && html`<section class="card"><h2 class="title-info">${t('dash.dailyLitres')} ${infoTip(t('dash.info.daily'))}</h2>
            ${days < 7 ? html`<p class="small muted" style="margin:0">${t('dash.contextNote')}</p>` : ''}
            ${dailyChart(d.trend, { today: d.today })}</section>`,
          show('chart.quality') && html`<section class="card"><h2 class="title-info">${t('dash.fatSnfTrend')} ${infoTip(t('dash.info.quality'))}</h2>
            ${qualityChart(d.trend, { today: d.today, avgFatX100: d.avgFatX100, avgSnfX100: d.avgSnfX100 })}</section>`,
        ].filter(Boolean);
        return cards.length ? html`<div class="dash-row3 dash-sec n${cards.length}">${cards}</div>` : ''; },
      sales: () => html`<section class="dash-sec">${head('dash.salesTitle')}<div class="stats stats-3">
        ${stat(t('dash.buyerSales'), `${fmt.litres(d.buyerRangeX100)} ${t('unit.l')}`, t('dash.buyerSalesSub', { v: fmt.rs(d.buyerRangePaise) }))}
        ${stat(t('dash.counterSales'), `${fmt.litres(d.counterRangeX100)} ${t('unit.l')}`, t('dash.counterSalesSub', { v: fmt.rs(d.counterRangePaise) }))}
        ${stat(t('dash.salesTotal'), `${fmt.litres(sold.l)} ${t('unit.l')}`, t('dash.salesTotalSub', { v: fmt.rs(sold.a) }), 'good')}</div></section>`,
      shrink: () => html`<section class="dash-sec">${head('dash.shrinkMargin', 'dash.info.shrink')}<div class="stats stats-3">
        ${stat(t('dash.dispatched'), `${fmt.litres(d.dispatchRangeX100)} ${t('unit.l')}`, t('dash.dispatchedSub', { v: fmt.rs(d.dispatchPaise) }))}
        ${stat(t('dash.collectedVsSent'), `${fmt.litres(d.collectedX100)} → ${fmt.litres(d.dispatchedX100 + d.buyerSoldX100 + d.counterSoldX100)}`, t('dash.shrinkVal', { l: fmt.litres(shrink), p: shrinkPct }), (Number(shrinkPct) > 1 ? 'warn' : '') + ' wrap')}
        ${stat(t('dash.margin'), fmt.rs(margin), t('dash.marginSub', { buy: fmt.rs(d.purchasePaise), sell: fmt.rs(d.salePaise) }), margin >= 0 ? 'good' : 'warn')}</div>
        ${d.dispatchedX100 ? '' : html`<p class="small muted" style="margin:8px 0 0">${t('dash.noDispatch')}</p>`}</section>`,
      suppliers: () => { const cards = [
          show('sup.top') && html`<section class="card"><h2 class="title-info">${t('dash.top')} ${infoTip(t('dash.sup.note'))}</h2><div data-sup="top">${supplierTable(d.top)}</div></section>`,
          show('sup.low') && html`<section class="card"><h2 class="title-info">${t('dash.low')} ${infoTip(t('dash.sup.note'))}</h2><div data-sup="low">${supplierTable(d.low)}</div></section>`,
        ].filter(Boolean);
        return cards.length ? html`<div class="grid-2 dash-sup dash-sec n${cards.length}">${cards}</div>` : ''; },
      payouts: () => { const p = d.payouts; if (!p) return '';
        const nx = p.next.kind === 'eod' ? t('dash.po.nextEod', { d: p.next.date === todayIST() ? t('dp.today') : fmt.date(p.next.date), t: p.next.time }) + (p.next.approval ? ' · ' + t('dash.po.allApproval') : '')
          : t('dash.po.next.' + p.next.kind, { t: p.next.time || '' });
        return html`<section class="dash-sec">${head('dash.po.title')}<div class="stats dash-po">
          ${stat(t('dash.po.paid'), fmt.rs(p.paidPaise), t('dash.po.paidSub', { n: p.paidCount }) + (p.processingCount ? ' · ' + t('dash.po.processing', { n: p.processingCount }) : ''), 'good')}
          ${stat(t('dash.po.owed'), fmt.rs(p.owedPaise), t('dash.po.owedSub', { n: p.owedFarmers }), 'blue')}
          ${stat(t('dash.po.waiting'), fmt.rs(p.waitingPaise), t('dash.po.waitingSub', { n: p.waitingCount }), p.waitingCount ? 'warn' : '')}
          ${stat(t('dash.po.failed'), fmt.rs(p.failedPaise), t('dash.po.failedSub', { n: p.failedCount }) + (p.reversedCount ? ' · ' + t('dash.po.reversed', { n: p.reversedCount }) : ''), p.failedCount ? 'warn' : '')}</div>
          <p class="small dash-po-next">${icon('clock', 14)} ${nx} · ${p.waitingCount ? html`<a href="#/billing?tab=pay">${t('dash.po.approve')} →</a> · ` : ''}<a href="#/billing?tab=pay">${p.failedCount ? t('dash.po.retry') : t('dash.po.open')} →</a></p></section>`; },
      payments: () => html`<section class="dash-sec">${head('dash.payTitle')}<div class="stats stats-3">
        ${stat(t('payments.cash'), fmt.rs(d.payments.cashPaise))}
        ${stat('UPI', fmt.rs(d.payments.upiPaise))}
        ${stat(t('dash.payTotal'), fmt.rs(d.payments.cashPaise + d.payments.upiPaise), t('dash.payCount', { n: d.payments.count }), 'good')}</div></section>`,
      ledger: () => html`<section class="dash-sec">${head('dash.ledgerTitle')}<div class="stats stats-3">
        ${stat(t('dash.advGiven'), fmt.rs(d.ledger.advancePaise), t('dash.countN', { n: d.ledger.advances }))}
        ${stat(t('dash.feedSold'), fmt.rs(d.ledger.feedPaise), t('dash.countN', { n: d.ledger.feedSales }))}
        ${stat(t('dash.stock'), d.ledger.stock.map((x) => `${x.stock} ${x.unit}`).join(' · ') || '—', d.ledger.stock.map((x) => x.name).join(' · '), d.ledger.stock.some((x) => x.stock < 5) ? 'warn' : '')}</div></section>`,
      messages: () => html`<section class="dash-sec">${head('nav.messages')}<div class="stats">
        ${stat(t('messages.status.sent'), d.messages.sent, '', 'good')}
        ${stat(t('messages.status.queued'), d.messages.queued)}
        ${stat(t('messages.status.failed'), d.messages.failed, '', d.messages.failed ? 'warn' : '')}
        ${stat('SMS', d.messages.sms)}</div></section>`,
    };

    mount(el, html`
      <div class="page-head"><h1>${t('nav.dashboard')}</h1><span class="muted">${t('dash.cycle', { a: fmt.date(d.cycle.start), b: fmt.date(d.cycle.end) })}</span></div>

      <section class="card dash-filter" aria-label="${t('dash.filter')}">
        <div class="chips" role="group" aria-label="${t('dash.filter')}">
          ${PRESETS.map(chip)}
          <button type="button" class="chip-btn ${range.preset === 'custom' ? 'on' : ''}" data-custom aria-haspopup="dialog" aria-expanded="false">${t('dash.range.custom')}</button>
        </div>
        <p class="dash-period"><b>${periodText}</b> <span class="muted">· ${t('dash.days', { n: days })}</span></p>
      </section>

      ${!show('profit') && todos.length ? html`<div class="dash-sec">${todoCard()}</div>` : ''}

      ${order.filter(show).map((id) => SECTIONS[id]?.()).filter(Boolean)}
      ${order.every((id) => !show(id)) ? html`<div class="note dash-sec">${t('dash.allHidden')} <a href="#/settings#dashboard">${t('nav.settings')} →</a></div>` : ''}`);

    bindDailyChart(el);
    // D-60: a farmer row opens a side panel with everything the table knows (not the farmer page)
    const rowsOf = (tr) => { const list = tr.closest('[data-sup]').dataset.sup; return { list, rows: d[list] }; };
    const openPanel = (tr) => { const { list, rows } = rowsOf(tr); const i = rows.findIndex((r) => r.farmer.id === tr.dataset.farmer);
      farmerPanel(rows[i], { list, rank: i + 1, days, periodText, from: range.from, to: range.to }); };
    on(el, 'click', 'tr[data-farmer]', (_, tr) => openPanel(tr));
    on(el, 'keydown', 'tr[data-farmer]', (e, tr) => { if (e.key === 'Enter') openPanel(tr); });
    bindQualityChart(el);
    bindInfoTips(el);
    on(el, 'click', '[data-custom]', (_, b) => openRangePicker(b, {
      from: range.from, to: range.to, title: t('dash.range.custom'),
      onApply: (r) => { const c = customRange(r.from, r.to, today); if (c) navigate(`/dashboard?from=${c.from}&to=${c.to}`); },
    }));
  },
};
