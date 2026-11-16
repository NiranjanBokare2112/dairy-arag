// बिल व पेमेंट → पैसे देणे (D-127): ONE place for all money to farmers —
//   ① UPI payouts waiting for the owner's approval (D-111)
//   ② today's UPI list (send with PIN, or it goes by itself at the set time) and today's results
//   ③ final bills to pay by hand: cash / own UPI (D-125; nothing can be paid twice)
//   ④ money paid in the chosen days (cash + UPI), and UPI payouts that failed / are still with the bank (retry)
// One-time UPI setup (checking farmers' UPI IDs, settings, full history) is behind the ⚙ button (#/billing?tab=upi&sub=…).
import { api } from '../api/index.js';
import { html, mount, on, $ } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { toast, errorText, modal, stat, empty, seg, bindSeg } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { toPaise, formatRupees } from '../lib/money.js';
import { todayIST } from '../lib/dates.js';
import { rangeOf, bindRangeBar, newestFirst } from '../core/rangebar.js';
import { navigate } from '../core/router.js';
import { dateField, bindDateFields } from '../core/datepicker.js';
import { redirect } from '../core/backnav.js';
import { billTabs, billPayFilter, BILLPAY_DEFAULT } from './billing.js';
import { waitingCard, bindWaiting, renderUpiToday, itemsTable, bindRetry, pollWhileProcessing } from './payouts.js';

const PATH = '/billing';

export default {
  title: 'nav.billPay',
  roles: ['owner'],
  async render(el, { query }) {
    if (query.tab !== 'pay') { redirect('/billing?' + new URLSearchParams({ ...query, tab: 'pay' })); return; } // old #/payments links
    const today = todayIST();
    if (query.date) query = { ...query, from: query.date, to: query.date }; // old links: ?date=
    delete query.date;
    const range = rangeOf(query, today, BILLPAY_DEFAULT); // same filter and default as the बिल tab (D-62)
    const label = range.all ? t('my.range.all') : range.from === range.to ? fmt.date(range.from) : `${fmt.date(range.from).slice(0, 5)}–${fmt.date(range.to).slice(0, 5)}`;
    const many = range.from !== range.to;
    const span = range.all ? {} : { from: range.from, to: range.to };
    const [unpaid, register, farmersList, po, poFarmers, runs] = await Promise.all([api.unpaidBills(), api.payments(span), api.farmers({ includeInactive: true }),
      api.payoutToday(), api.payoutFarmers(), api.payoutRuns(span)]);
    register.sort(newestFirst);
    const farmers = new Map(farmersList.map((f) => [f.id, f]));
    const sum = (rows, mode) => rows.filter((p) => !mode || p.mode === mode).reduce((s, p) => s + p.amountPaise, 0);
    const due = unpaid.reduce((s, b) => s + b.payablePaise - b.paidPaise, 0);
    const waits = po.waiting || [];
    const upiOn = po.conf.mode !== 'off';
    // UPI payouts that need a look: failed / sent back by the bank (retry), or still with the bank
    const todayRuns = new Set((po.sentToday || []).map((r) => r.id)); // today's are already in ② with their results
    const trouble = runs.filter((r) => !todayRuns.has(r.id)).flatMap((r) => r.items).filter((x) => ['failed', 'reversed', 'processing'].includes(x.status));
    const n = (i) => ['①', '②', '③', '④'][i - (waits.length ? 1 : 2)];

    const billsCard = unpaid.length ? html`<section class="card"><p class="small muted" style="margin:0 0 10px">${t('appr.billsNote')}</p><div class="table-wrap"><table class="tbl">
        <thead><tr><th>${t('common.code')}</th><th>${t('common.name')}</th><th>${t('billing.period')}</th><th class="num">${t('payments.due')}</th><th></th></tr></thead>
        <tbody>${unpaid.map((b) => { const left = b.payablePaise - b.paidPaise; const byHand = left - (b.inPayoutPaise || 0);
          return html`<tr><td><b>${farmers.get(b.farmerId)?.code}</b></td><td>${farmers.get(b.farmerId)?.name}</td><td class="nowrap">${fmt.date(b.start).slice(0, 5)}–${fmt.date(b.end).slice(0, 5)}</td>
          <td class="num"><b>${fmt.rsPlain(left)}</b>${b.inPayoutPaise ? html`<span class="sub"><span class="tag tag-warn">${t('appr.inPayout', { v: fmt.rs(b.inPayoutPaise) })}</span></span>` : ''}</td>
          <td class="nowrap">${byHand > 0 ? html`<button class="btn btn-sm btn-green" data-pay="${b.id}">${t('payments.pay')}</button>` : ''}</td></tr>`; })}</tbody></table></div></section>`
      : html`<div class="card">${empty(t('payments.allPaid'))}</div>`;

    mount(el, html`
      <div class="page-head"><h1>${t('nav.billPay')}</h1>
        <a class="btn btn-ghost" href="#/billing?tab=upi&sub=farmers">${icon('gear', 18)} ${t('pay.setup')}</a></div>${billTabs('pay', query)}
      ${upiOn ? html`<div class="note note-warn po-sim">${icon('shield', 18)} <span>${t('po.simNote')}</span></div>` : ''}
      <div class="stats" style="margin-bottom:16px">
        ${stat(t('payments.unpaidTotal'), fmt.rs(due), t('payments.billsNow', { n: unpaid.length }), due ? 'warn' : 'good')}
        ${stat(t('payments.cashOn', { date: label }), fmt.rs(sum(register, 'cash')))}
        ${stat(t('payments.upiOn', { date: label }), fmt.rs(sum(register, 'upi')))}
        ${upiOn ? stat(t('po.available'), fmt.rs(po.availablePaise), po.heldPaise ? t('po.heldSub', { v: fmt.rs(po.heldPaise) }) : t('po.availableSub'), po.availablePaise < po.preview.totalPaise ? 'warn' : '')
          : stat(t('payments.paidTotal', { date: label }), fmt.rs(sum(register)), '', 'blue')}
      </div>

      ${waits.length ? html`<h2 class="appr-h">${n(1)} ${t('pay.s.approve')} <span class="tag tag-warn">${waits.length}</span></h2>${waitingCard(waits, { title: false })}` : ''}

      <h2 class="appr-h">${n(2)} ${t('pay.s.upi')}</h2>
      ${upiOn ? html`<div data-upi-today></div>`
        : html`<div class="card"><p class="muted" style="margin:0">${t('pay.upiOff')} <a href="#/billing?tab=upi&sub=settings">${t('pay.turnOn')} →</a></p></div>`}

      <h2 class="appr-h">${n(3)} ${t('appr.bills')} <span class="tag ${unpaid.length ? 'tag-warn' : ''}">${unpaid.length}</span></h2>
      ${billsCard}

      <h2 class="appr-h">${n(4)} ${t('pay.s.paid')}</h2>
      ${billPayFilter(query, range, { count: register.length, unit: t('payments.entries') })}
      ${trouble.length ? html`<section class="card pay-trouble"><h2>${t('pay.trouble')} <span class="tag tag-danger">${trouble.length}</span></h2>${itemsTable(trouble)}</section>` : ''}
      <section class="card"><h2 style="margin-bottom:2px">${t('payments.register')}</h2><p class="small muted" style="margin:0 0 10px">${t('payments.registerFor', { p: label, n: register.length })}</p>
        ${register.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr>${many ? html`<th>${t('common.date')}</th>` : ''}<th>${t('common.name')}</th><th>${t('payments.mode')}</th><th>${t('payments.ref')}</th><th class="num">${t('common.amount')}</th></tr></thead>
        <tbody>${register.map((p) => html`<tr>${many ? html`<td class="nowrap">${fmt.date(p.date)}</td>` : ''}<td><b>${farmers.get(p.farmerId)?.code}</b> ${farmers.get(p.farmerId)?.name}</td>
          <td>${p.mode === 'upi' ? 'UPI' : t('payments.cash')}${p.source === 'payout' ? html` <span class="tag">${t('pay.auto')}</span>` : ''}</td><td class="small ref-cell">${p.upiRef}</td><td class="num">${fmt.rsPlain(p.amountPaise)}</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="${many ? 4 : 3}">${t('common.total')}</td><td class="num">${fmt.rsPlain(sum(register))}</td></tr></tfoot></table></div>` : empty(t(many ? 'payments.noneInRange' : 'payments.noneOnDay'))}
      </section>`);

    const again = () => navigate('/billing?tab=pay&r=' + Date.now());
    bindWaiting(el, waits, again);
    const box = $('[data-upi-today]', el); if (box) await renderUpiToday(box, po, poFarmers);
    const tr = el.querySelector('.pay-trouble'); if (tr) bindRetry(tr, again);
    pollWhileProcessing(el, trouble.some((x) => x.status === 'processing'), '/billing?tab=pay');
    bindDateFields(el);
    bindRangeBar(el, PATH, query, range, today);
    const pay = async (id) => { const b = unpaid.find((x) => x.id === id); if (b && await payBillDialog(b, farmers.get(b.farmerId))) again(); };
    on(el, 'click', '[data-pay]', (_, b) => pay(b.dataset.pay));
    if (query.bill) pay(query.bill); // from the bill page
  },
};

/** Record a cash / UPI payment of one final bill (D-125). */
export async function payBillDialog(bill, f) {
  const left = bill.payablePaise - bill.paidPaise - (bill.inPayoutPaise || 0); // D-125: not what is already on its way by UPI payout
  const ok = await modal(html`<form>
    <div class="modal-head"><h2>${t('payments.record')}</h2><p class="muted" style="margin:4px 0 0">${f.code} · ${f.name} · ${t('payments.due')} ${fmt.rs(left)}</p></div>
    <div class="modal-body stack">
      ${seg('mode', [['upi', 'UPI'], ['cash', t('payments.cash')]], f.upiId ? 'upi' : 'cash')}
      ${f.upiId ? html`<div class="note" data-upi-only>${t('farmers.upi')}: <b>${f.upiId}</b></div>` : ''}
      <div class="form-grid">
        <label class="field"><span>${t('common.amount')} *</span><input name="amount" inputmode="decimal" value="${formatRupees(left).replace(/,/g, '')}"></label>
        <label class="field" data-ref data-upi-only><span>${t('payments.upiRef')} *</span><input name="ref" type="text" autocomplete="off"></label>
        <div class="field"><span>${t('common.date')}</span>${dateField({ name: 'date', value: todayIST() })}</div>
      </div><span class="err" role="alert"></span></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-green">${icon('check')} ${t('common.save')}</button></div></form>`, (d, close) => {
    bindSeg(d);
    bindDateFields(d);
    const form = d.querySelector('form');
    // Cash: no UPI reference and no UPI ID shown. UPI: show the farmer's UPI ID and require the reference (UTR).
    const sync = () => { const upi = form.mode.value === 'upi'; d.querySelectorAll('[data-upi-only]').forEach((x) => { x.hidden = !upi; }); if (!upi) form.ref.value = ''; };
    form.addEventListener('change', sync); sync();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api.addPayment({ billId: bill.id, mode: form.mode.value, amountPaise: toPaise(form.amount.value), upiRef: form.mode.value === 'upi' ? form.ref.value.trim() : '', date: form.date.value }); close(true); } catch (err) { $('.err', d).textContent = errorText(err); }
    });
  });
  if (ok) toast(t('payments.saved'));
  return !!ok;
}
