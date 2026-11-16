// Billing (A5): bill periods in the chosen dates → generate all bills of a period in one action → review →
// finalize (locks the period). Date filter = the same chips as every list (D-55, D-61): आज · ७ / १५ / ३० दिवस ·
// सुरुवातीपासून · निवडक तारखा. Every bill period that overlaps the dates is shown, newest first, 3 per page.
import { api } from '../api/index.js';
import { html, mount, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { toast, errorText, confirmBox, stat, empty } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { todayIST, addDays } from '../lib/dates.js';
import { navigate } from '../core/router.js';
import { rangeOf, filterCard, bindRangeBar } from '../core/rangebar.js';
import { pager, pgAttrs, bindPagers } from '../core/pager.js';
import payments from './payments.js';
import payouts from './payouts.js';
import approvals from './approvals.js';

const PER_PAGE = 3; // bill periods per page

/** Same default dates on both tabs (D-62). */
export const BILLPAY_DEFAULT = '15';

/** बिल व पेमेंट (D-60): tabs shared by the two halves of the page. The chosen dates go with you to the other tab (D-62). */
export const billTabs = (tab, query = {}) => {
  const keep = Object.fromEntries(['range', 'from', 'to'].filter((k) => query[k]).map((k) => [k, query[k]]));
  const href = (k) => { if (k === 'approvals') return '#/billing?tab=' + k; const q = new URLSearchParams({ ...(k === 'pay' ? { tab: 'pay' } : {}), ...keep }).toString(); return '#/billing' + (q ? '?' + q : ''); };
  return html`<nav class="tabs">${[['bills', t('nav.billing')], ['pay', t('pay.tab')], ['approvals', t('nav.approvals')]]
    .map(([k, l]) => html`<a href="${href(k)}" class="${k === tab ? 'on' : ''}" ${k === tab ? html`aria-current="page"` : ''}>${l}</a>`)}</nav>`;
};

/** The one date filter of बिल व पेमेंट: same card, same place (right under the tabs) on both tabs (D-62). */
export const billPayFilter = (query, range, opts) => filterCard('/billing', query, range, opts);

export default {
  title: 'nav.billPay',
  roles: ['owner'],
  async render(el, ctx) {
    let { query } = ctx;
    if (query.tab === 'pay') return payments.render(el, ctx);
    if (query.tab === 'upi') return payouts.render(el, ctx); // D-107
    if (query.tab === 'approvals') return approvals.render(el, ctx); // D-114
    const today = todayIST();
    // old links (#/billing?start=…, e.g. "back" on a bill): show that one period
    if (query.start) { const c = api.cycleFor(query.start); query = { ...query, from: c.start, to: c.end > today ? today : c.end }; delete query.start; }
    const range = rangeOf(query, today, BILLPAY_DEFAULT);

    // bill periods overlapping the range, newest first (for "all": back to the oldest period on record)
    const known = await api.cycles();
    const oldest = range.all ? (known.length ? known[known.length - 1].start : today) : range.from;
    const periods = [];
    for (let c = api.cycleFor(range.to); c.end >= oldest && periods.length < 200; c = api.cycleFor(addDays(c.start, -1))) periods.push(c);
    const [cycles, allBills, farmersList] = await Promise.all([
      Promise.all(periods.map((p) => api.cycle(p.start, p.end))), api.bills(), api.farmers({ includeInactive: true })]);
    const farmers = new Map(farmersList.map((f) => [f.id, f]));
    const billsOf = (c) => allBills.filter((b) => b.cycleId === c.id);
    const inRange = cycles.flatMap(billsOf);
    const tot = (list, k) => list.reduce((s, b) => s + b[k], 0);
    const statusTag = (c) => ({ open: html`<span class="tag">${t('billing.status.open')}</span>`, generated: html`<span class="tag tag-warn">${t('billing.status.generated')}</span>`, finalized: html`<span class="tag tag-green">${t('billing.status.finalized')}</span>` }[c.status]);
    const payTag = (b) => (b.status === 'draft' ? html`<span class="tag tag-warn">${t('billing.draft')}</span>` : b.paidPaise >= b.payablePaise ? html`<span class="tag tag-green">${t('payments.paid')}</span>` : html`<span class="tag tag-danger">${t('payments.unpaid')}</span>`);

    const periodCard = (c, i) => {
      const bills = billsOf(c);
      const notEnded = c.end >= today;
      return html`<section class="card bill-period" ${pgAttrs(i, PER_PAGE)}>
        <div class="row-between"><div><h2 style="margin:0">${fmt.date(c.start)} – ${fmt.date(c.end)} ${statusTag(c)}</h2>
          <p class="muted small" style="margin:4px 0 0">${c.status === 'finalized' ? t('billing.lockedNote') : t('billing.flowNote')}</p></div>
          <div class="row">
            ${c.status !== 'finalized' ? html`<button class="btn btn-primary" data-generate="${c.start}">${icon('bill')} ${c.status === 'generated' ? t('billing.regenerate') : t('billing.generate')}</button>` : ''}
            ${c.status === 'generated' ? html`<button class="btn btn-green" data-finalize="${c.start}">${icon('check')} ${t('billing.finalize')}</button>` : ''}
          </div></div>
        ${notEnded && c.status !== 'finalized' ? html`<div class="note note-warn" style="margin-top:12px">${t('billing.notEnded')}</div>` : ''}
        ${c.stale && c.status === 'generated' ? html`<div class="note note-danger" style="margin-top:12px">${t('billing.stale')}</div>` : ''}
        ${bills.length ? html`<div class="table-wrap" style="margin-top:12px"><table class="tbl bills-tbl">
          <thead><tr><th>${t('common.code')}</th><th>${t('common.name')}</th><th class="num">${t('unit.l')}</th><th class="num">${t('billing.avgFat')}</th><th class="num">${t('billing.gross')}</th><th class="num">${t('billing.feed')}</th><th class="num">${t('billing.advance')}</th><th class="num">${t('billing.prevDues')}</th><th class="num">${t('billing.payable')}</th><th>${t('common.status')}</th></tr></thead>
          <tbody>${bills.map((b) => html`<tr class="clickable" data-bill="${b.id}">
            <td><b>${farmers.get(b.farmerId)?.code}</b></td><td>${farmers.get(b.farmerId)?.name}</td><td class="num">${fmt.litres(b.litresX100)}</td><td class="num">${fmt.hundredths(b.avgFatX100)}</td>
            <td class="num">${fmt.rsPlain(b.grossPaise)}</td><td class="num">${fmt.rsPlain(b.feedPaise)}</td><td class="num">${fmt.rsPlain(b.advancePaise)}</td><td class="num">${fmt.rsPlain(b.previousDuesPaise)}</td>
            <td class="num"><b>${fmt.rsPlain(b.payablePaise)}</b>${b.carryForwardDuesPaise ? html`<br><span class="tag tag-danger">${t('billing.carry', { amt: fmt.rsPlain(b.carryForwardDuesPaise) })}</span>` : ''}</td>
            <td>${payTag(b)}</td></tr>`)}</tbody>
          <tfoot><tr><td colspan="2">${t('common.total')}</td><td class="num">${fmt.litres(tot(bills, 'litresX100'))}</td><td></td><td class="num">${fmt.rsPlain(tot(bills, 'grossPaise'))}</td><td class="num">${fmt.rsPlain(tot(bills, 'feedPaise'))}</td><td class="num">${fmt.rsPlain(tot(bills, 'advancePaise'))}</td><td class="num">${fmt.rsPlain(tot(bills, 'previousDuesPaise'))}</td><td class="num">${fmt.rsPlain(tot(bills, 'payablePaise'))}</td><td></td></tr></tfoot>
        </table></div>` : html`<div style="margin-top:8px">${empty(t('billing.none'))}</div>`}
      </section>`;
    };

    mount(el, html`
      <div class="page-head"><h1>${t('nav.billPay')}</h1></div>${billTabs('bills', query)}
      ${billPayFilter(query, range, { count: periods.length, unit: t('billing.periods') })}
      ${inRange.length ? html`<div class="stats" style="margin-bottom:16px">
        ${stat(t('billing.farmers'), new Set(inRange.map((b) => b.farmerId)).size)}
        ${stat(t('billing.litres'), fmt.litres(tot(inRange, 'litresX100')) + ' ' + t('unit.l'))}
        ${stat(t('billing.gross'), fmt.rs(tot(inRange, 'grossPaise')))}
        ${stat(t('billing.deductions'), fmt.rs(tot(inRange, 'totalDeductPaise')))}
        ${stat(t('billing.payable'), fmt.rs(tot(inRange, 'payablePaise')), '', 'blue')}
      </div>` : ''}
      <div class="bill-periods" data-pg-list="periods">${cycles.map(periodCard)}</div>
      ${pager('periods', cycles.length, PER_PAGE)}`);

    bindRangeBar(el, '/billing', query, range, today);
    bindPagers(el);
    const again = () => navigate(location.hash.slice(1) || '/billing');
    const periodOf = (start) => periods.find((p) => p.start === start);
    on(el, 'click', 'tr[data-bill]', (_, tr) => navigate('/bill/' + tr.dataset.bill));
    on(el, 'click', '[data-generate]', async (_, b) => {
      const sel = periodOf(b.dataset.generate);
      try { const n = await api.generateBills(sel); toast(t('billing.generated', { n })); again(); } catch (err) { toast(errorText(err), 'err'); }
    });
    on(el, 'click', '[data-finalize]', async (_, b) => {
      const sel = periodOf(b.dataset.finalize); const c = cycles.find((x) => x.start === sel.start);
      if (!await confirmBox(t('billing.confirmFinalize', { n: billsOf(c).length }), { okText: t('billing.finalize') })) return;
      try { await api.finalizeCycle(c.id); toast(t('billing.finalized')); again(); } catch (err) { toast(errorText(err), 'err'); }
    });
  },
};
