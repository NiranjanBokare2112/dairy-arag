// A4 Marathi bill, laid out like design-assets/bill/arag-bill-sample-a4.html.
// Used in-app (#/bill/:id) and as the public link sent by SMS (#/b/:token).
// The backend will render the same layout to PDF for WhatsApp (A5.3).
import { api } from '../api/index.js';
import { html, mount } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { badge } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { maybeMr } from '../lib/digits.js';
import { fmtDayMonth } from '../lib/dates.js';

export default {
  title: 'bill.title',
  layout: 'bare',
  async render(el, { params, user }) {
    const b = params.token ? await api.billByToken(params.token) : await api.bill(params.id);
    const c = b.center; const f = b.farmer;
    const M = (s) => maybeMr(s, c.marathiDigitsOnBill); // Marathi digits only on the printed bill, if enabled
    const milkTypes = [...new Set(b.entries.map((e) => e.milkType))];
    const pay = b.payments.at(-1);
    let lastDate = '';
    let band = 0;
    const rows = b.entries.map((e) => {
      const newDay = e.date !== lastDate;
      if (newDay) band++;
      lastDate = e.date;
      return html`<tr class="${band % 2 === 0 ? 'alt' : ''} ${newDay && band > 1 ? 'daystart' : ''}">
        <td class="d">${newDay ? M(fmtDayMonth(e.date)) : ''}</td><td class="s">${fmt.shift(e.shift)}${milkTypes.length > 1 ? ' · ' + fmt.milk(e.milkType) : ''}</td>
        <td class="r">${M(fmt.litres(e.litresX100))}</td><td class="r">${M(fmt.tenths(e.fatX10))}</td><td class="r">${M(fmt.tenths(e.snfX10))}</td>
        <td class="r">${M(fmt.rsPlain(e.ratePaise))}</td><td class="r">${M(fmt.rsPlain(e.amountPaise))}</td></tr>`;
    });
    const feedLabel = b.feedLines.length ? `${t('bill.feed')} (${b.feedLines.map((l) => `${l.qty} ${l.unit}`).join(', ')})` : t('bill.feed');

    mount(el, html`
      <div class="doc-bar">
        ${user && !params.token ? html`<a class="btn btn-ghost" data-back href="#/billing?start=${b.start}">${icon('back')} ${t('common.back')}</a>
          ${b.status === 'final' && b.paidPaise < b.payablePaise ? html`<a class="btn btn-green" href="#/billing?tab=pay&bill=${b.id}">${icon('rupee')} ${t('payments.record')}</a>` : ''}` : ''}
        <button class="btn btn-primary" onclick="window.print()">${icon('print')} ${t('bill.printA4')}</button>
      </div>
      <div class="doc-stage"><article class="bill" id="bill">
        <header class="bill-head">${badge(84)}
          <div class="bill-title"><b>${c.name}</b><span class="tg">${t('brand.tagline')}</span><span class="ad">${c.address} &nbsp;|&nbsp; ${t('common.mobileShort')} ${M(c.mobile)}</span></div>
          <div class="bill-meta"><b>${t('bill.title')}</b>${b.status === 'draft' ? html`<span class="draft">${t('billing.draft')}</span>` : ''}
            <span>${t('bill.no')} ${M(b.no)}</span><span>${t('bill.date')} ${M(fmt.date(b.billDate))}</span></div>
        </header>
        <div class="bill-rule1"></div><div class="bill-rule2"></div>
        <div class="bill-info">
          <div><span>${t('bill.farmerCode')} :</span> <b>${M(f.code)}</b></div>
          <div><span>${t('common.name')} :</span> <b>${f.name}</b></div>
          <div><span>${t('farmers.mobile')} :</span> <b>${M(fmt.maskMobile(f.mobile))}</b></div>
          <div><span>${t('bill.period')} :</span> <b>${M(fmt.date(b.start))} ${t('bill.to')} ${M(fmt.date(b.end))}</b></div>
          <div><span>${t('bill.milkType')} :</span> <b>${milkTypes.map(fmt.milk).join(', ') || '—'}</b></div>
          <div><span>${t('bill.payment')} :</span> <b>${pay ? (pay.mode === 'upi' ? 'UPI' : t('payments.cash')) : f.upiId ? 'UPI' : t('payments.cash')}</b></div>
        </div>
        <table class="bill-table">
          <thead><tr><th>${t('bill.date')}</th><th>${t('bill.shift')}</th><th class="r">${t('bill.litres')}</th><th class="r">Fat %</th><th class="r">SNF %</th><th class="r">${t('bill.rate')}</th><th class="r">${t('bill.amount')}</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td>${t('common.total')}</td><td></td><td class="r">${M(fmt.litres(b.litresX100))}</td><td class="r">${M(fmt.hundredths(b.avgFatX100))}</td><td class="r">${M(fmt.hundredths(b.avgSnfX100))}</td><td class="r">${M(fmt.rsPlain(b.avgRatePaise))}</td><td class="r">${M(fmt.rsPlain(b.grossPaise))}</td></tr></tfoot>
        </table>
        <div class="bill-sum">
          <div class="bill-box"><h4>${t('bill.deductions')}</h4>
            <div class="l"><span>${feedLabel}</span><span>${M(fmt.rs(b.feedPaise))}</span></div>
            <div class="l"><span>${t('bill.advanceInst')}</span><span>${M(fmt.rs(b.advancePaise))}</span></div>
            <div class="l"><span>${t('bill.prevDues')}</span><span>${M(fmt.rs(b.previousDuesPaise))}</span></div>
            <div class="l tot"><span>${t('bill.totalDeduct')}</span><span>${M(fmt.rs(b.totalDeductPaise))}</span></div></div>
          <div class="bill-box main">
            <div class="l"><span>${t('bill.gross')}</span><span>${M(fmt.rs(b.grossPaise))}</span></div>
            <div class="l"><span>${t('bill.minusDeduct')}</span><span>${M(fmt.rs(b.totalDeductPaise))}</span></div>
            <div class="bill-net"><span>${t('bill.net')}</span><b>${M(fmt.rs(b.payablePaise))}</b></div>
            ${pay ? html`<div class="bill-pay">${t('bill.payment')} : ${pay.mode === 'upi' ? 'UPI' : t('payments.cash')}${pay.upiRef ? html` &nbsp;|&nbsp; Ref. ${M('XXXX' + pay.upiRef.slice(-4))}` : ''} &nbsp;|&nbsp; ${M(fmt.date(pay.date))}</div>` : html`<div class="bill-pay">${t('bill.unpaid')}</div>`}
          </div>
        </div>
        <div class="bill-carry">${t('bill.carryForward')} – ${t('bill.advanceLeft')} : <b>${M(fmt.rs(b.advanceRemainingPaise))}</b>${b.carryForwardDuesPaise ? html` &nbsp;|&nbsp; ${t('bill.duesNext')} : <b>${M(fmt.rs(b.carryForwardDuesPaise))}</b>` : ''}</div>
        <div class="bill-foot">${t('bill.footer')}</div>
        <div class="bill-sign"><div>${t('bill.farmerSign')}</div><div>${t('bill.centerSign')}</div></div>
        <div class="bill-bottom"></div>
      </article></div>`);

    // Fit A4 to small screens.
    const bill = el.querySelector('.bill');
    const fit = () => bill.style.setProperty('--bill-zoom', Math.min(1, (document.documentElement.clientWidth - 16) / 794).toFixed(3));
    fit();
    const onResize = () => { if (el.isConnected) fit(); else window.removeEventListener('resize', onResize); };
    window.addEventListener('resize', onResize, { passive: true });
  },
};
