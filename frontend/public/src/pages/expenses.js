// खर्च — centre expenses (D-126). Owner and operator add; an operator's change / delete waits for the owner (मंजुरी).
//   #/expenses                 list for a date range + add form, totals by category, reminders for monthly costs
//   #/expenses?e=<id>          edit one (owner: saved at once; operator: sent for approval)
//   #/expenses?copy=<id>       add form filled from an older entry (this month's rent / salary…)
import { api } from '../api/index.js';
import { html, mount, $, on, download } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { toast, errorText, empty, stat, seg, bindSeg, modal } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { toPaise, formatRupees } from '../lib/money.js';
import { todayIST } from '../lib/dates.js';
import { uuid } from '../lib/uuid.js';
import { navigate } from '../core/router.js';
import { dateField, bindDateFields } from '../core/datepicker.js';
import { rangeOf, filterCard, bindRangeBar } from '../core/rangebar.js';
import { pager, pgAttrs, bindPagers } from '../core/pager.js';
import { shrinkImage } from '../core/image.js';

const PER_PAGE = 6; // खर्चाची यादी: 6 a page (D-128)

const PATH = '/expenses';

export default {
  title: 'nav.expenses',
  roles: ['owner', 'operator'],
  async render(el, { query, user }) {
    const owner = user.role === 'owner';
    const today = todayIST();
    const range = rangeOf(query, today, 'today'); // D-132: opens on today's expenses
    const [cats, list, sum, users] = await Promise.all([api.expenseCategories(), api.expenses({ from: range.from, to: range.to }),
      api.expenseSummary({ from: range.from, to: range.to }), owner ? api.users() : Promise.resolve([])]);
    const catName = (id) => cats.find((c) => c.id === id)?.name || '—';
    const uname = (id) => users.find((u) => u.id === id)?.name || '';
    const all = query.e || query.copy ? await api.expenses() : list;
    const ed = query.e ? all.find((x) => x.id === query.e) : null;
    const src = ed || (query.copy ? all.find((x) => x.id === query.copy) : null);
    const live = cats.filter((c) => c.active || c.id === src?.categoryId);
    const v = { date: ed ? ed.date : today, categoryId: src?.categoryId || '', amount: src ? formatRupees(src.amountPaise).replace(/,/g, '') : '',
      mode: src?.mode || 'cash', period: src ? src.period : 'once', note: src?.note || '', photo: ed?.photo || '' };
    const auto = sum.auto;
    // after saving / deleting, come back to the same days (आज, ७ दिवस, a month…)
    const keepRange = query.from ? `?from=${query.from}&to=${query.to}` : query.range ? `?range=${query.range}` : '';
    // D-128: this page shows the expenses ENTERED on the chosen days (a monthly one on its own date) — totals from the list
    const total = list.reduce((a, e) => a + e.amountPaise, 0);
    const byCategory = [...list.reduce((m, e) => { const x = m.get(e.categoryId) || { categoryId: e.categoryId, paise: 0, count: 0 }; x.paise += e.amountPaise; x.count += 1; return m.set(e.categoryId, x); }, new Map()).values()]
      .sort((a, b) => b.paise - a.paise);

    const form = html`<form class="card stack exp-form" data-exp novalidate>
      <h2>${ed ? t('exp.edit') : t('exp.add')}</h2>
      ${ed?.pending ? html`<p class="note note-warn" style="margin:0">${t('exp.pendingNote')}</p>` : ''}
      ${ed && !owner ? html`<p class="small muted" style="margin:0">${t('exp.opEditNote')}</p>` : ''}
      <div class="form-grid">
        <div class="field"><span>${t('common.date')} *</span>${dateField({ name: 'date', value: v.date })}</div>
        <label class="field"><span>${t('exp.category')} *</span><select name="categoryId" required><option value="" ${v.categoryId ? '' : 'selected'} disabled>${t('common.choose')}</option>${live.map((c) => html`<option value="${c.id}" data-monthly="${c.monthly ? 1 : 0}" ${c.id === v.categoryId ? 'selected' : ''}>${c.name}</option>`)}</select></label>
      </div>
      <label class="field"><span>${t('exp.amount')} *</span><input name="amount" inputmode="decimal" value="${v.amount}" placeholder="0" autocomplete="off" class="exp-amt"></label>
      <div class="field"><span>${t('exp.mode')}</span>${seg('mode', [['cash', t('payments.cash')], ['upi', 'UPI'], ['bank', t('exp.bank')]], v.mode)}</div>
      <label class="check"><input type="checkbox" name="monthly" ${v.period === 'month' ? 'checked' : ''}> ${t('exp.monthly')}</label>
      <span class="hint" style="margin-top:-8px">${t('exp.monthlyHint')}</span>
      <label class="field"><span>${t('exp.note')}</span><input name="note" type="text" maxlength="200" value="${v.note}" placeholder="${t('exp.notePh')}" autocomplete="off"></label>
      <div class="field"><span>${t('exp.photo')}</span>
        <div class="exp-photo" data-photo-box>
          <img data-photo-img alt="${t('exp.photo')}" ${v.photo ? html`src="${v.photo}"` : 'hidden'}>
          <label class="btn btn-ghost">${icon('upload', 18)} <span data-photo-label>${v.photo ? t('exp.photoChange') : t('exp.photoAdd')}</span>
            <input type="file" name="photoFile" accept="image/*" capture="environment" hidden></label>
          <button type="button" class="btn btn-ghost btn-sm" data-photo-rm ${v.photo ? '' : 'hidden'}>${t('exp.photoRemove')}</button>
        </div><span class="hint">${t('exp.photoHint')}</span></div>
      <span class="err" role="alert"></span>
      <div class="row">
        <button class="btn btn-primary btn-xl" ${ed?.pending ? 'disabled' : ''}>${ed ? (owner ? t('common.save') : t('exp.sendForApproval')) : t('exp.save')}</button>
        ${ed ? html`<a class="btn btn-ghost" href="#${PATH}">${t('common.cancel')}</a>
          <button type="button" class="btn btn-ghost danger-text" data-del ${ed.pending ? 'disabled' : ''}>${owner ? t('exp.delete') : t('exp.askDelete')}</button>` : ''}
      </div>
    </form>`;

    const byCat = byCategory.length ? html`<div class="exp-cats">${byCategory.map((c) => html`<div class="exp-cat">
        <span class="exp-cat-n">${catName(c.categoryId)} <span class="muted small">· ${c.count}</span></span><b>${fmt.rs(c.paise)}</b>
        <span class="exp-bar"><i style="width:${Math.max(3, Math.round((c.paise * 100) / total))}%"></i></span></div>`)}</div>` : '';

    const rows = list.length ? html`<div class="table-wrap" data-pg-list="exp"><table class="tbl exp-tbl">
      <thead><tr><th>${t('common.date')}</th><th>${t('exp.category')}</th><th>${t('exp.mode')}</th><th class="num">${t('common.amount')}</th></tr></thead>
      <tbody>${list.map((e, i) => html`<tr class="clickable ${query.e === e.id ? 'sel' : ''}" data-e="${e.id}" tabindex="0" ${pgAttrs(i, PER_PAGE)}>
        <td class="nowrap">${fmt.date(e.date)}</td>
        <td><b>${catName(e.categoryId)}</b>${e.period === 'month' ? html` <span class="tag">${t('exp.monthlyTag')}</span>` : ''}${e.pending ? html` <span class="tag tag-warn">${t('exp.pendingTag')}</span>` : ''}
          <span class="sub">${e.note}${e.photo ? html` <a href="#" data-view="${e.id}" class="exp-cam" aria-label="${t('exp.photo')}">${icon('receipt', 14)}</a>` : ''}${owner && uname(e.createdBy) ? html` · ${uname(e.createdBy)}` : ''}</span></td>
        <td>${e.mode === 'upi' ? 'UPI' : e.mode === 'bank' ? t('exp.bank') : t('payments.cash')}</td>
        <td class="num"><b>${fmt.rs(e.amountPaise)}</b></td></tr>`)}</tbody>
      </table></div>${pager('exp', list.length, PER_PAGE)}` : empty(t('exp.none'));

    const due = sum.monthlyDue.length ? html`<section class="card exp-due"><h2>${t('exp.dueTitle')}</h2><p class="small muted" style="margin:-4px 0 10px">${t('exp.dueNote')}</p>
      <ul class="todo-list">${sum.monthlyDue.map((e) => html`<li><a href="#${PATH}?copy=${e.id}"><span class="todo-ic">${icon('clock', 18)}</span>
        <span class="todo-t">${catName(e.categoryId)}${e.note && e.note !== catName(e.categoryId) ? ' · ' + e.note : ''} <span class="small muted">— ${t('exp.lastMonth', { v: fmt.rs(e.amountPaise) })}</span></span><span class="todo-go">${t('exp.addNow')} ›</span></a></li>`)}</ul></section>` : '';

    const catAdmin = owner ? html`<section class="card exp-admin"><h2>${t('exp.catsTitle')}</h2>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>${t('exp.catName')}</th><th>${t('exp.catMonthly')}</th><th>${t('exp.catActive')}</th><th></th></tr></thead>
        <tbody>${cats.map((c) => html`<tr data-cat="${c.id}"><td><input type="text" name="cname" value="${c.name}" maxlength="40" aria-label="${t('exp.catName')}"></td>
          <td><input type="checkbox" name="cmonthly" ${c.monthly ? 'checked' : ''} aria-label="${t('exp.catMonthly')}"></td>
          <td><input type="checkbox" name="cactive" ${c.active ? 'checked' : ''} aria-label="${t('exp.catActive')}"></td>
          <td><button type="button" class="btn btn-ghost btn-sm" data-cat-save>${t('common.save')}</button></td></tr>`)}</tbody></table></div>
      <form class="row exp-newcat" data-newcat><input type="text" name="name" maxlength="40" placeholder="${t('exp.newCatPh')}" aria-label="${t('exp.newCat')}"><button class="btn btn-ghost">${icon('plus', 18)} ${t('exp.newCat')}</button></form>
      <form class="exp-msgcost" data-msgcost><label class="field"><span>${t('exp.msgCost')}</span><input name="cost" inputmode="decimal" value="${(sum.msgCostPaise / 100).toFixed(2)}"><span class="hint">${t('exp.msgCostHint')}</span></label>
        <button class="btn btn-ghost">${t('common.save')}</button></form>
    </section>` : '';

    mount(el, html`<div class="page-head"><h1>${t('nav.expenses')}</h1>
        ${list.length ? html`<button type="button" class="btn btn-ghost" data-csv>${icon('download', 18)} ${t('exp.export')}</button>` : ''}</div>
      ${filterCard(PATH, query, range, { count: list.length, unit: t('exp.entries') })}
      <div class="stats" style="margin-bottom:12px">
        ${stat(t('exp.total'), fmt.rs(total), t('exp.totalSubN', { n: list.length }), 'blue')}
        ${stat(t('exp.autoTitle'), fmt.rs(auto.totalPaise), t('exp.autoSub', { n: auto.whatsappSent, m: fmt.rs(auto.messagesPaise), p: auto.payoutCount, f: fmt.rs(auto.payoutFeesPaise) }))}
        ${stat(t('exp.grand'), fmt.rs(total + auto.totalPaise), t('exp.grandSub2'), 'warn')}
      </div>
      ${due}
      <div class="grid-2 exp-grid">${form}
        <section class="card"><h2>${t('exp.listTitle')}</h2>${byCat}${rows}<p class="small muted">${t('exp.listNote')}</p></section>
      </div>
      ${catAdmin}`);

    bindDateFields(el); bindSeg(el); bindRangeBar(el, PATH, query, range, today); bindPagers(el);
    const f = $('[data-exp]', el);
    let photo = v.photo; const clientId = uuid(); // one id per new entry: a double tap / retry never saves it twice
    // the category decides the "monthly" default for a new entry
    f.categoryId.addEventListener('change', () => { if (!ed) f.monthly.checked = f.categoryId.selectedOptions[0]?.dataset.monthly === '1'; });
    f.photoFile.addEventListener('change', async () => {
      const file = f.photoFile.files[0]; if (!file) return;
      try { photo = await shrinkImage(file, 1280); const img = $('[data-photo-img]', f); img.src = photo; img.hidden = false; $('[data-photo-rm]', f).hidden = false; $('[data-photo-label]', f).textContent = t('exp.photoChange'); }
      catch { toast(t('exp.photoBad'), 'err'); }
    });
    on(f, 'click', '[data-photo-rm]', () => { photo = ''; const img = $('[data-photo-img]', f); img.hidden = true; img.removeAttribute('src'); $('[data-photo-rm]', f).hidden = true; $('[data-photo-label]', f).textContent = t('exp.photoAdd'); f.photoFile.value = ''; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const x = { date: f.date.value, categoryId: f.categoryId.value, amountPaise: toPaise(f.amount.value), mode: f.mode.value, period: f.monthly.checked ? 'month' : 'once', note: f.note.value.trim(), photo };
      try {
        if (!x.amountPaise) throw { code: 'invalid-amount' };
        if (ed) { const r = await api.updateExpense({ id: ed.id, changes: x }); toast(r.queued ? t('exp.sentForApproval') : t('common.saved')); }
        else { await api.addExpense({ id: clientId, ...x }); toast(t('exp.saved', { v: fmt.rs(x.amountPaise) })); }
        navigate(PATH + keepRange);
      } catch (err) { $('.err', f).textContent = errorText(err); }
    });
    on(el, 'click', '[data-del]', async () => {
      const reason = window.prompt(t('exp.deleteAsk')); if (reason == null) return;
      try { const r = await api.deleteExpense({ id: ed.id, reason }); toast(r.queued ? t('exp.sentForApproval') : t('exp.deleted')); navigate(PATH + keepRange); } catch (err) { toast(errorText(err), 'err'); }
    });
    on(el, 'click', 'tr[data-e]', (ev, tr) => { if (ev.target.closest('[data-view]')) return; navigate(`${PATH}?e=${tr.dataset.e}${query.from ? `&from=${query.from}&to=${query.to}` : ''}`); });
    on(el, 'keydown', 'tr[data-e]', (ev, tr) => { if (ev.key === 'Enter') navigate(`${PATH}?e=${tr.dataset.e}`); });
    on(el, 'click', '[data-view]', (ev, a) => { ev.preventDefault(); const x = list.find((y) => y.id === a.dataset.view);
      modal(html`<div class="modal-head"><h2>${catName(x.categoryId)} · ${fmt.rs(x.amountPaise)}</h2><p class="muted" style="margin:4px 0 0">${fmt.date(x.date)} ${x.note ? '· ' + x.note : ''}</p></div>
        <div class="modal-body"><img src="${x.photo}" alt="${t('exp.photo')}" class="exp-photo-big"></div>
        <div class="modal-actions"><button type="button" class="btn btn-primary" data-close>${t('common.back')}</button></div>`); });
    on(el, 'click', '[data-csv]', () => {
      const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      const lines = [[t('common.date'), t('exp.category'), t('exp.note'), t('exp.mode'), t('exp.periodCol'), t('common.amount')].map(q).join(',')]
        .concat(list.map((e) => [fmt.date(e.date), catName(e.categoryId), e.note, e.mode === 'upi' ? 'UPI' : e.mode === 'bank' ? t('exp.bank') : t('payments.cash'),
          e.period === 'month' ? t('exp.monthlyTag') : '', (e.amountPaise / 100).toFixed(2)].map(q).join(',')));
      download(`kharch-${range.from}-${range.to}.csv`, lines.join('\r\n'));
    });
    if (owner) {
      on(el, 'click', '[data-cat-save]', async (_, b) => { const tr = b.closest('tr');
        try { await api.saveExpenseCategory({ id: tr.dataset.cat, name: tr.querySelector('[name=cname]').value, monthly: tr.querySelector('[name=cmonthly]').checked, active: tr.querySelector('[name=cactive]').checked }); toast(t('common.saved')); navigate(location.hash.slice(1)); }
        catch (err) { toast(errorText(err), 'err'); } });
      $('[data-newcat]', el).addEventListener('submit', async (e) => { e.preventDefault();
        try { await api.saveExpenseCategory({ name: e.target.name.value }); toast(t('common.saved')); navigate(location.hash.slice(1)); } catch (err) { toast(errorText(err), 'err'); } });
      $('[data-msgcost]', el).addEventListener('submit', async (e) => { e.preventDefault();
        try { await api.setMsgCost({ paise: Math.round(Number(e.target.cost.value) * 100) }); toast(t('common.saved')); navigate(location.hash.slice(1)); } catch (err) { toast(errorText(err), 'err'); } });
    }
  },
};
