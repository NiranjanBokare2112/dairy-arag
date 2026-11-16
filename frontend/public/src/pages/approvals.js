// बिल व पेमेंट → मंजुरी (D-114, D-127): changes waiting for the owner — farmers' details (D-108), milk entry corrections
// (A3.4) and expense changes (D-126). Money (payouts to approve, bills to pay) is in the पैसे देणे tab.
// Opened from the dashboard notices; the old #/approvals address forwards here.
import { api } from '../api/index.js';
import { html, mount, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { toast, errorText, empty } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { navigate } from '../core/router.js';
import { changeRows, byLine } from '../core/changes.js';
import { redirect } from '../core/backnav.js';
import { billTabs } from './billing.js';

export default {
  title: 'nav.billPay',
  roles: ['owner'],
  async render(el, ctx = {}) {
    if (!(ctx.query?.tab === 'approvals')) { redirect('/billing?tab=approvals'); return; } // old #/approvals links
    if (ctx.query.bill) { redirect('/billing?tab=pay&bill=' + ctx.query.bill); return; } // paying a bill is in पैसे देणे (D-127)
    const [list, farmersList, users, crs, expReqs, expCats] = await Promise.all([api.corrections(), api.farmers({ includeInactive: true }), api.users(), api.changeRequests(), api.expenseRequests(), api.expenseCategories()]);
    const crPending = crs.filter((r) => r.status === 'pending'); const crDone = crs.filter((r) => r.status !== 'pending').slice(0, 30);
    const farmers = new Map(farmersList.map((f) => [f.id, f]));
    const uname = (id) => users.find((u) => u.id === id)?.name || id;
    const pending = list.filter((c) => c.status === 'pending');
    const done = list.filter((c) => c.status !== 'pending').slice(0, 30);
    const change = (c) => (c.after.void ? html`<span class="tag tag-danger">${t('approvals.void')}</span>` : html`
      ${fmt.litres(c.before.litresX100)} → <b>${fmt.litres(c.after.litresX100)}</b> ${t('unit.l')},
      ${t('common.fat')} ${fmt.tenths(c.before.fatX10)} → <b>${fmt.tenths(c.after.fatX10)}</b>,
      ${t('common.snf')} ${fmt.tenths(c.before.snfX10)} → <b>${fmt.tenths(c.after.snfX10)}</b>`);
    const who = (c) => { const f = farmers.get(c.entry?.farmerId); return html`<b>${f?.code}</b> ${f?.name} · ${fmt.date(c.entry?.date)} ${fmt.shift(c.entry?.shift)}`; };

    mount(el, html`
      <div class="page-head"><h1>${t('nav.billPay')}</h1></div>${billTabs('approvals', {})}
      ${!crPending.length && !pending.length && !expReqs.length ? html`<div class="card">${empty(t('appr.nothing'))}</div>` : ''}
      <h2 class="appr-h">${t('cr.title')} <span class="tag ${crPending.length ? 'tag-warn' : ''}">${crPending.length}</span></h2>
      <section class="stack">${crPending.length ? crPending.map((r) => html`<div class="card cr-card">
        <div class="row-between"><div><a href="#/farmers/${r.entityId}"><b>${r.farmerCode}</b> ${r.farmerName}</a></div><span class="small muted">${byLine(r)} · ${fmt.dateTime(r.requestedAt)}</span></div>
        <table class="cr-tbl"><tbody>${changeRows(r.fields)}</tbody></table>
        ${r.fields.upiId ? html`<p class="small note note-warn" style="margin:8px 0 0">${t('cr.upiWarn')}</p>` : ''}
        ${r.note ? html`<p class="muted" style="margin:8px 0 0">${t('cr.reason')}: ${r.note}</p>` : ''}
        <div class="row" style="margin-top:10px"><button class="btn btn-green" data-cr-ok="${r.id}">${t('approvals.approve')}</button><button class="btn btn-ghost" data-cr-no="${r.id}">${t('approvals.reject')}</button></div></div>`)
        : html`<div class="card">${empty(t('cr.none'))}</div>`}</section>
      <h2 class="appr-h">${t('cr.corrTitle')} <span class="tag ${pending.length ? 'tag-warn' : ''}">${pending.length}</span></h2>
      <section class="stack">${pending.length ? pending.map((c) => html`<div class="card">
        <div class="row-between"><div>${who(c)}</div><span class="small muted">${uname(c.requestedBy)} · ${fmt.dateTime(c.requestedAt)}</span></div>
        <p style="margin:8px 0">${change(c)}</p><p class="muted">${t('collection.reason')}: ${c.reason}</p>
        <div class="row"><button class="btn btn-green" data-ok="${c.id}">${t('approvals.approve')}</button><button class="btn btn-ghost" data-no="${c.id}">${t('approvals.reject')}</button></div></div>`) : html`<div class="card">${empty(t('approvals.none'))}</div>`}</section>
      <h2 class="appr-h">${t('exp.apprTitle')} <span class="tag ${expReqs.length ? 'tag-warn' : ''}">${expReqs.length}</span></h2>
      <section class="stack">${expReqs.length ? expReqs.map((e) => { const cat = (id) => expCats.find((c) => c.id === id)?.name || id; const p = e.pending;
        const line = (k, a, b) => html`<tr><th>${t('exp.f.' + k)}</th><td>${a}</td><td>→ <b>${b}</b></td></tr>`;
        const show = (k, x) => (k === 'amountPaise' ? fmt.rs(x) : k === 'categoryId' ? cat(x) : k === 'date' ? fmt.date(x) : k === 'period' ? (x === 'month' ? t('exp.monthlyTag') : t('exp.once')) : k === 'mode' ? (x === 'upi' ? 'UPI' : x === 'bank' ? t('exp.bank') : t('payments.cash')) : k === 'photo' ? (x ? t('exp.photoNew') : t('exp.photoNone')) : x || '—');
        return html`<div class="card cr-card">
        <div class="row-between"><div><b>${cat(e.categoryId)}</b> · ${fmt.rs(e.amountPaise)} · ${fmt.date(e.date)}${e.note ? html` <span class="muted">· ${e.note}</span>` : ''}</div><span class="small muted">${uname(p.by)} · ${fmt.dateTime(p.at)}</span></div>
        ${p.kind === 'delete' ? html`<p style="margin:8px 0"><span class="tag tag-danger">${t('exp.reqDelete')}</span> ${t('cr.reason')}: ${p.note}</p>`
          : html`<table class="cr-tbl"><tbody>${Object.entries(p.changes).map(([k, x]) => line(k, show(k, e[k]), show(k, x)))}</tbody></table>${p.note ? html`<p class="muted" style="margin:8px 0 0">${t('cr.reason')}: ${p.note}</p>` : ''}`}
        <div class="row" style="margin-top:10px"><button class="btn btn-green" data-exp-ok="${e.id}">${t('approvals.approve')}</button><button class="btn btn-ghost" data-exp-no="${e.id}">${t('approvals.reject')}</button></div></div>`; })
        : html`<div class="card">${empty(t('exp.apprNone'))}</div>`}</section>
      ${done.length ? html`<section class="card" style="margin-top:16px"><h2>${t('approvals.history')}</h2><div class="table-wrap"><table class="tbl"><tbody>${done.map((c) => html`<tr>
        <td>${who(c)}</td><td>${change(c)}</td><td><span class="tag ${c.status === 'approved' ? 'tag-green' : 'tag-grey'}">${t('approvals.' + c.status)}</span></td><td class="small muted">${fmt.dateTime(c.decidedAt)}</td></tr>`)}</tbody></table></div></section>` : ''}
      ${crDone.length ? html`<section class="card" style="margin-top:16px"><h2>${t('cr.history')}</h2><div class="table-wrap"><table class="tbl"><tbody>${crDone.map((r) => html`<tr>
        <td><b>${r.farmerCode}</b> ${r.farmerName}<div class="small muted">${byLine(r)}</div></td><td><table class="cr-tbl"><tbody>${changeRows(r.fields)}</tbody></table></td>
        <td><span class="tag ${r.status === 'approved' ? 'tag-green' : 'tag-grey'}">${t('approvals.' + r.status)}</span></td><td class="small muted">${fmt.dateTime(r.decidedAt)}</td></tr>`)}</tbody></table></div></section>` : ''}`);

    const again = () => navigate('/billing?tab=approvals&r=' + Date.now());

    const decide = async (id, ok) => { try { await api.decideCorrection(id, ok); toast(ok ? t('approvals.approved') : t('approvals.rejected')); again(); } catch (e) { toast(errorText(e), 'err'); } };
    on(el, 'click', '[data-ok]', (_, b) => decide(b.dataset.ok, true));
    on(el, 'click', '[data-no]', (_, b) => decide(b.dataset.no, false));
    const decideCr = async (id, ok) => { try { await api.decideChange(id, ok); toast(ok ? t('approvals.approved') : t('approvals.rejected')); again(); } catch (e) { toast(errorText(e), 'err'); } };
    on(el, 'click', '[data-cr-ok]', (_, b) => decideCr(b.dataset.crOk, true));
    on(el, 'click', '[data-cr-no]', (_, b) => decideCr(b.dataset.crNo, false));
    const decideExp = async (id, ok) => { try { await api.decideExpense({ id, ok }); toast(ok ? t('approvals.approved') : t('approvals.rejected')); again(); } catch (e) { toast(errorText(e), 'err'); } };
    on(el, 'click', '[data-exp-ok]', (_, b) => decideExp(b.dataset.expOk, true));
    on(el, 'click', '[data-exp-no]', (_, b) => decideExp(b.dataset.expNo, false));
  },
};
