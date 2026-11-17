// दैनिक अहवाल — printable daily report (D-140): #/report?date=YYYY-MM-DD&shift=morning|evening|all
// One A4 page per shift (milk in, milk out, profit, every farmer's entry, signatures); "दिवसभर" prints the morning
// page, the evening page and a whole-day summary page (with the day's feed sales, advances, expenses and payments).
// Same look as the farmer bill (print.css). Opened from the dashboard.
import { api } from '../api/index.js';
import { html, mount, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { badge, seg, bindSeg } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { todayIST } from '../lib/dates.js';
import { navigate } from '../core/router.js';
import { dateField, bindDateFields } from '../core/datepicker.js';
import { dayReport } from '../lib/dayreport.js';

const SHIFTS = ['morning', 'evening', 'all'];
const L = (x) => fmt.litres(x || 0);
const T = (x) => (x == null ? '—' : fmt.tenths(x));
const R = (p) => fmt.rsPlain(p || 0);

export default {
  title: 'rep.title',
  roles: ['owner'],
  layout: 'bare',
  async render(el, { query = {} }) {
    const today = todayIST();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') && query.date <= today ? query.date : today;
    const shift = SHIFTS.includes(query.shift) ? query.shift : 'all';
    const [center, farmers, collections, dispatches, bdM, bdE, counter] = await Promise.all([api.center(), api.farmers({ includeInactive: true }),
      api.collections({ date }), api.dispatches({ from: date, to: date }), api.buyerDay({ date, shift: 'morning' }), api.buyerDay({ date, shift: 'evening' }), api.counterSales({ date })]);
    const buyerSales = [...bdM.rows, ...bdE.rows].map((r) => r.sale).filter(Boolean);
    const data = { date, collections, dispatches, buyerSales, counterSales: counter.rows };
    const fById = new Map(farmers.map((f) => [f.id, f]));
    const printedAt = fmt.dateTime(new Date().toISOString());

    // whole-day extras (the day summary page only)
    let extras = null;
    if (shift === 'all') {
      const [moves, advances, expenses, cats, payments] = await Promise.all([api.feedMoves({ from: date, to: date }), api.advances(), api.expenses({ from: date, to: date }).catch(() => []),
        api.expenseCategories().catch(() => []), api.payments({ from: date, to: date })]);
      const sales = moves.filter((m) => m.type === 'sale'); const adv = advances.filter((a) => a.date === date);
      const s = (xs, k) => xs.reduce((a, x) => a + (x[k] || 0), 0);
      extras = { feed: { count: sales.length, paise: s(sales, 'amountPaise') }, advances: { count: adv.length, paise: s(adv, 'amountPaise') },
        expenses: { count: expenses.length, paise: s(expenses, 'amountPaise'), list: expenses.map((e) => ({ name: cats.find((c) => c.id === e.categoryId)?.name || '', note: e.note, paise: e.amountPaise })) },
        payments: { count: payments.length, cash: s(payments.filter((p) => p.mode === 'cash'), 'amountPaise'), upi: s(payments.filter((p) => p.mode === 'upi'), 'amountPaise') } };
    }

    const head = (title) => html`<header class="bill-head">${badge(72)}
        <div class="bill-title"><b>${center.name}</b><span class="tg">${t('brand.tagline')}</span><span class="ad">${center.address || ''}${center.mobile ? html` &nbsp;|&nbsp; ${t('common.mobileShort')} ${center.mobile}` : ''}</span></div>
        <div class="bill-meta"><b>${t('rep.title')}</b><span class="rep-shift">${title}</span><span>${t('common.date')}: ${fmt.date(date)}</span></div>
      </header><div class="bill-rule1"></div><div class="bill-rule2"></div>`;
    const boxes = (r) => html`<div class="rep-boxes">
        <div class="bill-box"><h4>${t('rep.milkIn')}</h4><b class="rep-big">${L(r.in.total.litresX100)} ${t('unit.l')}</b><span>${t('rep.farmersN', { n: r.in.total.farmers })}</span></div>
        <div class="bill-box"><h4>${t('rep.toFarmers')}</h4><b class="rep-big">₹ ${R(r.purchasePaise)}</b><span>${t('rep.avgRate', { r: R(r.in.total.ratePaise) })}</span></div>
        <div class="bill-box"><h4>${t('rep.milkOut')}</h4><b class="rep-big">${L(r.out.totalX100)} ${t('unit.l')}</b><span>₹ ${R(r.salePaise)}</span></div>
        <div class="bill-box main"><h4>${r.profitPaise >= 0 ? t('dash.p.profit') : t('dash.p.lossMoney')}</h4><b class="rep-big ${r.profitPaise < 0 ? 'neg' : ''}">₹ ${R(r.profitPaise)}</b><span>${t('dash.p.perL', { v: fmt.rs(r.perLitrePaise) })}</span></div>
      </div>`;
    const inTable = (r) => html`<h3 class="rep-h">${t('rep.inTitle')}</h3>
      <table class="bill-table"><thead><tr><th>${t('common.milk')}</th><th class="r">${t('rep.farmers')}</th><th class="r">${t('collection.litres')}</th><th class="r">${t('common.fat')}</th><th class="r">${t('common.snf')}</th><th class="r">${t('rep.avgRateCol')}</th><th class="r">${t('common.amount')} ₹</th></tr></thead>
        <tbody>${['cow', 'buffalo'].filter((m) => r.in[m].entries).map((m, i) => html`<tr class="${i % 2 ? 'alt' : ''}"><td>${fmt.milk(m)}</td><td class="r">${r.in[m].farmers}</td><td class="r">${L(r.in[m].litresX100)}</td><td class="r">${T(r.in[m].fatX10)}</td><td class="r">${T(r.in[m].snfX10)}</td><td class="r">${R(r.in[m].ratePaise)}</td><td class="r">${R(r.in[m].amountPaise)}</td></tr>`)}</tbody>
        <tfoot><tr><td>${t('common.total')}</td><td class="r">${r.in.total.farmers}</td><td class="r">${L(r.in.total.litresX100)}</td><td class="r">${T(r.in.total.fatX10)}</td><td class="r">${T(r.in.total.snfX10)}</td><td class="r">${R(r.in.total.ratePaise)}</td><td class="r">${R(r.in.total.amountPaise)}</td></tr></tfoot></table>`;
    const outTable = (r) => html`<h3 class="rep-h">${t('rep.outTitle')}</h3>
      <table class="bill-table"><thead><tr><th>${t('rep.where')}</th><th class="r">${t('collection.litres')}</th><th class="r">${t('common.fat')}</th><th class="r">${t('common.snf')}</th><th class="r">${t('rep.rateCol')}</th><th class="r">${t('common.amount')} ₹</th></tr></thead>
        <tbody>${['cow', 'buffalo'].filter((m) => r.out.dairy[m].count).map((m) => html`<tr><td>${t('rep.toDairy', { m: fmt.milk(m) })}</td><td class="r">${L(r.out.dairy[m].litresX100)}</td><td class="r">${T(r.out.dairy[m].fatX10)}</td><td class="r">${T(r.out.dairy[m].snfX10)}</td><td class="r">${R(r.out.dairy[m].ratePaise)}</td><td class="r">${R(r.out.dairy[m].amountPaise)}</td></tr>`)}
          ${r.out.buyers.count ? html`<tr class="alt"><td>${t('rep.toBuyers', { n: r.out.buyers.count })}</td><td class="r">${L(r.out.buyers.litresX100)}</td><td class="r">—</td><td class="r">—</td><td class="r">—</td><td class="r">${R(r.out.buyers.amountPaise)}</td></tr>` : ''}
          ${r.out.counter.count ? html`<tr><td>${t('rep.walkIn', { n: r.out.counter.count, c: R(r.out.counter.cashPaise), u: R(r.out.counter.upiPaise) })}</td><td class="r">${L(r.out.counter.litresX100)}</td><td class="r">—</td><td class="r">—</td><td class="r">—</td><td class="r">${R(r.out.counter.amountPaise)}</td></tr>` : ''}
          <tr class="alt"><td>${t('rep.balance')}</td><td class="r ${Math.abs(r.out.balancePct) > 1 ? 'neg' : ''}">${L(r.out.balanceX100)}</td><td colspan="3" class="r small">${r.in.total.litresX100 ? t('rep.balancePct', { p: r.out.balancePct.toFixed(1) }) : ''}</td><td></td></tr></tbody>
        <tfoot><tr><td>${t('rep.totalOut')}</td><td class="r">${L(r.out.totalX100)}</td><td colspan="3"></td><td class="r">${R(r.salePaise)}</td></tr></tfoot></table>
      ${r.missingDispatch.length ? html`<p class="rep-note">${t('rep.missing', { x: r.missingDispatch.map((x) => `${fmt.shift(x.shift)} ${fmt.milk(x.milkType)}`).join(', ') })}</p>` : ''}`;
    const entriesTable = (r) => { const rows = [...r.entries].sort((a, b) => (fById.get(a.farmerId)?.code || 0) - (fById.get(b.farmerId)?.code || 0) || (a.shift < b.shift ? -1 : 1));
      return html`<h3 class="rep-h">${t('rep.entries', { n: rows.length })}</h3>
      ${rows.length ? html`<table class="bill-table rep-entries"><thead><tr><th>${t('common.code')}</th><th>${t('common.name')}</th><th>${t('common.milk')}</th><th class="r">${t('collection.litres')}</th><th class="r">${t('common.fat')}</th><th class="r">${t('common.snf')}</th><th class="r">${t('common.rate')}</th><th class="r">${t('common.amount')} ₹</th></tr></thead>
        <tbody>${rows.map((e, i) => html`<tr class="${i % 2 ? 'alt' : ''}"><td><b>${fById.get(e.farmerId)?.code ?? ''}</b></td><td>${fById.get(e.farmerId)?.name || ''}</td><td>${fmt.milk(e.milkType)}</td><td class="r">${L(e.litresX100)}</td><td class="r">${T(e.fatX10)}</td><td class="r">${T(e.snfX10)}</td><td class="r">${R(e.ratePaise)}</td><td class="r">${R(e.amountPaise)}</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="3">${t('common.total')}</td><td class="r">${L(r.in.total.litresX100)}</td><td colspan="3"></td><td class="r">${R(r.in.total.amountPaise)}</td></tr></tfoot></table>` : html`<p class="rep-note">${t('rep.noEntries')}</p>`}`; };
    const foot = () => html`<div class="bill-sign"><div>${t('rep.signOperator')}</div><div>${t('rep.signOwner')}</div></div>
      <p class="rep-printed">${t('rep.printedAt', { d: printedAt })}</p><div class="bill-bottom"></div>`;

    const shiftPage = (s) => { const r = dayReport({ ...data, shift: s });
      return html`<article class="bill report">${head(fmt.shift(s))}${boxes(r)}${inTable(r)}${outTable(r)}${entriesTable(r)}${foot()}</article>`; };
    const dayPage = () => { const r = dayReport({ ...data, shift: null }); const x = extras;
      return html`<article class="bill report">${head(t('rep.wholeDay'))}${boxes(r)}${inTable(r)}${outTable(r)}
        <h3 class="rep-h">${t('rep.dayMoney')}</h3>
        <div class="bill-sum"><div class="bill-box"><h4>${t('rep.dayIn')}</h4>
            <div class="l"><span>${t('rep.feedSales', { n: x.feed.count })}</span><b>₹ ${R(x.feed.paise)}</b></div>
            <div class="l"><span>${t('rep.walkInCash')}</span><b>₹ ${R(r.out.counter.cashPaise)}</b></div>
            <div class="l"><span>${t('rep.walkInUpi')}</span><b>₹ ${R(r.out.counter.upiPaise)}</b></div></div>
          <div class="bill-box"><h4>${t('rep.dayOut')}</h4>
            <div class="l"><span>${t('rep.paidCash', { n: x.payments.count })}</span><b>₹ ${R(x.payments.cash)}</b></div>
            <div class="l"><span>${t('rep.paidUpi')}</span><b>₹ ${R(x.payments.upi)}</b></div>
            <div class="l"><span>${t('rep.advances', { n: x.advances.count })}</span><b>₹ ${R(x.advances.paise)}</b></div>
            <div class="l"><span>${t('rep.expenses', { n: x.expenses.count })}</span><b>₹ ${R(x.expenses.paise)}</b></div>
            ${x.expenses.list.slice(0, 6).map((e) => html`<div class="l small"><span>· ${e.name}${e.note ? ' — ' + e.note : ''}</span><span>₹ ${R(e.paise)}</span></div>`)}</div></div>
        ${foot()}</article>`; };

    mount(el, html`
      <div class="doc-bar rep-bar">
        <a class="btn btn-ghost" href="#/dashboard">${icon('back')} ${t('common.back')}</a>
        <span class="rep-date">${dateField({ name: 'date', value: date })}</span>
        ${seg('shift', [['morning', t('shift.morning')], ['evening', t('shift.evening')], ['all', t('rep.wholeDay')]], shift)}
        <button class="btn btn-primary" data-print>${icon('print')} ${t('rep.print')}</button>
      </div>
      <div class="doc-stage rep-stage"><div class="rep-pages">
        ${shift === 'all' ? html`${shiftPage('morning')}${shiftPage('evening')}${dayPage()}` : shiftPage(shift)}
      </div></div>`);

    bindDateFields(el); bindSeg(el);
    const go = (p) => navigate(`/report?date=${p.date || date}&shift=${p.shift || shift}`);
    el.querySelector('[name=date]').addEventListener('change', (e) => go({ date: e.target.value }));
    el.querySelectorAll('[name=shift]').forEach((r) => r.addEventListener('change', (e) => { if (e.target.checked) go({ shift: e.target.value }); }));
    on(el, 'click', '[data-print]', () => window.print());
    // phones: shrink the A4 pages to fit the screen
    const fit = () => { const w = el.querySelector('.rep-stage').clientWidth - 16; el.querySelectorAll('.bill').forEach((b) => b.style.setProperty('--bill-zoom', Math.min(1, w / 794).toFixed(3))); };
    fit(); window.addEventListener('resize', fit, { passive: true });
  },
};
