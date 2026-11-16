// Farmer profile (owner & operator) + create (owner & operator, D-69) / edit (owner; an operator's edit is sent to the owner for approval, D-108).
// The form also holds when the farmer wants their money (D-107) and shows the UPI ID check.
// Existing farmer: header, date filter (default last 30 days; D-56), performance (milk, weekly/daily average, Fat/SNF, rate, paid,
// profit for the owner), daily chart, bills in place (current cycle so far + last 7 bills with litres,
// avg Fat, bill total and payment status — the printable bill opens only from its own button),
// balances, message log, and the edit form in a collapsible section.
import { api } from '../api/index.js';
import { html, mount, $, formData } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { toast, errorText, stat, empty, waTag, channelTag } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { navigate } from '../core/router.js';
import { dailyChart, bindDailyChart } from '../core/dailychart.js';
import { infoTip, bindInfoTips } from '../core/qualitychart.js';
import { rangeOf, filterCard, bindRangeBar } from '../core/rangebar.js';
import { pager, pgAttrs, bindPagers } from '../core/pager.js';
import { changeRows, byLine } from '../core/changes.js';
import { toMarathi, toEnglish, hasLatin, hasDevanagari, marathiChoices } from '../lib/translit.js';

const BILLS_PER_PAGE = 7, MSGS_PER_PAGE = 10;
import { todayIST } from '../lib/dates.js';

const NEW_FARMER = { name: '', village: 'आरग', mobile: '', hasWhatsapp: true, consent: false, milkTypes: ['cow'], upiId: '', bankName: '', bankAccount: '', bankIfsc: '', aadhaarLast4: '', active: true, payPref: { kind: 'bill', day: null } };
const PAY_KINDS = ['daily', 'bill', 'day', 'month-end', 'approval'];
const checkTone = { verified: 'tag-green', 'name-check': 'tag-warn', failed: 'tag-danger', rejected: 'tag-danger' };
const shortRange = (a, b) => `${fmt.date(a).slice(0, 5)} – ${fmt.date(b).slice(0, 5)}`;
const pct = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);

function billStatus(b) {
  if (b.status === 'draft') return html`<span class="tag tag-warn">${t('billing.draft')}</span>`;
  if (b.payablePaise === 0) return html`<span class="tag tag-grey">${t('farmers.nothingDue')}</span>`;
  if (b.paidPaise >= b.payablePaise) return html`<span class="tag tag-green">${t('payments.paid')}</span>${b.lastPayment ? html`<div class="small muted">${fmt.date(b.lastPayment.date)} · ${b.lastPayment.mode === 'upi' ? 'UPI' : t('payments.cash')}</div>` : ''}`;
  if (b.paidPaise > 0) return html`<span class="tag tag-warn">${t('farmers.partPaid', { amt: fmt.rsPlain(b.payablePaise - b.paidPaise) })}</span>`;
  return html`<span class="tag tag-danger">${t('payments.unpaid')}</span>`;
}

function editForm(f, { isNew, ro, isOwner = true }) {
  const ask = !isOwner && !isNew; // operator editing an existing farmer: becomes a request (D-108)
  const pref = f.payPref || { kind: 'bill', day: null };
  const chk = f.upiCheck?.status || 'none';
  return html`<form class="${isNew ? 'card' : ''}" novalidate data-farmer-form>
    ${ask ? html`<p class="note" style="margin:0 0 12px">${t('cr.operatorNote')}</p>` : ''}
    <fieldset ${ro ? 'disabled' : ''} style="border:0;padding:0;margin:0">
    <div class="form-grid">
      <label class="field"><span>${t('common.code')} *</span><input name="code" inputmode="numeric" value="${f.code}" required class="${isNew || ask ? 'locked' : ''}" ${isNew || ask ? 'readonly' : ''}>
        ${isNew ? html`<span class="hint">${t('farmers.codeAuto')}</span>` : ''}</label>
      <label class="field"><span>${t('farmers.nameMr')} *</span><input name="name" type="text" value="${f.name}" required lang="mr" autocomplete="off" placeholder="${t('farmers.nameMrPh')}">
        <span class="hint" data-hint-mr>${t('farmers.nameMrHint')}</span><span class="name-choices" data-name-choices hidden></span></label>
      <label class="field"><span>${t('farmers.nameEn')}</span><input name="nameEn" type="text" value="${f.nameEn || ''}" data-auto="${f.nameEnAuto ? '1' : '0'}" lang="en" autocomplete="off" placeholder="${t('farmers.nameEnPh')}">
        <span class="hint" data-hint-en>${f.nameEnAuto && f.nameEn ? t('farmers.nameEnCheck') : t('farmers.nameEnHint')}</span></label>
      <label class="field"><span>${t('farmers.aadhaar')}${isNew ? ' *' : ''}</span>
        <input name="aadhaar" inputmode="numeric" maxlength="14" autocomplete="off" ${isNew ? 'required' : ''} ${ask ? 'readonly class="locked"' : ''} placeholder="${f.aadhaarLast4 ? 'XXXX XXXX ' + f.aadhaarLast4 : 'XXXX XXXX XXXX'}">
        <span class="hint">${ask ? t('cr.aadhaarOwner') : isNew ? t('farmers.aadhaarNew') : f.aadhaarLast4 ? t('farmers.aadhaarHint') : t('farmers.aadhaarMissing')}</span></label>
      <label class="field"><span>${t('farmers.village')}</span><input name="village" type="text" value="${f.village}"></label>
      <label class="field"><span>${t('farmers.mobile')}</span><input name="mobile" type="tel" inputmode="tel" maxlength="10" value="${f.mobile}"></label>
      <label class="field"><span>${t('farmers.upi')}</span><input name="upiId" type="text" value="${f.upiId}" placeholder="name@upi">
        ${isNew ? '' : html`<span class="hint"><span class="tag ${checkTone[chk] || 'tag-grey'}">${t('po.chk.' + chk)}</span>${chk === 'verified' && f.upiCheck.bankName ? ' ' + f.upiCheck.bankName : ''}
          ${isOwner ? html` · <a href="#/billing?tab=upi&sub=farmers">${t('cr.upiCheckLink')}</a>` : ''}</span>`}</label>
    </div>
    <div class="form-grid ff-pay">
      <label class="field"><span>${t('po.method')}</span><select name="payMethod">
        <option value="upi" ${(f.payMethod || 'upi') === 'upi' ? 'selected' : ''}>UPI</option><option value="bank" ${f.payMethod === 'bank' ? 'selected' : ''}>${t('po.bankAcc')}</option></select></label>
      <label class="field"><span>${t('po.when')}</span><select name="payKind" data-pay-kind>${PAY_KINDS.map((k) => html`<option value="${k}" ${pref.kind === k ? 'selected' : ''}>${t('po.pref.' + k)}</option>`)}</select>
        <span class="hint" data-pay-hint ${pref.kind === 'approval' ? '' : 'hidden'}>${t('po.pref.approvalHint')}</span></label>
      <label class="field" data-pay-day ${pref.kind === 'day' ? '' : 'hidden'}><span>${t('po.dayOfMonth')}</span><select name="payDay">${Array.from({ length: 28 }, (_, i) => i + 1).map((n) => html`<option value="${n}" ${pref.day === n ? 'selected' : ''}>${t('po.dayN', { n })}</option>`)}</select></label>
    </div>
    <div class="row" style="margin-top:12px">
      <span class="field"><span>${t('common.milk')} *</span></span>
      ${['cow', 'buffalo'].map((m) => html`<label class="check"><input type="checkbox" name="milkTypes" data-multi="1" value="${m}" ${f.milkTypes.includes(m) ? 'checked' : ''}> ${fmt.milk(m)}</label>`)}
    </div>
    <div class="row">
      <label class="check"><input type="checkbox" name="hasWhatsapp" ${f.hasWhatsapp ? 'checked' : ''}> ${t('farmers.hasWhatsapp')}</label>
      <label class="check"><input type="checkbox" name="consent" ${f.consent ? 'checked' : ''}> ${t('farmers.consent')}</label>
      <label class="check"><input type="checkbox" name="active" ${f.active ? 'checked' : ''}> ${t('farmers.active')}</label>
    </div>
    <h3 class="form-sub">${t('farmers.bankOptional')}</h3>
    <div class="form-grid">
      <label class="field"><span>${t('farmers.bankName')}</span><input name="bankName" type="text" value="${f.bankName}"></label>
      <label class="field"><span>${t('farmers.bankAccount')}</span><input name="bankAccount" inputmode="numeric" value="${f.bankAccount}"></label>
      <label class="field"><span>IFSC</span><input name="bankIfsc" type="text" value="${f.bankIfsc}"></label>
    </div>
    ${isOwner ? html`<label class="check" style="margin-top:12px"><input type="checkbox" name="dedConsent" ${f.deductionConsent ? 'checked' : ''}> ${t('po.consentQ')}
      ${f.deductionConsent ? html`<span class="small muted">(${fmt.date(f.deductionConsent.at.slice(0, 10))})</span>` : ''}</label>` : ''}
    ${ask ? html`<label class="field" style="margin-top:12px"><span>${t('cr.why')}</span><input name="changeNote" type="text" maxlength="300" placeholder="${t('cr.whyPh')}"></label>` : ''}
    </fieldset>
    <span class="err" role="alert"></span>
    ${ro ? '' : html`<div class="actions"><button class="btn btn-primary btn-xl">${ask ? t('cr.sendForApproval') : t('common.save')}</button></div>`}
  </form>`;
}

export default {
  title: 'nav.farmers',
  roles: ['owner', 'operator'],
  async render(el, { params, user, query = {} }) {
    const isNew = !params.id;
    const isOwner = user.role === 'owner';
    const ro = false; // D-108: an operator may edit too — the change waits for the owner's approval

    if (isNew) {
      const f = { ...NEW_FARMER, code: await api.nextFarmerCode() };
      mount(el, html`<div class="page-head"><h1>${t('farmers.add')}</h1><a class="btn btn-ghost" data-back href="#/farmers">${t('common.back')}</a></div>${editForm(f, { isNew, ro, isOwner })}`);
    } else {
      // date filter (D-56): figures, chart and bills follow it; balances are always "as of now"
      const today = todayIST();
      const range = rangeOf(query, today, '30');
      const [f, ins, msgs] = await Promise.all([api.farmer(params.id), api.farmerInsights(params.id, { from: range.from, to: range.to }), api.outbox({ farmerId: params.id, ...(range.all ? {} : { from: range.from, to: range.to }) })]);
      msgs.sort((a, x) => (a.date === x.date ? (a.createdAt < x.createdAt ? 1 : -1) : a.date < x.date ? 1 : -1)); // newest day first
      const L = (key, info) => html`<span class="label-info">${t(key)} ${infoTip(t(info))}</span>`;
      const b = f.balances;
      const change = pct(ins.litresX100, ins.prevLitresX100);
      const p = ins.profit;
      mount(el, html`
        <div class="page-head">
          <div class="farmer-head">
            <div class="avatar big" aria-hidden="true">${f.name.trim().charAt(0)}</div>
            <div><h1 style="margin:0">${f.name}</h1>
              <div class="row small" style="gap:8px;margin-top:4px">
                <span class="tag">${t('common.code')} ${f.code}</span><span class="muted">${f.village}</span>
                ${f.milkTypes.map((m) => html`<span class="tag ${m === 'cow' ? 'tag-cow' : 'tag-buf'}">${fmt.milk(m)}</span>`)}
                ${f.active ? '' : html`<span class="tag tag-grey">${t('farmers.inactive')}</span>`}
                ${f.mobile ? html`<a class="muted" href="tel:+91${f.mobile}">${icon('phone', 14)} ${isOwner ? f.mobile : fmt.maskMobile(f.mobile)}</a>` : ''}
                ${!f.consent ? html`<span class="tag tag-grey">${t('farmers.noConsent')}</span>` : f.hasWhatsapp ? waTag() : html`<span class="tag tag-warn">SMS</span>`}
              </div></div>
          </div>
          <a class="btn btn-ghost" data-back href="#/farmers">${icon('back')} ${t('common.back')}</a>
        </div>

        ${filterCard('/farmers/' + params.id, query, range, {}, { note: range.all ? t('farmers.sinceFirst', { d: fmt.date(ins.from), n: ins.days }) : '' })}
        <div class="stats" style="margin-bottom:12px">
          ${stat(L('farmers.totalMilk', 'farmers.info.total'), `${fmt.litres(ins.litresX100)} ${t('unit.l')}`, change == null ? t('farmers.daysPoured', { n: ins.milkDays, d: ins.days }) : t('farmers.vsPrev', { p: (change > 0 ? '+' : '') + change }), 'blue')}
          ${stat(L('farmers.weeklyAvg', 'farmers.info.weekly'), `${fmt.litres(ins.weeklyAvgX100)} ${t('unit.l')}`, t('farmers.dailyAvg', { l: fmt.litres(ins.avgPerDayX100) }))}
          ${stat(L('dash.avgQuality', 'farmers.info.quality'), `${fmt.hundredths(ins.avgFatX100)} / ${fmt.hundredths(ins.avgSnfX100)}`, t('farmers.avgRate', { r: fmt.rs(ins.avgRatePaise) }))}
          ${stat(L('farmers.paidToFarmer', 'farmers.info.paid'), fmt.rs(ins.amountPaise), t('farmers.daysPoured', { n: ins.milkDays, d: ins.days }))}
          ${p ? stat(L('farmers.profit', 'farmers.info.profit'), fmt.rs(p.profitPaise), p.coveredX100 ? t('farmers.perLitre', { r: fmt.rs(p.perLitrePaise) }) : t('farmers.noDispatchYet'), p.profitPaise >= 0 ? 'good' : 'warn') : ''}
        </div>
        <div class="split-row small muted" style="margin-bottom:16px">
          <span>${t('shift.morning')} <b>${fmt.litres(ins.morningX100)}</b> · ${t('shift.evening')} <b>${fmt.litres(ins.eveningX100)}</b> ${t('unit.l')}</span>
          ${ins.cowX100 && ins.buffaloX100 ? html`<span>${t('milk.cow')} <b>${fmt.litres(ins.cowX100)}</b> · ${t('milk.buffalo')} <b>${fmt.litres(ins.buffaloX100)}</b> ${t('unit.l')}</span>` : ''}
          <span>${t('farmers.lastPour')}: <b>${ins.lastEntry ? fmt.date(ins.lastEntry) : '—'}</b></span>
          ${p && p.coveredX100 && p.coveredX100 < ins.litresX100 ? html`<span>${t('farmers.profitNote')}</span>` : ''}
        </div>

        <div class="grid-2">
          <section class="card"><h2 class="title-info">${t('dash.dailyLitres')} ${infoTip(t('dash.info.daily'))}</h2>${dailyChart(ins.trend, { today: ins.to })}
            <h3 class="dash-sub title-info" style="margin:16px 0 8px">${t('dash.balancesNow')} ${infoTip(t('farmers.info.balances'))}</h3>
            <div class="stats bal-stats">
              ${stat(L('farmers.advanceDue', 'farmers.info.advance'), fmt.rs(b.advanceOutstandingPaise), b.advanceInstallmentPaise ? t('farmers.perCycle', { amt: fmt.rs(b.advanceInstallmentPaise) }) : '', b.advanceOutstandingPaise ? 'warn' : '')}
              ${stat(L('farmers.feedUnbilled', 'farmers.info.feed'), fmt.rs(b.feedUnbilledPaise))}
              ${stat(L('farmers.dues', 'farmers.info.dues'), fmt.rs(b.duesPaise), '', b.duesPaise ? 'warn' : '')}
              ${stat(L('farmers.unpaid', 'farmers.info.unpaid'), fmt.rs(b.unpaidPaise), '', b.unpaidPaise ? 'warn' : 'good')}
            </div></section>
          <section class="card"><h2 class="title-info">${t('farmers.bills')} ${infoTip(t('farmers.billsNote'))}</h2>
            ${ins.openCycle || ins.bills.length ? html`<div class="table-wrap" data-pg-list="bills"><table class="tbl bills-mini">
              <thead><tr><th>${t('billing.period')}</th><th class="num">${t('unit.l')}</th><th class="num">${t('farmers.fatShort')}</th><th class="num">${t('farmers.billTotal')}</th><th>${t('common.status')}</th><th></th></tr></thead>
              <tbody>
                ${ins.openCycle ? html`<tr class="open-cycle"><td class="nowrap"><b>${shortRange(ins.openCycle.start, ins.openCycle.end)}</b><div class="small muted">${t('farmers.currentCycle')}</div></td>
                  <td class="num">${fmt.litres(ins.openCycle.litresX100)}</td><td class="num">${ins.openCycle.avgFatX100 ? fmt.hundredths(ins.openCycle.avgFatX100) : '—'}</td>
                  <td class="num">${fmt.rsPlain(ins.openCycle.amountPaise)}<div class="small muted">${t('farmers.milkSoFar')}</div></td><td><span class="tag">${t('farmers.notBilled')}</span></td><td></td></tr>` : ''}
                ${ins.bills.map((x, i) => html`<tr ${pgAttrs(i, BILLS_PER_PAGE)}><td class="nowrap"><b>${shortRange(x.start, x.end)}</b><div class="small muted">${fmt.date(x.start).slice(6)}</div></td>
                  <td class="num">${fmt.litres(x.litresX100)}</td><td class="num">${fmt.hundredths(x.avgFatX100)}</td>
                  <td class="num"><b>${fmt.rsPlain(x.payablePaise)}</b>${x.totalDeductPaise ? html`<div class="small muted">${t('farmers.afterDeduct', { g: fmt.rsPlain(x.grossPaise) })}</div>` : ''}</td>
                  <td>${billStatus(x)}</td>
                  <td><a class="btn btn-sm btn-ghost" href="#/bill/${x.id}" title="${t('farmers.openBill')}">${icon('bill', 16)}<span class="sr-only">${t('farmers.openBill')}</span></a></td></tr>`)}
              </tbody></table></div>${pager('bills', ins.bills.length, BILLS_PER_PAGE)}` : empty(t('billing.none'))}
          </section>
        </div>

        <div class="grid-2" style="margin-top:16px">
          <section class="card" id="farmer-edit"><h2>${t('farmers.editDetails')}</h2>
            ${f.pendingChanges?.length ? f.pendingChanges.map((r) => html`<div class="cr-box">
              <div class="row"><b>${t('cr.pendingTitle')}</b><span class="small muted">${byLine({ ...r, byName: r.requestedByKind === 'farmer' ? f.name : (r.requestedBy === user.id ? user.name : t('cr.operator')) })} · ${fmt.dateTime(r.requestedAt)}</span></div>
              <table class="cr-tbl"><tbody>${changeRows(r.fields)}</tbody></table>${r.note ? html`<p class="small muted" style="margin:4px 0 0">${t('cr.reason')}: ${r.note}</p>` : ''}
              ${isOwner ? html`<div class="row"><button type="button" class="btn btn-sm btn-green" data-cr-ok="${r.id}">${t('approvals.approve')}</button><button type="button" class="btn btn-sm btn-ghost" data-cr-no="${r.id}">${t('approvals.reject')}</button></div>` : html`<p class="small" style="margin:4px 0 0">${t('cr.waitOwner')}</p>`}
            </div>`) : ''}
            ${editForm(f, { isNew, ro, isOwner })}</section>
          <section class="card"><h2 class="title-info">${t('messages.log')} ${infoTip(t('farmers.info.msgs'))}</h2>
            <p class="small muted" style="margin:-4px 0 8px">${t('farmers.msgsFor', { n: msgs.length })}</p>
            ${msgs.length ? html`<div class="table-wrap" data-pg-list="msgs"><table class="tbl"><thead><tr><th>${t('common.date')}</th><th>${t('messages.kind')}</th><th>${t('messages.channel')}</th><th>${t('common.status')}</th></tr></thead>
            <tbody>${msgs.map((m, i) => html`<tr ${pgAttrs(i, MSGS_PER_PAGE)}><td class="nowrap"><b>${fmt.date(m.date || m.createdAt.slice(0, 10))}</b><div class="small muted">${fmt.dateTime(m.sentAt || m.createdAt).slice(11)}</div></td>
              <td>${t('messages.kind.' + m.kind)}</td><td>${channelTag(m.channel)}</td>
              <td><span class="tag ${m.status === 'sent' ? 'tag-green' : m.status === 'failed' ? 'tag-danger' : 'tag-warn'}">${t('messages.status.' + m.status)}</span></td></tr>`)}</tbody></table></div>
            ${pager('msgs', msgs.length, MSGS_PER_PAGE)}` : empty(t('messages.none'))}</section>
        </div>`);
      bindDailyChart(el); bindInfoTips(el); bindRangeBar(el, '/farmers/' + params.id, query, range, today); bindPagers(el);
    }

    const form = $('[data-farmer-form]', el);
    form?.querySelector('[data-pay-kind]')?.addEventListener('change', (e) => { form.querySelector('[data-pay-day]').hidden = e.target.value !== 'day'; form.querySelector('[data-pay-hint]').hidden = e.target.value !== 'approval'; });
    if (form) bindNames(form, await api.nameWords().catch(() => ({})));
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-cr-ok], [data-cr-no]'); if (!b) return;
      try { await api.decideChange(b.dataset.crOk || b.dataset.crNo, !!b.dataset.crOk); toast(b.dataset.crOk ? t('approvals.approved') : t('approvals.rejected')); navigate('/farmers/' + params.id + '?r=' + Date.now()); }
      catch (err) { toast(errorText(err), 'warn'); }
    });
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(form);
      const payPref = d.payKind === 'day' ? { kind: 'day', day: Number(d.payDay) } : { kind: d.payKind || 'bill' };
      const { payKind, payDay, dedConsent, ...rest } = d;
      try {
        const saved = await api.saveFarmer({ ...rest, payPref, id: params.id, milkTypes: d.milkTypes || [], aadhaar: isOwner || isNew ? String(d.aadhaar || '').replace(/[\s-]/g, '') : undefined });
        if (saved.pendingRequest) { toast(t('cr.sent')); navigate('/farmers/' + saved.id + '?r=' + Date.now()); return; }
        // D-110: the farmer's consent to deductions (owner only, recorded with date and who)
        if (isOwner && !!dedConsent !== !!(isNew ? false : saved.deductionConsent)) await api.setDeductionConsent({ farmerId: saved.id, consent: !!dedConsent });
        toast(t('common.saved'));
        // a new farmer replaces the empty form in history, so Back goes to the list, not to a blank form (D-63)
        if (isNew) location.replace('#/farmers/' + saved.id); else navigate('/farmers/' + saved.id);
      } catch (err) {
        // another phone took this code a moment ago (shared data): give the next free code and ask to save again
        if (isNew && err.code === 'duplicate-code') {
          const next = await api.nextFarmerCode(); form.code.value = next;
          $('.err', form).textContent = t('farmers.codeTaken', { n: next }); return;
        }
        $('.err', form).textContent = errorText(err);
      }
    });
  },
};

/**
 * D-118: two name boxes that fill each other. Type the name in English → the Marathi box gets a suggestion; type it in
 * Marathi → the English box is filled. English letters typed in the Marathi box are moved to the English box (on leaving
 * the box). A box the person has typed in is theirs — it is not overwritten. The village becomes Marathi the same way.
 */
function bindNames(form, learned) {
  const mr = form.name; const en = form.nameEn; if (!mr || !en) return;
  let mrOwn = !!mr.value.trim(); let enOwn = !!en.value.trim() && en.dataset.auto !== '1'; // an English name filled in automatically may still be refreshed
  const hintMr = form.querySelector('[data-hint-mr]'); const hintEn = form.querySelector('[data-hint-en]');
  // D-120: when a word could be spelt more than one way, show the choices under the Marathi box; one tap picks (and is learned on save)
  const box = form.querySelector('[data-name-choices]');
  const showChoices = (english) => {
    const words = mr.value.split(' ');
    const list = marathiChoices(english, learned).map((c, i) => ({ ...c, i })).filter((c) => !c.known && c.options.length > 1 && words[c.i]); // a name in the word list is certain — no choices
    box.hidden = !list.length;
    box.innerHTML = list.length ? `<span class="nc-q">${t('farmers.nameChoose')}</span>` + list.map((c) => c.options.map((o) =>
      `<button type="button" class="nc${words[c.i] === o ? ' on' : ''}" data-i="${c.i}" data-v="${o}" aria-pressed="${words[c.i] === o}">${o}</button>`).join('')).join('<span class="nc-sep"></span>') : '';
  };
  box?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    const words = mr.value.split(' '); words[+b.dataset.i] = b.dataset.v; mr.value = words.join(' '); mrOwn = true;
    box.querySelectorAll(`button[data-i="${b.dataset.i}"]`).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
  });
  const suggestMr = () => { if (mrOwn) return; mr.value = toMarathi(en.value, learned); hintMr.textContent = mr.value ? t('farmers.nameSuggested') : t('farmers.nameMrHint'); hintMr.classList.toggle('sugg', !!mr.value); showChoices(en.value); };
  const suggestEn = () => { if (enOwn) return; en.value = toEnglish(mr.value); hintEn.textContent = en.value ? t('farmers.nameSuggested') : t('farmers.nameEnHint'); hintEn.classList.toggle('sugg', !!en.value); };
  en.addEventListener('input', () => { enOwn = !!en.value.trim(); hintEn.classList.remove('sugg'); hintEn.textContent = t('farmers.nameEnHint'); suggestMr(); });
  mr.addEventListener('input', () => {
    if (hasLatin(mr.value) && !hasDevanagari(mr.value)) return; // typing English here: handled when leaving the box
    mrOwn = !!mr.value.trim(); hintMr.classList.remove('sugg'); hintMr.textContent = t('farmers.nameMrHint'); if (box) box.hidden = true; suggestEn();
  });
  mr.addEventListener('blur', () => {
    if (!hasLatin(mr.value)) return;
    const typed = mr.value.trim();
    if (!enOwn || !en.value.trim()) { en.value = typed.replace(/\b\w/g, (c) => c.toUpperCase()); enOwn = false; } // follows the Marathi box if it is retyped
    mr.value = toMarathi(typed, learned); mrOwn = false; hintMr.textContent = t('farmers.nameSuggested'); hintMr.classList.add('sugg'); showChoices(typed);
  });
  const village = form.village;
  village?.addEventListener('blur', () => { if (hasLatin(village.value) && !hasDevanagari(village.value)) village.value = toMarathi(village.value.trim(), learned); });
}
