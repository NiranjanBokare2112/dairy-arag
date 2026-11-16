// Daily milk buyers (D-51) — hotels, tea stalls, hostels, households that take milk every day and pay monthly.
//  #/buyers                       रोजची नोंद: one sheet per date + shift; every buyer pre-filled with their usual quantity
//                                 (operator and owner). Saved litres are shown when the sheet was already saved.
//  #/buyers?tab=month&m=YYYY-MM   महिन्याचा हिशोब (owner): previous balance + this month's milk − received = balance.
//                                 &b=<buyerId> opens that buyer's day-by-day statement with a payment form.
//  #/buyers?tab=list              ग्राहक (owner): add / edit buyers, rate per litre, usual morning / evening litres.
//  #/buyers?tab=counter           सुटी विक्री (operator and owner, D-53): occasional / unknown people buying ¼ · ½ · 1 L,
//                                 paid on the spot (cash / UPI). No account, no name needed. Owner sets the price per litre.
import { api } from '../api/index.js';
import { html, mount, on, $, formData } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { toast, errorText, empty, stat, seg, bindSeg } from '../core/ui.js';
import { dateField, bindDateFields } from '../core/datepicker.js';
import * as fmt from '../core/format.js';
import { navigate } from '../core/router.js';
import { parseLitres } from '../lib/qty.js';
import { toPaise, amountFor } from '../lib/money.js';
import { todayIST, currentShift } from '../lib/dates.js';
import { uuid } from '../lib/uuid.js';
import { buyerCycle, prevCycle, nextCycle, billingOf } from '../lib/buyerbill.js';

/** "महिनाअखेर" or "दर १० तारखेला" (D-87). */
const billLabel = (b) => { const x = billingOf(b); return x.kind === 'day' ? t('buyers.bill.dayN', { n: x.day }) : t('buyers.bill.monthEnd'); };
const shortRange = (c) => `${fmt.date(c.start).slice(0, 5)} – ${fmt.date(c.end).slice(0, 5)}`;
/** Due by the buyer's own schedule: amount, due date, overdue tag. */
const dueCell = (bill) => (bill.duePaise ? html`<b class="due">${fmt.rs(bill.duePaise)}</b><span class="sub">${bill.overdue ? html`<span class="tag tag-danger">${t('buyers.bill.overdue', { d: fmt.date(bill.dueDate) })}</span>` : t('buyers.bill.dueOn', { d: fmt.date(bill.dueDate) })}</span>`
  : html`<span class="tag tag-green">${t('buyers.bill.clear')}</span>`);

const lastDayOfMonthStr = (m) => { const [y, mm] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`; };
const monthName = (m) => `${t('dp.months').split(',')[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shiftMonth = (m, n) => { const k = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`; };
const litresIn = (v) => (v === '' ? 0 : parseLitres(v));
const FRAC = { 25: '¼', 50: '½', 75: '¾' };
/** Village measures: 25 → "¼", 150 → "1½", 120 → "1.20". */
export const qtyLabel = (x100) => { const w = Math.floor(x100 / 100), f = x100 % 100; return f === 0 ? String(w) : FRAC[f] ? (w ? w : '') + FRAC[f] : fmt.litres(x100); };

export default {
  title: 'nav.buyers',
  roles: ['owner', 'operator'],
  async render(el, { query = {}, user }) {
    const owner = user.role === 'owner';
    const all = [['day', t('buyers.tab.day')], ['counter', t('buyers.tab.counter')], ...(owner ? [['month', t('buyers.tab.month')], ['list', t('buyers.tab.list')]] : [])];
    const tab = all.some(([k]) => k === query.tab) ? query.tab : 'day';
    const tabs = html`<nav class="tabs">${all
      .map(([k, l]) => html`<a href="#/buyers${k === 'day' ? '' : '?tab=' + k}" class="${k === tab ? 'on' : ''}" ${k === tab ? html`aria-current="page"` : ''}>${l}</a>`)}</nav>`;
    const head = html`<div class="page-head"><h1>${t('nav.buyers')}</h1></div>${tabs}`;
    if (tab === 'day') return renderDay(el, query, head);
    if (tab === 'counter') return renderCounter(el, query, head, owner);
    if (tab === 'month') return renderMonth(el, query, head);
    return renderList(el, query, head);
  },
};

// ------------------------------------------------------------------ रोजची नोंद
async function renderDay(el, query, head) {
  const today = todayIST();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') && query.date <= today ? query.date : today;
  const shift = ['morning', 'evening'].includes(query.shift) ? query.shift : currentShift();
  const day = await api.buyerDay({ date, shift });
  const val = (r) => (r.sale ? r.sale.litresX100 : r.usualX100);
  const rateOf = (r) => (r.sale ? r.sale.ratePaise : r.buyer.ratePaise);

  mount(el, html`${head}
    <section class="card buyer-sheet">
      <div class="form-grid">
        <div class="field"><span>${t('common.date')}</span>${dateField({ name: 'date', value: date })}</div>
        <div class="field"><span>${t('my.shift')}</span>${seg('shift', [['morning', t('shift.morning')], ['evening', t('shift.evening')]], shift)}</div>
      </div>
      ${day.locked ? html`<p class="note note-warn">${t('buyers.locked')}</p>`
        : html`<p class="small muted" style="margin:8px 0 0">${day.saved ? t('buyers.savedNote') : t('buyers.usualNote')}</p>`}
    </section>
    ${day.rows.length ? html`<form class="card" data-sheet novalidate>
      <div class="table-wrap"><table class="tbl buyer-tbl">
        <thead><tr><th>${t('buyers.buyer')}</th><th class="num">${t('buyers.usual')}</th><th class="num">${t('buyers.todayL')}</th><th class="num">${t('common.amount')}</th></tr></thead>
        <tbody>${day.rows.map((r) => html`<tr data-row="${r.buyer.id}" data-rate="${rateOf(r)}" data-usual="${r.usualX100}">
          <td><b>${r.buyer.name}</b><span class="sub">${r.buyer.area || ''} · <span class="tag ${r.buyer.milkType === 'cow' ? 'tag-cow' : 'tag-buf'}">${fmt.milk(r.buyer.milkType)}</span> ${fmt.rs(rateOf(r))}/${t('unit.l')}</span></td>
          <td class="num">${r.usualX100 ? fmt.litres(r.usualX100) : '—'}</td>
          <td class="num"><div class="buyer-qty">
            <input name="l_${r.buyer.id}" inputmode="decimal" value="${val(r) ? fmt.litres(val(r)) : ''}" placeholder="0" aria-label="${r.buyer.name}: ${t('buyers.todayL')}" ${day.locked ? 'disabled' : ''}>
            ${day.locked ? '' : html`<span class="qbtns"><button type="button" class="btn btn-ghost btn-sm" data-usual tabindex="-1">${t('buyers.usualBtn')}</button><button type="button" class="btn btn-ghost btn-sm" data-zero tabindex="-1">0</button></span>`}
          </div></td>
          <td class="num" data-amt></td></tr>`)}</tbody>
        <tfoot><tr><td>${t('common.total')}</td><td></td><td class="num" data-tl></td><td class="num" data-ta></td></tr></tfoot>
      </table></div>
      <p class="small muted" data-split style="margin:8px 0 0"></p>
      <span class="err" role="alert"></span>
      ${day.locked ? '' : html`<button class="btn btn-primary btn-xl btn-block">${day.saved ? t('buyers.saveChanges') : t('buyers.saveAll')}</button>`}
    </form>` : empty(t('buyers.none'))}`);

  bindDateFields(el); bindSeg(el);
  const go = (d, s) => navigate(`/buyers?date=${d}&shift=${s}`);
  el.querySelector('[name=date]')?.addEventListener('change', (e) => go(e.target.value, shift));
  el.querySelectorAll('[name=shift]').forEach((x) => x.addEventListener('change', (e) => { if (e.target.checked) go(date, e.target.value); }));
  const form = $('[data-sheet]', el); if (!form) return;
  const recalc = () => {
    let tl = 0, ta = 0; const byType = { cow: 0, buffalo: 0 }; let bad = false;
    form.querySelectorAll('tr[data-row]').forEach((tr) => {
      const inp = tr.querySelector('input'); const l = litresIn(inp.value.trim());
      inp.classList.toggle('invalid', l == null); if (l == null) { bad = true; tr.querySelector('[data-amt]').textContent = '—'; return; }
      const a = amountFor(l, Number(tr.dataset.rate)); tl += l; ta += a;
      byType[day.rows.find((r) => r.buyer.id === tr.dataset.row).buyer.milkType] += l;
      tr.querySelector('[data-amt]').textContent = l ? fmt.rs(a) : '—';
      tr.classList.toggle('changed', l !== (day.rows.find((r) => r.buyer.id === tr.dataset.row).sale?.litresX100 ?? -1));
    });
    $('[data-tl]', form).textContent = `${fmt.litres(tl)} ${t('unit.l')}`; $('[data-ta]', form).textContent = fmt.rs(ta);
    $('[data-split]', form).textContent = t('buyers.split', { c: fmt.litres(byType.cow), b: fmt.litres(byType.buffalo) });
    return !bad;
  };
  form.addEventListener('input', recalc); recalc();
  // tidy typed litres when leaving the box: 9 → 9.00, 1.5 → 1.50
  form.addEventListener('change', (e) => { const i = e.target; if (i.tagName !== 'INPUT') return; const l = litresIn(i.value.trim()); if (l != null && i.value.trim() !== '') i.value = fmt.litres(l); });
  on(form, 'click', '[data-usual]', (_, b) => { const tr = b.closest('tr'); tr.querySelector('input').value = Number(tr.dataset.usual) ? fmt.litres(Number(tr.dataset.usual)) : ''; recalc(); });
  on(form, 'click', '[data-zero]', (_, b) => { b.closest('tr').querySelector('input').value = '0'; recalc(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!recalc()) { $('.err', form).textContent = t('err.invalid-litres'); return; }
    const rows = [...form.querySelectorAll('tr[data-row]')].map((tr) => ({ buyerId: tr.dataset.row, litresX100: litresIn(tr.querySelector('input').value.trim()) }));
    try { const r = await api.saveBuyerDay({ date, shift, rows }); toast(t('buyers.saved', { n: r.changed })); go(date, shift); }
    catch (err) { $('.err', form).textContent = errorText(err); }
  });
}

// ------------------------------------------------------------------ महिन्याचा हिशोब
async function renderMonth(el, query, head) {
  const cur = todayIST().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(query.m || '') && query.m <= cur ? query.m : cur;
  const m = await api.buyerMonth(month);
  // D-87: a buyer who pays on a fixed day gets the statement of their own bill period (&p=<period start>)
  const sel = query.b ? m.rows.find((r) => r.buyer.id === query.b)?.buyer || (await api.buyers({ includeInactive: true })).find((x) => x.id === query.b) : null;
  const selBilling = sel ? billingOf(sel) : null;
  const period = sel && selBilling.kind === 'day' ? buyerCycle(selBilling, /^\d{4}-\d{2}-\d{2}$/.test(query.p || '') ? query.p : (month === todayIST().slice(0, 7) ? todayIST() : lastDayOfMonthStr(month))) : null;
  const st = query.b ? await api.buyerStatement(period ? { buyerId: query.b, from: period.start, to: period.end } : { buyerId: query.b, month }) : null;
  const T = m.totals;

  mount(el, html`${head}
    <section class="card month-bar">
      <a class="btn btn-ghost" href="#/buyers?tab=month&m=${shiftMonth(month, -1)}" aria-label="${t('dp.prevMonth')}">‹</a>
      <div class="month-title"><b>${monthName(month)}</b>
        <span class="tag ${m.closed ? 'tag-grey' : month === cur ? '' : 'tag-warn'}">${m.closed ? t('buyers.closed') : month === cur ? t('buyers.running') : t('buyers.notClosed')}</span></div>
      ${month < cur ? html`<a class="btn btn-ghost" href="#/buyers?tab=month&m=${shiftMonth(month, 1)}" aria-label="${t('dp.nextMonth')}">›</a>` : html`<span class="btn btn-ghost" aria-hidden="true" style="visibility:hidden">›</span>`}
    </section>
    <div class="stats" style="margin-bottom:12px">
      ${stat(t('buyers.m.milk'), `${fmt.litres(T.litresX100)} ${t('unit.l')}`, t('buyers.m.amount', { v: fmt.rs(T.amountPaise) }), 'blue')}
      ${stat(t('buyers.m.opening'), fmt.rs(T.openingPaise), t('buyers.m.openingSub'))}
      ${stat(t('buyers.m.paid'), fmt.rs(T.paidPaise), t('buyers.m.paidSub'), 'good')}
      ${stat(t('buyers.m.closing'), fmt.rs(T.closingPaise), t('buyers.m.closingSub'), T.closingPaise > 0 ? 'warn' : 'good')}
    </div>
    <p class="note due-strip ${m.due.overdue ? 'warn' : ''}"><b>${t('buyers.bill.dueAll')}:</b> ${fmt.rs(m.due.paise)}${m.due.overdue ? html` · <b>${t('buyers.bill.overdueN', { n: m.due.overdue })}</b>` : ''} <span class="muted">· ${t('buyers.bill.dueNote')}</span></p>
    <p class="note counter-strip"><b>${t('buyers.c.monthStat')}:</b> ${fmt.litres(m.counter.litresX100)} ${t('unit.l')} · ${t('buyers.c.monthSub', { v: fmt.rs(m.counter.amountPaise), n: m.counter.count, c: fmt.rs(m.counter.cashPaise), u: fmt.rs(m.counter.upiPaise) })}</p>
    <div class="grid-2 buyer-month">
      <section class="card">
        <h2>${t('buyers.m.title')}</h2>
        ${m.rows.length ? html`<div class="table-wrap"><table class="tbl buyer-tbl">
          <thead><tr><th>${t('buyers.buyer')}</th><th class="num">${t('unit.l')}</th><th class="num">${t('buyers.m.thisMonth')}</th><th class="num">${t('buyers.m.balance')}</th></tr></thead>
          <tbody>${m.rows.map((r) => html`<tr class="clickable ${query.b === r.buyer.id ? 'sel' : ''}" data-b="${r.buyer.id}" tabindex="0">
            <td><b>${r.buyer.name}</b><span class="sub">${t('buyers.m.days', { n: r.days })}</span></td>
            <td class="num">${fmt.litres(r.litresX100)}</td><td class="num">${fmt.rs(r.amountPaise)}</td>
            <td class="num"><b class="${r.closingPaise > 0 ? 'due' : ''}">${fmt.rs(r.closingPaise)}</b><span class="sub">${t('buyers.m.rowPrev', { o: fmt.rs(r.openingPaise) })}</span><span class="sub">${t('buyers.m.rowPaid', { p: fmt.rs(r.paidPaise) })}</span>
              <span class="sub">${billLabel(r.buyer)}${r.bill.overdue ? html` · <span class="tag tag-danger">${t('buyers.bill.overdueShort')}</span>` : ''}</span></td></tr>`)}</tbody>
          </table></div>` : empty(t('buyers.none'))}
        <p class="small muted">${t('buyers.m.note')}</p>
        ${!m.closed && m.canClose ? html`<button class="btn btn-ghost" data-close>${t('buyers.closeMonth', { m: monthName(month) })}</button>` : ''}
      </section>
      ${st ? statement(st, month, period, selBilling) : html`<section class="card"><p class="muted">${t('buyers.pickBuyer')}</p></section>`}
    </div>`);

  on(el, 'click', 'tr[data-b]', (_, tr) => navigate(`/buyers?tab=month&m=${month}&b=${tr.dataset.b}`));
  on(el, 'keydown', 'tr[data-b]', (e, tr) => { if (e.key === 'Enter') navigate(`/buyers?tab=month&m=${month}&b=${tr.dataset.b}`); });
  on(el, 'click', '[data-close]', async () => {
    try { await api.closeBuyerMonth(month); toast(t('buyers.closedToast')); navigate(`/buyers?tab=month&m=${month}`); } catch (err) { toast(errorText(err), 'err'); }
  });
  bindSeg(el); bindDateFields(el);
  const pf = $('[data-pay]', el);
  if (pf) {
    const upi = () => { const isUpi = pf.mode.value === 'upi'; pf.querySelector('[data-upi]').hidden = !isUpi; };
    pf.addEventListener('change', upi); upi();
    pf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formData(pf); const amountPaise = toPaise(v.amount);
      try {
        if (!amountPaise) throw { code: 'invalid' };
        await api.addBuyerPayment({ buyerId: query.b, date: v.date, mode: v.mode, amountPaise, upiRef: v.mode === 'upi' ? v.upiRef.trim() : '', note: v.note });
        // a payment counts in the month it was received: open that month's account
        toast(t('common.saved')); navigate(`/buyers?tab=month&m=${v.date.slice(0, 7)}&b=${query.b}`);
      } catch (err) { $('.err', pf).textContent = errorText(err); }
    });
  }
}

function statement(st, month, period, billing) {
  const b = st.buyer;
  const link = (c) => `#/buyers?tab=month&m=${month}&b=${b.id}&p=${c.start}`;
  return html`<section class="card buyer-stmt">
    <div class="card-head"><h2>${b.name}</h2><span class="tag ${b.milkType === 'cow' ? 'tag-cow' : 'tag-buf'}">${fmt.milk(b.milkType)} · ${fmt.rs(b.ratePaise)}/${t('unit.l')}</span></div>
    <p class="small muted" style="margin-top:-6px">${b.area || ''}${b.mobile ? ' · ' + b.mobile : ''} · ${billLabel(b)} · ${t('buyers.since', { d: fmt.date(b.startDate) })}</p>
    ${period ? html`<div class="period-bar"><a class="btn btn-sm btn-ghost" href="${link(prevCycle(billing, period))}" aria-label="${t('buyers.bill.prev')}">‹</a>
      <span><b>${t('buyers.bill.period')}: ${shortRange(period)}</b><span class="small muted"> · ${t('buyers.bill.dueOn', { d: fmt.date(period.due) })}</span></span>
      ${period.end < todayIST() ? html`<a class="btn btn-sm btn-ghost" href="${link(nextCycle(billing, period))}" aria-label="${t('buyers.bill.next')}">›</a>` : html`<span class="btn btn-sm btn-ghost" style="visibility:hidden">›</span>`}</div>` : ''}
    <div class="bill-now ${st.bill.overdue ? 'warn' : ''}"><span>${t('buyers.bill.dueNow')}</span>${dueCell(st.bill)}</div>
    ${st.days.length ? html`<div class="table-wrap"><table class="tbl">
      <thead><tr><th>${t('common.date')}</th><th class="num">${t('shift.morning')}</th><th class="num">${t('shift.evening')}</th><th class="num">${t('common.amount')}</th></tr></thead>
      <tbody>${st.days.map((d) => html`<tr><td>${fmt.date(d.date).slice(0, 5)}</td><td class="num">${d.morningX100 ? fmt.litres(d.morningX100) : '—'}</td>
        <td class="num">${d.eveningX100 ? fmt.litres(d.eveningX100) : '—'}</td><td class="num">${fmt.rs(d.amountPaise)}</td></tr>`)}</tbody>
      <tfoot><tr><td>${t('common.total')}</td><td colspan="2" class="num">${fmt.litres(st.litresX100)} ${t('unit.l')}</td><td class="num">${fmt.rs(st.amountPaise)}</td></tr></tfoot>
    </table></div>` : empty(t('buyers.noDays'))}
    <div class="bl-list stmt-sum">
      <div class="bl"><span>${t('buyers.m.opening')}</span><b>${fmt.rs(st.openingPaise)}</b></div>
      <div class="bl"><span>+ ${period ? t('buyers.bill.thisPeriod') : t('buyers.m.thisMonth')}</span><b>${fmt.rs(st.amountPaise)}</b></div>
      ${st.payments.map((p) => html`<div class="bl paid"><span>− ${t('buyers.m.receivedOn', { d: fmt.date(p.date), m: p.mode === 'upi' ? 'UPI' : t('payments.cash') })}${p.upiRef ? html` <small class="muted">${p.upiRef}</small>` : ''}</span><b>${fmt.rs(p.amountPaise)}</b></div>`)}
      <div class="bl total"><span>${t('buyers.m.closing')}</span><b>${fmt.rs(st.closingPaise)}</b></div>
    </div>
    <form class="stack buyer-pay" data-pay novalidate>
      <h3>${t('buyers.pay.title')}</h3>
      <div class="form-grid">
        <div class="field"><span>${t('common.date')}</span>${dateField({ name: 'date', value: todayIST() })}</div>
        <label class="field"><span>${t('common.amount')} (₹) *</span><input name="amount" inputmode="decimal" value="${st.bill.duePaise > 0 ? fmt.rsPlain(st.bill.duePaise).replace(/,/g, '') : st.closingPaise > 0 ? fmt.rsPlain(st.closingPaise).replace(/,/g, '') : ''}"></label>
      </div>
      ${seg('mode', [['cash', t('payments.cash')], ['upi', 'UPI']], 'cash')}
      <label class="field" data-upi hidden><span>${t('payments.upiRef')} *</span><input name="upiRef" autocomplete="off"></label>
      <label class="field"><span>${t('rates.note')}</span><input name="note" type="text"></label>
      <p class="small muted" style="margin:0">${t('buyers.pay.hint')}</p>
      <span class="err" role="alert"></span>
      <button class="btn btn-primary">${t('buyers.pay.save')}</button>
    </form>
  </section>`;
}

// ------------------------------------------------------------------ सुटी विक्री (D-53)
async function renderCounter(el, query, head, owner) {
  const today = todayIST();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') && query.date <= today ? query.date : today;
  const shift = ['morning', 'evening'].includes(query.shift) ? query.shift : currentShift();
  const milk = 'cow'; // every new sale starts on गाय (most walk-ins buy cow milk)
  const d = await api.counterSales({ date });
  const T = d.totals;
  const go = (p = {}) => navigate(`/buyers?tab=counter&date=${p.date || date}&shift=${p.shift || shift}`);

  mount(el, html`${head}
    <div class="grid-2 counter">
      <form class="card stack" data-counter novalidate>
        <h2>${t('buyers.c.title')}</h2>
        <p class="small muted" style="margin:-6px 0 0">${t('buyers.c.intro')}</p>
        <div class="form-grid">
          <div class="field"><span>${t('common.date')}</span>${dateField({ name: 'date', value: date })}</div>
          <div class="field"><span>${t('my.shift')}</span>${seg('shift', [['morning', t('shift.morning')], ['evening', t('shift.evening')]], shift)}</div>
        </div>
        ${d.locked ? html`<p class="note note-warn">${t('buyers.locked')}</p>` : html`
        <div class="field"><span>${t('common.milk')}</span>${seg('milk', [['cow', `${t('milk.cow')} · ${fmt.rs(d.rates.cow)}`], ['buffalo', `${t('milk.buffalo')} · ${fmt.rs(d.rates.buffalo)}`]], milk)}</div>
        <div class="field"><span>${t('buyers.c.qty')}</span>
          <div class="qty-pick">${[25, 50, 100, 200].map((q) => html`<button type="button" class="btn btn-ghost" data-add="${q}">+ ${qtyLabel(q)} ${t('unit.l')}</button>`)}</div>
          <div class="qty-row"><input name="qty" inputmode="decimal" placeholder="0" aria-label="${t('buyers.c.qty')}" autocomplete="off">
            <span>${t('unit.l')}</span><button type="button" class="btn btn-ghost btn-sm" data-clear>${t('buyers.c.clear')}</button></div>
          <span class="hint">${t('buyers.c.qtyHint')}</span>
        </div>
        <div class="counter-amt" aria-live="polite"><span data-qlabel></span><b data-amt>₹0.00</b></div>
        <div class="field"><span>${t('payments.mode')}</span>${seg('mode', [['cash', t('payments.cash')], ['upi', 'UPI']], 'cash')}</div>
        <label class="field" data-upi hidden><span>${t('buyers.c.upiRef')}</span><input name="upiRef" type="text" autocomplete="off"></label>
        <label class="field"><span>${t('buyers.c.name')}</span><input name="name" type="text" autocomplete="off" placeholder="${t('buyers.c.namePh')}"></label>
        <span class="err" role="alert"></span>
        <button class="btn btn-primary btn-xl btn-block">${t('buyers.c.save')}</button>`}
      </form>
      <section class="card">
        <div class="card-head"><h2>${t('buyers.c.day', { d: fmt.date(date) })}</h2></div>
        <div class="stats stats-sm">
          ${stat(t('buyers.c.sold'), `${fmt.litres(T.litresX100)} ${t('unit.l')}`, t('buyers.split', { c: fmt.litres(T.cowX100), b: fmt.litres(T.buffaloX100) }), 'blue')}
          ${stat(t('buyers.c.got'), fmt.rs(T.amountPaise), t('buyers.c.gotSub', { c: fmt.rs(T.cashPaise), u: fmt.rs(T.upiPaise) }), 'good')}
        </div>
        ${d.rows.length ? html`<div class="table-wrap"><table class="tbl counter-tbl">
          <thead><tr><th>${t('buyers.c.when')}</th><th>${t('common.milk')}</th><th class="num">${t('common.amount')}</th><th></th></tr></thead>
          <tbody>${d.rows.map((s) => html`<tr class="${s.void ? 'void' : ''}">
            <td>${fmt.dateTime(s.createdAt).slice(-5)}<span class="sub">${fmt.shift(s.shift)}${s.name ? ' · ' + s.name : ''}</span></td>
            <td><b class="q">${qtyLabel(s.litresX100)} ${t('unit.l')}</b><span class="sub"><span class="tag ${s.milkType === 'cow' ? 'tag-cow' : 'tag-buf'}">${fmt.milk(s.milkType)}</span></span></td>
            <td class="num">${fmt.rs(s.amountPaise)}<span class="sub">${s.mode === 'upi' ? 'UPI' : t('payments.cash')}${s.upiRef ? ' · ' + s.upiRef : ''}</span></td>
            <td class="num">${s.void ? html`<span class="sub">${t('buyers.c.voided', { r: s.voidReason })}</span>`
              : d.locked ? '' : html`<button type="button" class="btn btn-ghost btn-sm" data-void="${s.id}">${t('buyers.c.void')}</button>`}</td></tr>`)}</tbody>
        </table></div>` : empty(t('buyers.c.none'))}
        <p class="small muted">${t('buyers.c.note')}</p>
      </section>
      ${owner ? html`<form class="card stack" data-rates novalidate>
        <h2>${t('buyers.c.rates')}</h2>
        <div class="form-grid">
          <label class="field"><span>${t('milk.cow')} ₹ / ${t('unit.l')}</span><input name="cow" inputmode="decimal" value="${fmt.rsPlain(d.rates.cow).replace(/,/g, '')}"></label>
          <label class="field"><span>${t('milk.buffalo')} ₹ / ${t('unit.l')}</span><input name="buffalo" inputmode="decimal" value="${fmt.rsPlain(d.rates.buffalo).replace(/,/g, '')}"></label>
        </div>
        <span class="hint">${t('buyers.c.ratesHint')}</span>
        <span class="err" role="alert"></span>
        <div class="row"><button class="btn btn-primary">${t('common.save')}</button></div>
      </form>` : ''}
    </div>`);

  bindDateFields(el); bindSeg(el);
  el.querySelector('[name=date]')?.addEventListener('change', (e) => go({ date: e.target.value }));
  on(el, 'click', '[data-void]', async (_, b) => {
    const reason = window.prompt(t('buyers.c.voidAsk'));
    if (reason == null) return;
    try { await api.voidCounterSale({ id: b.dataset.void, reason }); toast(t('buyers.c.voidedToast')); go(); } catch (err) { toast(errorText(err), 'err'); }
  });
  const rf = $('[data-rates]', el);
  rf?.addEventListener('submit', async (e) => {
    e.preventDefault(); const v = formData(rf);
    try { await api.saveCounterRates({ cowPaise: toPaise(v.cow), buffaloPaise: toPaise(v.buffalo) }); toast(t('common.saved')); go(); }
    catch (err) { $('.err', rf).textContent = errorText(err); }
  });
  const f = $('[data-counter]', el); if (!f || d.locked) return;
  let saleId = uuid(); // one id per sale: a double tap / retry never records it twice
  const qty = f.qty;
  const rate = () => d.rates[f.milk.value];
  const recalc = () => {
    const l = litresIn(qty.value.trim()); qty.classList.toggle('invalid', l == null);
    $('[data-amt]', f).textContent = fmt.rs(l ? amountFor(l, rate()) : 0);
    $('[data-qlabel]', f).textContent = l ? `${qtyLabel(l)} ${t('unit.l')} ${fmt.milk(f.milk.value)}` : '';
    return l;
  };
  f.addEventListener('input', recalc);
  f.addEventListener('change', (e) => {
    if (e.target.name === 'mode') f.querySelector('[data-upi]').hidden = f.mode.value !== 'upi';
    if (e.target.name === 'shift' && e.target.checked) go({ shift: e.target.value });
    recalc();
  });
  on(f, 'click', '[data-add]', (_, b) => { const l = litresIn(qty.value.trim()) || 0; qty.value = fmt.litres(l + Number(b.dataset.add)); recalc(); });
  on(f, 'click', '[data-clear]', () => { qty.value = ''; recalc(); qty.focus(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const l = recalc();
    if (!l) { $('.err', f).textContent = t('err.invalid-litres'); return; }
    const v = formData(f);
    try {
      const s = await api.addCounterSale({ id: saleId, date, shift, milkType: v.milk, litresX100: l, mode: v.mode, upiRef: v.upiRef || '', name: v.name || '' });
      saleId = uuid();
      toast(t('buyers.c.savedToast', { q: qtyLabel(s.litresX100), v: fmt.rs(s.amountPaise) })); go();
    } catch (err) { $('.err', f).textContent = errorText(err); }
  });
  qty.focus();
}

// ------------------------------------------------------------------ ग्राहक
async function renderList(el, query, head) {
  const list = await api.buyers({ includeInactive: true });
  const ed = query.e ? list.find((b) => b.id === query.e) : null;
  const v = (k, d = '') => (ed ? ed[k] : d);
  mount(el, html`${head}
    <div class="grid-2 buyer-list">
      <form class="card stack" data-buyer novalidate>
        <h2>${ed ? t('buyers.edit', { name: ed.name }) : t('buyers.add')}</h2>
        <label class="field"><span>${t('common.name')} *</span><input name="name" type="text" value="${v('name')}" required></label>
        <div class="form-grid">
          <label class="field"><span>${t('farmers.mobile')}</span><input name="mobile" inputmode="tel" maxlength="10" value="${v('mobile')}"></label>
          <label class="field"><span>${t('buyers.area')}</span><input name="area" type="text" value="${v('area')}"></label>
        </div>
        <div class="field"><span>${t('common.milk')} *</span>${seg('milkType', [['cow', t('milk.cow')], ['buffalo', t('milk.buffalo')]], v('milkType', 'cow'))}</div>
        <div class="form-grid">
          <label class="field"><span>${t('buyers.rate')} *</span><input name="rate" inputmode="decimal" value="${ed ? fmt.rsPlain(ed.ratePaise).replace(/,/g, '') : ''}"></label>
          <label class="field"><span>${t('buyers.usualMorning')}</span><input name="morning" inputmode="decimal" value="${ed && ed.morningX100 ? fmt.litres(ed.morningX100) : ''}"></label>
          <label class="field"><span>${t('buyers.usualEvening')}</span><input name="evening" inputmode="decimal" value="${ed && ed.eveningX100 ? fmt.litres(ed.eveningX100) : ''}"></label>
        </div>
        <span class="hint">${t('buyers.rateHint')}</span>
        <div class="form-grid">
          <div class="field"><span>${t('buyers.start')} *</span>${dateField({ name: 'startDate', value: ed?.startDate || todayIST(), max: '' })}<span class="hint">${t('buyers.startHint')}</span></div>
          <div class="field"><span>${t('buyers.bill.when')} *</span>
            ${seg('billKind', [['month-end', t('buyers.bill.monthEnd')], ['day', t('buyers.bill.fixedDay')]], billingOf(ed || {}).kind)}
            <label class="bill-day" data-bill-day ${billingOf(ed || {}).kind === 'day' ? '' : 'hidden'}><span>${t('buyers.bill.dayLabel')}</span>
              <input name="billDay" inputmode="numeric" maxlength="2" value="${billingOf(ed || {}).day || 10}"></label>
            <span class="hint" data-bill-hint></span></div>
        </div>
        <label class="check"><input type="checkbox" name="active" ${!ed || ed.active ? 'checked' : ''}> ${t('buyers.active')}</label>
        <span class="err" role="alert"></span>
        <div class="row"><button class="btn btn-primary">${t('common.save')}</button>${ed ? html`<a class="btn btn-ghost" href="#/buyers?tab=list">${t('common.cancel')}</a>` : ''}</div>
      </form>
      <section class="card"><h2>${t('buyers.all', { n: list.length })}</h2>
        ${list.length ? html`<div class="table-wrap"><table class="tbl buyer-tbl">
          <thead><tr><th>${t('buyers.buyer')}</th><th class="num">${t('buyers.rateShort')}</th><th class="num">${t('buyers.usual')}</th><th>${t('buyers.bill.col')}</th><th class="num">${t('buyers.bill.dueCol')}</th></tr></thead>
          <tbody>${list.map((b) => html`<tr class="clickable ${b.active ? '' : 'muted'}" data-e="${b.id}" tabindex="0">
            <td><b>${b.code}. ${b.name}</b><span class="sub">${b.area || ''} · ${fmt.milk(b.milkType)}${b.active ? '' : ' · ' + t('buyers.inactive')}</span></td>
            <td class="num">${fmt.rs(b.ratePaise)}</td>
            <td class="num">${fmt.litres(b.morningX100)} + ${fmt.litres(b.eveningX100)}</td>
            <td>${billLabel(b)}<span class="sub">${t('buyers.since', { d: fmt.date(b.startDate) })}</span></td>
            <td class="num">${dueCell(b.bill)}</td></tr>`)}</tbody></table></div>` : empty(t('buyers.none'))}
        <p class="small muted">${t('buyers.listNote')}</p>
      </section>
    </div>`);
  bindSeg(el); bindDateFields(el);
  on(el, 'click', 'tr[data-e]', (_, tr) => navigate(`/buyers?tab=list&e=${tr.dataset.e}`));
  const f = $('[data-buyer]', el);
  // D-87: example of the bill period for the chosen schedule
  const billHint = () => {
    const day = f.billKind.value === 'day'; $('[data-bill-day]', el).hidden = !day;
    const n = parseInt(f.billDay.value, 10);
    const c = buyerCycle(day && n >= 1 && n <= 28 ? { kind: 'day', day: n } : { kind: 'month-end' }, todayIST());
    $('[data-bill-hint]', el).textContent = day && !(n >= 1 && n <= 28) ? t('err.invalid-bill-day') : t('buyers.bill.example', { a: fmt.date(c.start), b: fmt.date(c.end), d: fmt.date(c.due) });
  };
  f.addEventListener('change', billHint); f.addEventListener('input', billHint); billHint();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const x = formData(f);
    try {
      const morningX100 = litresIn(x.morning.trim()); const eveningX100 = litresIn(x.evening.trim()); const ratePaise = toPaise(x.rate);
      if (morningX100 == null || eveningX100 == null) throw { code: 'invalid-litres' };
      if (!ratePaise) throw { code: 'invalid-rate' };
      await api.saveBuyer({ id: ed?.id, name: x.name, mobile: x.mobile.trim(), area: x.area, milkType: x.milkType, ratePaise, morningX100, eveningX100, active: f.active.checked,
        startDate: x.startDate, billing: x.billKind === 'day' ? { kind: 'day', day: parseInt(x.billDay, 10) } : { kind: 'month-end' } });
      toast(t('common.saved')); navigate('/buyers?tab=list');
    } catch (err) { $('.err', f).textContent = errorText(err); }
  });
}
