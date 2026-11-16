// बिल व पेमेंट → ⚙ UPI सेटिंग्ज (D-107, D-127). Daily work (approve, today's list, results) is in the पैसे देणे tab;
// this screen is the one-time setup behind its ⚙ button:
//   UPI तपासणी व पसंती ₹1 check of every UPI ID / bank account (bank's name, owner confirms) and each farmer's choice of when to be paid
//   इतिहास            every payout run and every ₹1 check
//   सेटिंग्ज           mode, time, which milk, minimum, limits, fee, farmers' choice, gateway
// `renderUpiToday` (today's list → approve with PIN / goes by itself → results, retry) is shown inside पैसे देणे.
// The gateway is SIMULATED until the owner picks Cashfree / RazorpayX: a banner says so on every screen.
import { api } from '../api/index.js';
import { html, mount, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { toast, errorText, modal, confirmBox, stat, empty, seg, bindSeg } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { toPaise, formatRupees } from '../lib/money.js';
import { navigate } from '../core/router.js';
import { billTabs } from './billing.js';
import { redirect } from '../core/backnav.js';
import { namesMatch } from '../lib/translit.js';

const SUBS = ['farmers', 'history', 'settings'];
const KINDS = ['daily', 'bill', 'day', 'month-end', 'approval'];
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

export const prefText = (p) => (p.kind === 'day' ? t('po.pref.dayN', { n: p.day }) : t('po.pref.' + p.kind));
const href = (sub) => '#/billing?tab=upi&sub=' + sub;
const hm = (ts) => (ts ? fmt.dateTime(ts).slice(-5) : ''); // IST HH:MM
const rupees = (paise) => formatRupees(paise).replace(/,/g, '');
const statusTag = (st) => html`<span class="tag ${{ success: 'tag-green', failed: 'tag-danger', skipped: 'tag-grey', cancelled: 'tag-grey', proposed: 'tag-warn', approved: 'tag-warn', processing: 'tag-warn' }[st] || 'tag-grey'}">${t('po.st.' + st)}</span>`;
const checkTag = (c) => html`<span class="tag ${{ verified: 'tag-green', 'name-check': 'tag-warn', failed: 'tag-danger', rejected: 'tag-danger' }[c] || 'tag-grey'}">${t('po.chk.' + c)}</span>`;
const periods = (parts = []) => parts.map((p) => `${fmt.date(p.start).slice(0, 5)}–${fmt.date(p.end).slice(0, 5)}${p.kind === 'bill' ? ' ' + t('po.billPart') : ''}`).join(', ');

/** PIN prompt before any money moves. Resolves the PIN, or null. */
export function askPin(title, sub) {
  return modal(html`<form class="pin-ask">
    <div class="modal-head"><h2>${icon('shield', 22)} ${title}</h2>${sub ? html`<p class="muted" style="margin:4px 0 0">${sub}</p>` : ''}</div>
    <div class="modal-body stack"><label class="field"><span>${t('po.pin')}</span>
      <input name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" required></label>
      <p class="small muted" style="margin:0">${t('po.pinWhy')}</p></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>${t('common.cancel')}</button>
      <button class="btn btn-green">${icon('send', 18)} ${t('po.send')}</button></div></form>`, (d, close) => {
    const f = d.querySelector('form');
    f.addEventListener('submit', (e) => { e.preventDefault(); if (f.pin.value.trim()) close(f.pin.value.trim()); });
    setTimeout(() => f.pin.focus(), 50);
  });
}

export default {
  title: 'nav.billPay',
  roles: ['owner'],
  async render(el, ctx) {
    const query = ctx.query || {};
    if (!SUBS.includes(query.sub)) { redirect('/billing?tab=pay'); return; } // today's UPI list lives in पैसे देणे (D-127)
    const sub = query.sub;
    const head = html`<div class="page-head"><h1>${t('nav.billPay')}</h1><a class="btn btn-ghost" href="#/billing?tab=pay">← ${t('pay.back')}</a></div>${billTabs('pay', query)}
      <h2 class="appr-h">${icon('gear', 20)} ${t('pay.setup')}</h2>
      <nav class="chips po-subs" aria-label="${t('po.title')}">${SUBS.map((s) => html`<a class="chip-btn ${s === sub ? 'on' : ''}" href="${href(s)}" ${s === sub ? html`aria-current="page"` : ''}>${t('po.sub.' + s)}</a>`)}</nav>
      <div class="note note-warn po-sim">${icon('shield', 18)} <span>${t('po.simNote')}</span></div>`;
    if (sub === 'farmers') return renderFarmers(el, head);
    if (sub === 'history') return renderHistory(el, head);
    return renderSettings(el, head);
  },
};

// ---------------------------------------------------------------- आजचे देय
export async function renderUpiToday(el, d, farmers) {
  const { conf, preview: pv, run } = d;
  const verified = farmers.filter((f) => f.verified).length;
  const sentPaise = d.sentToday.reduce((s, r) => s + r.sentPaise, 0);
  const modeLine = t('po.modeLine.' + conf.mode + (conf.mode === 'eod' && conf.eodApproval ? '-ok' : ''), { t: conf.time });
  const why = (w) => t('po.why.' + w);
  const groups = ['unverified', 'no-upi', 'below-min', 'cap-day', 'not-due'].map((w) => [w, [...pv.held, ...pv.waiting].filter((x) => x.why === w)]).filter(([, l]) => l.length);

  const runTable = (r) => html`<form data-run="${r.id}">
    <div class="table-wrap"><table class="tbl po-tbl"><thead><tr><th class="po-ck"><input type="checkbox" data-all checked aria-label="${t('po.all')}"></th>
      <th>${t('common.code')}</th><th>${t('common.name')}</th><th>${t('po.upi')}</th><th>${t('po.when')}</th><th>${t('po.periods')}</th><th class="num">${t('po.amount')}</th></tr></thead>
      <tbody>${r.items.map((x) => html`<tr><td class="po-ck"><input type="checkbox" name="pick" value="${x.id}" data-amt="${x.creditPaise}" checked aria-label="${x.name}"></td>
        <td><b>${x.code}</b></td><td>${x.name}</td><td class="small"><span class="po-ok">${icon('check', 14)}</span> ${x.upiId}</td><td class="small">${prefText(x.pref)}</td>
        <td class="small nowrap">${periods(x.parts)}${x.capped ? html` <span class="tag tag-warn">${t('po.capped')}</span>` : ''}</td><td class="num"><b>${fmt.rsPlain(x.creditPaise)}</b></td></tr>`)}</tbody>
      <tfoot><tr><td colspan="6">${t('po.selected')} <b data-sel-n>${r.items.length}</b></td><td class="num"><b data-sel-sum>${fmt.rsPlain(r.items.reduce((s, x) => s + x.creditPaise, 0))}</b></td></tr></tfoot></table></div>
    <div class="row po-actions"><button type="button" class="btn btn-ghost danger-text" data-cancel-run="${r.id}">${t('po.cancelList')}</button><span class="spacer"></span>
      <button type="button" class="btn btn-ghost" data-rebuild>${t('po.rebuild')}</button>
      <button class="btn btn-green" data-approve>${icon('send', 18)} ${t('po.approveSend')} <span data-sel-btn>${fmt.rs(r.items.reduce((s, x) => s + x.creditPaise, 0))}</span></button></div></form>`;

  const resultTable = (r) => html`<section class="card po-result">
    <div class="row"><h2 style="margin:0">${t('po.sentAt', { t: hm(r.sentAt) })}</h2>
      <span class="tag">${t('po.mode.' + (r.mode === 'auto' ? 'eod' : r.mode))}</span><span class="spacer"></span>${r.processingCount ? html`<span class="tag tag-warn">${t('po.procN', { n: r.processingCount })}</span>` : ''}${r.reversedCount ? html`<span class="tag tag-danger">${t('po.revN', { n: r.reversedCount })}</span>` : ''}${r.waitingCount ? html`<span class="tag tag-warn">${t('po.waitN', { n: r.waitingCount })}</span>` : ''}
      <span class="tag tag-green">${t('po.okN', { n: r.okCount, v: fmt.rs(r.sentPaise) })}</span>${r.failCount ? html`<span class="tag tag-danger">${t('po.failN', { n: r.failCount })}</span>` : ''}</div>
    ${itemsTable(r.items.filter((x) => x.status !== 'skipped' && !(x.status === 'proposed' && x.waitApproval)))}</section>`;

  mount(el, html`
    <p class="small muted po-modeline">${icon('clock', 14)} <b>${t('po.mode.' + conf.mode)}</b> · ${modeLine} · ${t('po.sentToday')}: ${fmt.rs(sentPaise)} · ${t('po.checked')}: ${verified} / ${farmers.filter((f) => f.upiId).length}</p>
    <section class="card">
      <div class="row po-head"><h2 style="margin:0">${run ? t('po.listToApprove') : t('po.listNow')}</h2>
        <span class="muted small">${t('po.milkUpTo', { d: fmt.date(pv.upTo) })}</span><span class="spacer"></span>
        ${!run && pv.ready.length ? html`<button class="btn btn-primary" data-make>${icon('check', 18)} ${t('po.makeList')}</button>` : ''}</div>
      ${conf.mode === 'off' ? html`<p class="note">${t('po.offNote')} <a href="${href('settings')}">${t('po.sub.settings')} →</a></p>` : ''}
      ${run ? runTable(run) : pv.ready.length ? html`<div class="table-wrap"><table class="tbl po-tbl"><thead><tr><th>${t('common.code')}</th><th>${t('common.name')}</th><th>${t('po.upi')}</th><th>${t('po.when')}</th><th>${t('po.periods')}</th><th class="num">${t('po.amount')}</th></tr></thead>
          <tbody>${pv.ready.map((x) => html`<tr><td><b>${x.code}</b></td><td>${x.name}</td><td class="small">${x.upiId}</td><td class="small">${prefText(x.pref)}</td><td class="small nowrap">${periods(x.parts)}</td><td class="num"><b>${fmt.rsPlain(x.creditPaise)}</b></td></tr>`)}</tbody>
          <tfoot><tr><td colspan="5">${t('common.total')} · ${t('po.feesLine', { v: fmt.rs(pv.feesPaise), who: t('po.feeBy.' + conf.feeBy) })}</td><td class="num"><b>${fmt.rsPlain(pv.totalPaise)}</b></td></tr></tfoot></table></div>
          <p class="small muted" style="margin:10px 0 0">${conf.mode === 'auto' ? t('po.autoHint', { t: conf.time }) : t('po.approveHint')}</p>`
        : empty(t('po.nobodyDue'))}
    </section>
    ${d.sentToday.filter((r) => r.items.some((x) => x.status !== 'skipped' && !(x.status === 'proposed' && x.waitApproval))).map(resultTable)}
    ${groups.length ? html`<section class="card"><h2>${t('po.notToday')}</h2>
      ${groups.map(([w, list]) => html`<details class="po-why"><summary><b>${why(w)}</b> <span class="tag">${list.length}</span>
          ${w === 'unverified' || w === 'no-upi' ? html`<a class="small" href="${href('farmers')}">${t('po.goCheck')} →</a>` : ''}</summary>
        <div class="table-wrap"><table class="tbl"><tbody>${list.map((x) => html`<tr><td><b>${x.code}</b></td><td>${x.name}</td><td class="small">${prefText(x.pref)}</td>
          <td class="small">${w === 'not-due' ? (x.next ? t('po.nextOn', { d: fmt.date(x.next) }) : t('po.onBill')) : periods(x.parts)}</td>
          <td class="num">${x.amountPaise ? fmt.rsPlain(x.amountPaise) : ''}</td></tr>`)}</tbody></table></div></details>`)}</section>` : ''}`);

  // selection sums
  const form = el.querySelector('form[data-run]');
  const resum = () => {
    const picks = [...form.querySelectorAll('[name=pick]')]; const on = picks.filter((x) => x.checked);
    const total = on.reduce((s, x) => s + Number(x.dataset.amt), 0);
    form.querySelector('[data-sel-n]').textContent = on.length; form.querySelector('[data-sel-sum]').textContent = fmt.rsPlain(total);
    form.querySelector('[data-sel-btn]').textContent = fmt.rs(total); form.querySelector('[data-approve]').disabled = !on.length;
    form.querySelector('[data-all]').checked = on.length === picks.length;
  };
  if (form) {
    on(form, 'change', '[data-all]', (_, b) => { form.querySelectorAll('[name=pick]').forEach((x) => { x.checked = b.checked; }); resum(); });
    on(form, 'change', '[name=pick]', resum);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ids = [...form.querySelectorAll('[name=pick]:checked')].map((x) => x.value);
      const total = [...form.querySelectorAll('[name=pick]:checked')].reduce((s, x) => s + Number(x.dataset.amt), 0);
      const pin = await askPin(t('po.approveTitle'), t('po.approveSub', { n: ids.length, v: fmt.rs(total) }));
      if (!pin) return;
      try {
        const r = await api.approvePayoutRun({ runId: form.dataset.run, payoutIds: ids, pin });
        toast(r.failCount ? t('po.doneWithFails', { ok: r.okCount, bad: r.failCount }) : t('po.done', { n: r.okCount, v: fmt.rs(r.sentPaise) }), r.failCount ? 'warn' : 'ok');
        navigate('/billing?tab=pay&r=' + Date.now());
      } catch (err) { toast(errorText(err), 'warn'); }
    });
  }
  on(el, 'click', '[data-make], [data-rebuild]', async () => {
    try { await api.createPayoutRun(); navigate('/billing?tab=pay&r=' + Date.now()); } catch (err) { toast(errorText(err), 'warn'); }
  });
  on(el, 'click', '[data-cancel-run]', async (_, b) => {
    if (!await confirmBox(t('po.cancelConfirm'), { danger: true, okText: t('po.cancelList') })) return;
    try { await api.cancelPayoutRun(b.dataset.cancelRun); navigate('/billing?tab=pay&r=' + Date.now()); } catch (err) { toast(errorText(err), 'warn'); }
  });
  bindRetry(el, () => navigate('/billing?tab=pay&r=' + Date.now()));
  pollWhileProcessing(el, d.sentToday.some((r) => r.processingCount), '/billing?tab=pay');
}

/** D-111: payouts waiting for the owner — farmer, how much milk money, deductions, net, what will be sent; ✓ / ✗ per farmer. */
export function waitingCard(list, { title = true } = {}) {
  const total = list.reduce((x, y) => x + y.creditPaise, 0);
  return html`<section class="card po-wait" data-wait>
    <div class="row po-head">${title ? html`<h2 style="margin:0">${icon('shield', 20)} ${t('po.waitTitle')} <span class="tag tag-warn">${list.length}</span></h2>` : ''}<span class="spacer"></span>
      <span class="small muted">${t('po.waitSub')}</span></div>
    <div class="table-wrap"><table class="tbl po-tbl"><thead><tr><th class="po-ck"><input type="checkbox" data-wall checked aria-label="${t('po.all')}"></th>
      <th>${t('common.code')}</th><th>${t('common.name')}</th><th>${t('po.method')}</th><th>${t('po.when')}</th>
      <th class="num">${t('po.bd.gross')}</th><th class="num">${t('po.bd.deduct')}</th><th class="num">${t('po.bd.net')}</th><th class="num">${t('po.bd.send')}</th><th></th></tr></thead>
      <tbody>${list.map((x) => html`<tr><td class="po-ck"><input type="checkbox" name="wpick" value="${x.id}" data-amt="${x.creditPaise}" checked aria-label="${x.name}"></td>
        <td><b>${x.code}</b>${x.date !== list[0].date ? html`<div class="small muted">${fmt.date(x.date)}</div>` : ''}</td><td>${x.name}${x.consent ? '' : html`<div class="small warn-text">${t('po.noConsent')}</div>`}</td>
        <td class="small">${x.method === 'bank' ? t('po.bank') + ' ' : ''}${x.destLabel || x.upiId}</td><td class="small">${prefText(x.pref)}</td>
        <td class="num">${fmt.rsPlain(x.breakdown?.grossPaise || 0)}</td><td class="num">${x.breakdown?.deductPaise ? '− ' + fmt.rsPlain(x.breakdown.deductPaise) : '0'}</td>
        <td class="num">${fmt.rsPlain(x.breakdown?.owedPaise || x.amountPaise)}</td><td class="num"><b>${fmt.rsPlain(x.creditPaise)}</b></td>
        <td class="nowrap"><button type="button" class="btn btn-sm btn-green" data-wok="${x.id}">${icon('check', 16)} ${t('po.approve1')}</button>
          <button type="button" class="btn btn-sm btn-ghost danger-text" data-wno="${x.id}">${t('po.reject1')}</button></td></tr>`)}</tbody>
      <tfoot><tr><td colspan="8">${t('po.selected')} <b data-wn>${list.length}</b></td><td class="num"><b data-wsum>${fmt.rsPlain(total)}</b></td><td></td></tr></tfoot></table></div>
    <div class="row po-actions"><span class="spacer"></span><button type="button" class="btn btn-green" data-wapprove>${icon('send', 18)} ${t('po.approveSel')} <span data-wbtn>${fmt.rs(total)}</span></button></div>
  </section>`;
}
export function bindWaiting(el, list, after) {
  const box = el.querySelector('[data-wait]'); if (!box) return;
  const picks = () => [...box.querySelectorAll('[name=wpick]')];
  const resum = () => {
    const on = picks().filter((x) => x.checked); const total = on.reduce((a, x) => a + Number(x.dataset.amt), 0);
    box.querySelector('[data-wn]').textContent = on.length; box.querySelector('[data-wsum]').textContent = fmt.rsPlain(total);
    box.querySelector('[data-wbtn]').textContent = fmt.rs(total); box.querySelector('[data-wapprove]').disabled = !on.length;
    box.querySelector('[data-wall]').checked = on.length === picks().length;
  };
  on(box, 'change', '[data-wall]', (_, b) => { picks().forEach((x) => { x.checked = b.checked; }); resum(); });
  on(box, 'change', '[name=wpick]', resum);
  const approve = async (ids) => {
    const total = list.filter((x) => ids.includes(x.id)).reduce((a, x) => a + x.creditPaise, 0);
    const pin = await askPin(t('po.approveTitle'), t('po.approveSub', { n: ids.length, v: fmt.rs(total) })); if (!pin) return;
    try { await api.approvePayouts({ payoutIds: ids, pin }); toast(t('po.approvedSent', { n: ids.length })); after(); } catch (err) { toast(errorText(err), 'warn'); }
  };
  on(box, 'click', '[data-wok]', (_, b) => approve([b.dataset.wok]));
  on(box, 'click', '[data-wapprove]', () => approve(picks().filter((x) => x.checked).map((x) => x.value)));
  on(box, 'click', '[data-wno]', async (_, b) => {
    const x = list.find((y) => y.id === b.dataset.wno);
    const reason = await modal(html`<form><div class="modal-head"><h2>${t('po.rejectTitle')}</h2><p class="muted" style="margin:4px 0 0">${x.code} · ${x.name} · ${fmt.rs(x.creditPaise)}</p></div>
      <div class="modal-body stack"><label class="field"><span>${t('po.rejectWhy')} *</span><input name="why" type="text" maxlength="200" required placeholder="${t('po.rejectPh')}"></label>
        <p class="small muted" style="margin:0">${t('po.rejectNote')}</p></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-danger">${t('po.reject1')}</button></div></form>`, (dlg, close) => {
      const f = dlg.querySelector('form'); f.addEventListener('submit', (e) => { e.preventDefault(); if (f.why.value.trim()) close(f.why.value.trim()); }); setTimeout(() => f.why.focus(), 50);
    });
    if (!reason) return;
    try { await api.rejectPayout({ payoutId: x.id, reason }); toast(t('po.rejectedSaved')); after(); } catch (err) { toast(errorText(err), 'warn'); }
  });
}

/** While the gateway has payouts 'processing', ask for webhook results every few seconds and refresh. */
export function pollWhileProcessing(el, active, path) {
  if (!active) return;
  const timer = setInterval(async () => {
    if (!el.isConnected) return clearInterval(timer);
    try { const r = await api.payoutPulse(); if (r.changed) { clearInterval(timer); navigate(path + (path.includes('?') ? '&' : '?') + 'r=' + Date.now()); } } catch { /* offline: try again */ }
  }, 2500);
}

export function itemsTable(items) {
  return html`<div class="table-wrap"><table class="tbl po-tbl"><thead><tr><th>${t('common.code')}</th><th>${t('common.name')}</th><th>${t('po.upi')}</th>
    <th>${t('po.periods')}</th><th class="num">${t('po.amount')}</th><th>${t('po.status')}</th><th>${t('po.ref')}</th></tr></thead>
    <tbody>${items.map((x) => html`<tr><td><b>${x.code}</b></td><td>${x.name}</td><td class="small">${x.method === 'bank' ? t('po.bank') + ' ' : ''}${x.destLabel || x.upiId}</td><td class="small nowrap">${periods(x.parts)}${x.breakdown ? html`<div class="muted">${t('po.bdLine', { g: fmt.rsPlain(x.breakdown.grossPaise), d: fmt.rsPlain(x.breakdown.deductPaise), n: fmt.rsPlain(x.breakdown.owedPaise) })}</div>` : ''}</td>
      <td class="num"><b>${fmt.rsPlain(x.creditPaise)}</b>${x.breakdown?.remainingPaise ? html`<div class="small muted">${t('po.leftN', { v: fmt.rsPlain(x.breakdown.remainingPaise) })}</div>` : ''}</td><td>${statusTag(x.status)}${x.reason ? html` <span class="small muted">${t('po.reason.' + x.reason)}</span>` : ''}</td>
      <td class="small">${x.ref || x.txnRef || ''}${['failed', 'reversed'].includes(x.status) ? html` <button type="button" class="btn btn-sm btn-ghost" data-retry="${x.id}">${t('po.retry')}</button>` : ''}</td></tr>`)}</tbody></table></div>`;
}

export function bindRetry(el, after) {
  on(el, 'click', '[data-retry]', async (_, b) => {
    const pin = await askPin(t('po.retryTitle')); if (!pin) return;
    try { const x = await api.retryPayout({ payoutId: b.dataset.retry, pin }); toast(x.status === 'success' ? t('po.retryOk') : t('po.retryBad'), x.status === 'success' ? 'ok' : 'warn'); after(); }
    catch (err) { toast(errorText(err), 'warn'); }
  });
}

// ---------------------------------------------------------------- UPI तपासणी व पसंती
async function renderFarmers(el, head) {
  const list = await api.payoutFarmers();
  // the check that matters is the one for the farmer's chosen method (UPI ID or bank account, D-110)
  const chk = (f) => (f.method === 'bank' ? f.bankCheck : f.check);
  const ok = (f) => (f.method === 'bank' ? f.bankVerified : f.verified);
  const n = (st) => list.filter((f) => (st === 'verified' ? ok(f) : chk(f).status === st && !ok(f))).length;
  const todo = list.filter((f) => f.hasDest && !ok(f) && ['none', 'failed', 'rejected'].includes(chk(f).status));
  const marked = list.filter((f) => f.approval).length;
  const prefCell = (f) => html`<div class="po-pref" data-pref="${f.id}">
    <select data-kind aria-label="${t('po.when')}">${KINDS.map((k) => html`<option value="${k}" ${f.pref.kind === k ? 'selected' : ''}>${t('po.pref.' + k)}</option>`)}</select>
    ${f.pref.kind === 'day' ? html`<select data-day aria-label="${t('po.dayOfMonth')}">${DAYS.map((d) => html`<option value="${d}" ${f.pref.day === d ? 'selected' : ''}>${t('po.dayN', { n: d })}</option>`)}</select>` : ''}</div>`;
  const destCell = (f) => html`<div class="po-dest"><select data-method="${f.id}" aria-label="${t('po.method')}">
      <option value="upi" ${f.method === 'upi' ? 'selected' : ''}>UPI</option><option value="bank" ${f.method === 'bank' ? 'selected' : ''}>${t('po.bankAcc')}</option></select>
    <span class="small">${f.method === 'bank' ? (f.bankAccount ? `XXXX${f.bankAccount.slice(-4)} · ${f.bankIfsc}` : t('po.noBank')) : (f.upiId || t('po.noUpi'))}</span></div>`;
  const checkCell = (f) => {
    const c = chk(f); const m = f.method;
    if (!f.hasDest) return html`<span class="small muted">${m === 'bank' ? t('po.noBank') : t('po.noUpi')}</span>`;
    if (ok(f)) return html`${checkTag('verified')} <span class="small">${c.bankName}</span> <button type="button" class="btn btn-sm btn-ghost" data-verify="${f.id}" data-m="${m}">${t('po.recheck')}</button>`;
    if (c.status === 'name-check') { const nm = namesMatch(c.bankName, f.nameEn); // D-118: the bank's English name vs ours
      return html`<div class="po-name"><span class="small muted">${t('po.bankName')}</span> <b>${c.bankName}</b>
      <span class="small muted">${t('po.ourName', { n: f.nameEn ? `${f.name} · ${f.nameEn}` : f.name })}</span>
      <span class="tag ${nm === 'match' ? 'tag-green' : nm === 'partial' ? 'tag-warn' : 'tag-danger'}">${t('po.nameAuto.' + nm)}</span>
      <div class="row"><button type="button" class="btn btn-sm btn-green" data-name-ok="${f.id}" data-m="${m}">${icon('check', 16)} ${t('po.nameOk')}</button>
        <button type="button" class="btn btn-sm btn-ghost danger-text" data-name-bad="${f.id}" data-m="${m}">${t('po.nameBad')}</button></div></div>`; }
    return html`${c.status !== 'none' ? html`${checkTag(c.status)} ${c.reason ? html`<span class="small muted">${t('po.reason.' + c.reason)}</span>` : ''}` : ''}
      <button type="button" class="btn btn-sm btn-primary" data-verify="${f.id}" data-m="${m}">${m === 'bank' ? t('po.verifyBank') : t('po.verify1')}</button>`;
  };
  mount(el, html`${head}
    <div class="stats po-stats">
      ${stat(t('po.chk.verified'), String(n('verified')), t('po.canBePaid'), 'good')}
      ${stat(t('po.chk.name-check'), String(n('name-check')), t('po.lookName'), n('name-check') ? 'warn' : '')}
      ${stat(t('po.notChecked'), String(list.filter((f) => f.hasDest && !ok(f) && chk(f).status === 'none').length), t('po.notCheckedSub'))}
      ${stat(t('po.needApproval'), String(marked), t('po.needApprovalSub'), marked ? 'warn' : '')}
    </div>
    <section class="card">
      <div class="row po-head"><h2 style="margin:0">${t('po.sub.farmers')}</h2><span class="spacer"></span>
        ${todo.length ? html`<button class="btn btn-primary" data-verify-all>${icon('check', 18)} ${t('po.verifyAll', { n: todo.length })}</button>` : ''}</div>
      <p class="small muted" style="margin:4px 0 6px">${t('po.verifyHow')}</p>
      <p class="small muted" style="margin:0 0 12px">${t('po.approvalHow')}
        <button type="button" class="btn btn-sm btn-ghost" data-appr-all="1">${t('po.apprAllOn')}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-appr-all="0">${t('po.apprAllOff')}</button></p>
      <div class="table-wrap"><table class="tbl po-tbl po-farmers"><thead><tr><th>${t('common.code')}</th><th>${t('common.name')}</th><th>${t('po.method')}</th><th>${t('po.check')}</th><th>${t('po.when')}</th><th>${t('po.needApproval')}</th></tr></thead>
        <tbody>${list.map((f) => html`<tr><td><b>${f.code}</b></td><td>${f.name}</td><td>${destCell(f)}</td><td>${checkCell(f)}</td><td>${prefCell(f)}</td>
          <td class="po-ck"><input type="checkbox" data-appr="${f.id}" ${f.approval ? 'checked' : ''} aria-label="${t('po.needApproval')} — ${f.name}"></td></tr>`)}</tbody></table></div>
    </section>`);
  const again = () => navigate('/billing?tab=upi&sub=farmers&r=' + Date.now());
  const verify = (f, m) => (m === 'bank' ? api.verifyBank(f.id) : api.verifyUpi(f.id));
  on(el, 'click', '[data-verify]', async (_, b) => {
    const f = list.find((x) => x.id === b.dataset.verify); const m = b.dataset.m;
    const where = m === 'bank' ? `XXXX${f.bankAccount.slice(-4)} (${f.bankIfsc})` : f.upiId;
    if (!await confirmBox(t('po.verifyConfirm', { n: f.name, u: where }), { okText: m === 'bank' ? t('po.verifyBank') : t('po.verify1') })) return;
    try { const c = await verify(f, m); toast(c.status === 'name-check' ? t('po.verifySent') : t('po.verifyFail'), c.status === 'name-check' ? 'ok' : 'warn'); again(); }
    catch (err) { toast(errorText(err), 'warn'); }
  });
  on(el, 'click', '[data-verify-all]', async () => {
    if (!await confirmBox(t('po.verifyAllConfirm', { n: todo.length, v: fmt.rs(todo.length * 100) }), { okText: t('po.verify1') })) return;
    let good = 0; for (const f of todo) { try { if ((await verify(f, f.method)).status === 'name-check') good++; } catch { /* shown in the table */ } }
    toast(t('po.verifyAllDone', { ok: good, n: todo.length })); again();
  });
  on(el, 'click', '[data-name-ok], [data-name-bad]', async (_, b) => {
    const yes = !!b.dataset.nameOk;
    try { await api.confirmUpiName({ farmerId: b.dataset.nameOk || b.dataset.nameBad, ok: yes, method: b.dataset.m }); toast(yes ? t('po.nameSaved') : t('po.nameRejected'), yes ? 'ok' : 'warn'); again(); }
    catch (err) { toast(errorText(err), 'warn'); }
  });
  on(el, 'change', '[data-method]', async (_, sel) => {
    try { await api.setPayMethod({ farmerId: sel.dataset.method, method: sel.value }); toast(t('po.prefSaved')); again(); } catch (err) { toast(errorText(err), 'warn'); }
  });
  on(el, 'change', '[data-appr]', async (_, box) => {
    try { await api.setPayApproval({ farmerIds: [box.dataset.appr], on: box.checked }); toast(box.checked ? t('po.apprOnSaved') : t('po.apprOffSaved')); }
    catch (err) { toast(errorText(err), 'warn'); box.checked = !box.checked; }
  });
  on(el, 'click', '[data-appr-all]', async (_, b) => {
    try { await api.setPayApproval({ farmerIds: list.map((f) => f.id), on: b.dataset.apprAll === '1' }); toast(t('po.prefSaved')); again(); } catch (err) { toast(errorText(err), 'warn'); }
  });
  on(el, 'change', '[data-pref] select', async (_, sel) => {
    const box = sel.closest('[data-pref]'); const kind = box.querySelector('[data-kind]').value;
    const day = Number(box.querySelector('[data-day]')?.value || 1);
    try { await api.setPayPref({ farmerId: box.dataset.pref, pref: kind === 'day' ? { kind, day } : { kind } }); toast(t('po.prefSaved')); again(); }
    catch (err) { toast(errorText(err), 'warn'); }
  });
}

// ---------------------------------------------------------------- इतिहास
async function renderHistory(el, head) {
  const [runs, checks] = await Promise.all([api.payoutRuns(), api.upiChecks()]);
  mount(el, html`${head}
    <section class="card"><h2>${t('po.runs')}</h2>
      ${runs.length ? runs.map((r) => html`<details class="po-run"><summary>
          <b>${fmt.date(r.date)}</b> <span class="small muted">${hm(r.sentAt || r.cancelledAt || r.createdAt)}</span>
          <span class="tag">${r.status === 'cancelled' ? t('po.st.cancelled') : t('po.mode.' + (r.mode === 'auto' ? 'eod' : r.mode))}</span>
          <span class="spacer"></span>${r.status === 'sent' ? html`<span class="tag tag-green">${t('po.okN', { n: r.okCount, v: fmt.rs(r.sentPaise) })}</span>${r.failCount ? html`<span class="tag tag-danger">${t('po.failN', { n: r.failCount })}</span>` : ''}` : ''}
        </summary>${itemsTable(r.items.filter((x) => !['skipped', 'cancelled'].includes(x.status)))}</details>`) : empty(t('po.noRuns'))}
    </section>
    <section class="card"><h2>${t('po.checks')}</h2>
      ${checks.length ? html`<div class="table-wrap"><table class="tbl po-tbl"><thead><tr><th>${t('common.date')}</th><th>${t('common.code')}</th><th>${t('common.name')}</th><th>${t('po.upi')}</th><th>${t('po.result')}</th><th>${t('po.ref')}</th></tr></thead>
        <tbody>${checks.map((x) => html`<tr><td class="nowrap">${fmt.date(x.date)}</td><td><b>${x.code}</b></td><td>${x.name}</td><td class="small">${x.upiId}</td>
          <td>${x.status === 'success' ? html`₹1 · <b>${x.bankName}</b>` : html`${statusTag('failed')} <span class="small muted">${t('po.reason.' + x.reason)}</span>`}</td><td class="small">${x.ref || ''}</td></tr>`)}</tbody></table></div>`
        : empty(t('po.noChecks'))}
    </section>`);
  bindRetry(el, () => navigate('/billing?tab=upi&sub=history&r=' + Date.now()));
}

// ---------------------------------------------------------------- सेटिंग्ज
async function renderSettings(el, head) {
  const c = await api.payoutSettings();
  mount(el, html`${head}
    <form class="card po-settings stack" novalidate>
      <h2 style="margin:0">${t('po.sub.settings')}</h2>
      <div class="field"><span>${t('po.modeQ')}</span>${seg('mode', [['off', t('po.mode.off')], ['immediate', t('po.mode.immediate')], ['approve', t('po.mode.approve')], ['eod', t('po.mode.eod')]], c.mode)}
        <p class="small muted" data-mode-help style="margin:6px 0 0"></p></div>
      <label class="check" data-eod-only><input type="checkbox" name="eodApproval" ${c.eodApproval ? 'checked' : ''}> ${t('po.eodApprovalQ')}</label>
      <p class="small muted" data-eod-only style="margin:-6px 0 0">${t('po.eodApprovalHint')}</p>
      <p class="small" data-eod-only style="margin:-4px 0 0">${t('po.markedN', { n: c.markedCount ?? 0 })} · <a href="#/billing?tab=upi&sub=farmers">${t('po.markedLink')} →</a></p>
      <fieldset class="po-fund"><legend>${t('po.fundingQ')}</legend>
        <p class="small muted" style="margin:0 0 8px">${t('po.fundingHelp')}</p>
        <div class="form-grid">
          <label class="field"><span>${t('po.fund.accountName')}</span><input name="fAccountName" type="text" value="${c.funding.accountName}"></label>
          <label class="field"><span>${t('farmers.bankName')}</span><input name="fBankName" type="text" value="${c.funding.bankName}"></label>
          <label class="field"><span>${t('farmers.bankAccount')}</span><input name="fAccountNo" inputmode="numeric" value="${c.funding.accountNo}"></label>
          <label class="field"><span>IFSC</span><input name="fIfsc" type="text" autocomplete="off" value="${c.funding.ifsc}"></label>
        </div>
        <p class="small" style="margin:6px 0 0">${t('po.fundBalance', { v: fmt.rs(c.availablePaise ?? c.simBalancePaise), h: fmt.rs(c.heldPaise || 0) })}</p>
      </fieldset>
      <div class="form-grid">
        <label class="field"><span>${t('po.timeQ')}</span><input name="time" type="time" value="${c.time}" required></label>
        <div class="field"><span>${t('po.lagQ')}</span>${seg('lagDays', [['1', t('po.lag1')], ['0', t('po.lag0')]], String(c.lagDays))}</div>
      </div>
      <div class="form-grid">
        <label class="field"><span>${t('po.minQ')}</span><input name="min" inputmode="decimal" value="${rupees(c.minPaise)}"></label>
        <label class="field"><span>${t('po.capFarmerQ')}</span><input name="capFarmer" inputmode="decimal" value="${c.perFarmerCapPaise ? rupees(c.perFarmerCapPaise) : ''}" placeholder="${t('po.noLimit')}"></label>
        <label class="field"><span>${t('po.capDayQ')}</span><input name="capDay" inputmode="decimal" value="${c.dailyCapPaise ? rupees(c.dailyCapPaise) : ''}" placeholder="${t('po.noLimit')}"></label>
        <label class="field"><span>${t('po.txnLimitQ')}</span><input name="txnLimit" inputmode="decimal" value="${c.perTxnLimitPaise ? rupees(c.perTxnLimitPaise) : ''}" placeholder="${t('po.noLimit')}"></label>
      </div>
      <div class="form-grid">
        <label class="field"><span>${t('po.feeQ')}</span><input name="fee" inputmode="decimal" value="${rupees(c.feePaise)}"></label>
        <div class="field"><span>${t('po.feeByQ')}</span>${seg('feeBy', [['center', t('po.feeBy.center')], ['farmer', t('po.feeBy.farmer')]], c.feeBy)}</div>
      </div>
      <label class="check"><input type="checkbox" name="farmerCanChoose" ${c.farmerCanChoose ? 'checked' : ''}> ${t('po.canChooseQ')}</label>
      <div class="field"><span>${t('po.gatewayQ')}</span><div class="po-gw"><b>${t('po.gw.sim')}</b><span class="small muted">${t('po.gwLater')}</span></div></div>
      <span class="err" role="alert"></span>
      <div class="row"><span class="spacer"></span><button class="btn btn-primary">${icon('check', 18)} ${t('common.save')}</button></div>
    </form>`);
  bindSeg(el);
  const f = el.querySelector('form');
  const help = () => { f.querySelector('[data-mode-help]').textContent = t('po.modeHelp.' + f.mode.value, { t: f.time.value }); f.querySelectorAll('[data-eod-only]').forEach((x) => { x.hidden = !['eod', 'immediate'].includes(f.mode.value); }); };
  f.addEventListener('change', help); f.time.addEventListener('input', help); help();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const money = (v) => (String(v).trim() ? toPaise(v) : 0);
    try {
      const unattended = f.mode.value === 'immediate' || (f.mode.value === 'eod' && !f.eodApproval.checked);
      if (unattended && !(c.mode === f.mode.value && c.eodApproval === f.eodApproval.checked) && !await confirmBox(t('po.autoConfirm', { t: f.time.value }), { okText: t('po.mode.' + f.mode.value) })) return;
      await api.savePayoutSettings({ mode: f.mode.value, eodApproval: f.eodApproval.checked, time: f.time.value, lagDays: Number(f.lagDays.value), minPaise: money(f.min.value),
        perFarmerCapPaise: money(f.capFarmer.value), dailyCapPaise: money(f.capDay.value), perTxnLimitPaise: money(f.txnLimit.value), feePaise: money(f.fee.value), feeBy: f.feeBy.value,
        farmerCanChoose: f.farmerCanChoose.checked,
        funding: { accountName: f.fAccountName.value.trim(), bankName: f.fBankName.value.trim(), accountNo: f.fAccountNo.value.replace(/\s/g, ''), ifsc: f.fIfsc.value.trim().toUpperCase() } });
      toast(t('common.saved')); navigate('/billing?tab=upi&sub=settings&r=' + Date.now());
    } catch (err) { f.querySelector('.err').textContent = errorText(err); }
  });
}
