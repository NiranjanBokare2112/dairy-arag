// Staff (owner): each operator's details, live status, last login/device, today's work,
// login history (with failed PIN attempts), and add / edit / disable operators.
// Note: with the demo mock each browser keeps its own data; with the real backend this shows every device.
import { api } from '../api/index.js';
import { OPERATOR_PAGES } from '../core/nav.js';
import { rangeOf, filterCard, bindRangeBar, inRange } from '../core/rangebar.js';
import { todayIST } from '../lib/dates.js';
import { html, mount, on, $, formData } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { toast, errorText, modal, empty } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { navigate } from '../core/router.js';

const deviceText = (d) => (d ? `${t('device.os.' + d.os)}${d.mobile ? ' ' + t('device.phone') : ''}${d.browser ? ' · ' + d.browser : ''}` : '—');

function duration(fromIso, toIso) {
  const mins = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000));
  return mins >= 60 ? t('staff.hm', { h: Math.floor(mins / 60), m: mins % 60 }) : t('staff.m', { m: mins });
}
const timeOnly = (iso) => fmt.dateTime(iso).slice(11);

export default {
  title: 'nav.staff',
  roles: ['owner'],
  async render(el, { query, user }) {
    const filterUser = query.user || '';
    const today = todayIST();
    const range = rangeOf(query, today, '7'); // D-55; cards and history both follow it (D-66)
    const people = await api.staff({ from: range.all ? undefined : range.from, to: range.to });
    const raw = await api.loginHistory({ userId: filterUser || undefined, limit: 2000 });
    const istDay = (iso) => todayIST(new Date(iso));
    const hist = { sessions: raw.sessions.filter((x) => inRange(range, istDay(x.loginAt))), failed: raw.failed.filter((x) => inRange(range, istDay(x.at))) };
    const nameOf = (id) => people.find((p) => p.id === id)?.name || id;

    const card = (p) => html`<article class="card staff-card ${p.active ? '' : 'off'}">
      <div class="staff-top">
        <div class="avatar ${p.role}" aria-hidden="true">${p.name.trim().charAt(0)}</div>
        <div class="staff-id"><h2>${p.name}</h2>
          <div class="row small"><span class="tag ${p.role === 'owner' ? '' : 'tag-green'}">${t('role.' + p.role)}</span>
            ${p.active ? '' : html`<span class="tag tag-grey">${t('staff.disabled')}</span>`}
            ${p.mobile ? html`<a href="tel:+91${p.mobile}" class="muted">${icon('phone', 14)} ${p.mobile}</a>` : html`<span class="muted">${t('staff.noMobile')}</span>`}</div></div>
        <span class="status ${p.online ? 'on' : ''}">${p.online ? t('staff.onlineNow') : (p.lastSeenAt ? t('staff.lastSeen', { when: fmt.dateTime(p.lastSeenAt) }) : t('staff.never'))}</span>
      </div>
      <dl class="staff-facts">
        <div><dt>${t('staff.lastLogin')}</dt><dd>${p.lastLoginAt ? fmt.dateTime(p.lastLoginAt) : '—'}</dd></div>
        <div><dt>${t('staff.device')}</dt><dd>${deviceText(p.lastDevice)}</dd></div>
        <div><dt>${t('staff.logins')}</dt><dd>${p.sessions}${p.failed ? html` <span class="tag tag-danger">${t('staff.failedN', { n: p.failed })}</span>` : ''}</dd></div>
        <div><dt>${t('staff.pin')}</dt><dd>${t('staff.pinDigits', { n: p.pinLength })}</dd></div>
      </dl>
      ${p.role === 'operator' ? html`<p class="small staff-pages"><b>${t('staff.pagesShort')}:</b> ${OPERATOR_PAGES.filter((n) => !p.pages || p.pages.includes(n.path)).map((n) => t(n.key)).join(', ')}</p>` : ''}
      <h3 class="staff-sub">${t('staff.work')}</h3>
      <div class="staff-work">
        <div><b>${p.work.entries}</b><span>${t('staff.w.entries')}</span></div>
        <div><b>${fmt.litres(p.work.litresX100)}</b><span>${t('unit.l')}</span></div>
        <div><b>${p.work.feedSales}</b><span>${t('staff.w.feed')}</span></div>
        <div><b>${p.work.advances}</b><span>${t('staff.w.advances')}</span></div>
        <div><b>${p.work.corrections}</b><span>${t('staff.w.corrections')}</span></div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn btn-sm btn-ghost" data-edit="${p.id}">${icon('edit', 16)} ${t('staff.edit')}</button>
        <a class="btn btn-sm btn-ghost" href="#/staff?user=${p.id}">${icon('clock', 16)} ${t('staff.history')}</a>
        <a class="btn btn-sm btn-ghost" href="#/audit?user=${p.id}">${icon('log', 16)} ${t('staff.activity')}</a>
      </div>
    </article>`;

    mount(el, html`
      <div class="page-head"><h1>${t('nav.staff')}</h1>
        <button class="btn btn-primary" data-add>${icon('plus')} ${t('staff.add')}</button></div>
      ${filterCard('/staff', query, range, { count: hist.sessions.length, unit: t('staff.loginsUnit') }, { extra: html`<label class="field filter-person"><span>${t('staff.person')}</span>
            <select data-user-filter><option value="">${t('staff.everyone')}</option>${people.map((p) => html`<option value="${p.id}" data-sub="${t('role.' + p.role)}" ${p.id === filterUser ? 'selected' : ''}>${p.name}</option>`)}</select></label>` })}
      <div class="staff-grid">${people.map(card)}</div>

      <section class="card" style="margin-top:16px" id="history">
        <div class="card-head"><h2>${t('staff.loginHistory')}</h2></div>
        ${hist.sessions.length ? html`<div class="table-wrap"><table class="tbl">
          <thead><tr><th>${t('staff.person')}</th><th>${t('common.date')}</th><th>${t('staff.in')}</th><th>${t('staff.out')}</th><th>${t('staff.duration')}</th><th>${t('staff.device')}</th></tr></thead>
          <tbody>${hist.sessions.map((s) => html`<tr>
            <td><b>${nameOf(s.userId)}</b></td><td class="nowrap">${fmt.dateTime(s.loginAt).slice(0, 10)}</td><td>${timeOnly(s.loginAt)}</td>
            <td>${s.logoutAt ? timeOnly(s.logoutAt) : html`<span class="tag tag-warn">${t('staff.notLoggedOut')}</span>`}</td>
            <td class="nowrap">${duration(s.loginAt, s.logoutAt || s.lastSeenAt)}</td><td class="small">${deviceText(s.device)}</td></tr>`)}</tbody></table></div>
          <p class="small muted">${t('staff.historyNote')}</p>` : empty(t('staff.noHistory'))}
        ${hist.failed.length ? html`<h3 style="margin-top:16px">${t('staff.failedTitle')}</h3>
          <div class="table-wrap"><table class="tbl"><tbody>${hist.failed.map((f) => html`<tr><td><span class="tag tag-danger">${t('staff.wrongPin')}</span></td><td><b>${nameOf(f.userId)}</b></td><td class="nowrap">${fmt.dateTime(f.at)}</td><td class="small">${deviceText(f.device)}</td></tr>`)}</tbody></table></div>
          <p class="small muted">${t('staff.lockNote')}</p>` : ''}
      </section>`);

    on(el, 'change', '[data-user-filter]', (_, s) => { const q = new URLSearchParams({ ...query, user: s.value }); if (!s.value) q.delete('user'); navigate('/staff' + (q.toString() ? '?' + q : '')); });
    bindRangeBar(el, '/staff', query, range, today);
    on(el, 'click', '[data-add]', () => editUser(null, user));
    on(el, 'click', '[data-edit]', (_, b) => editUser(people.find((p) => p.id === b.dataset.edit), user));
    if (filterUser || query.range || query.from) setTimeout(() => el.querySelector('#history')?.scrollIntoView({ block: 'start' }), 50);
  },
};

async function editUser(p, me) {
  const isNew = !p;
  const canDisable = p && p.role !== 'owner' && p.id !== me.id;
  const ok = await modal(html`<form novalidate>
    <div class="modal-head"><h2>${isNew ? t('staff.add') : t('staff.editTitle', { name: p.name })}</h2></div>
    <div class="modal-body stack">
      <label class="field"><span>${t('common.name')} *</span><input type="text" name="name" value="${p?.name || ''}" autofocus></label>
      <label class="field"><span>${t('staff.loginMobile')} *</span><input type="tel" name="mobile" inputmode="tel" maxlength="10" value="${p?.mobile || ''}" required>
        <span class="hint">${t('staff.loginMobileHint')}</span></label>
      <label class="field"><span>${isNew ? t('staff.pinNew') : t('staff.pinChange')}</span>
        <input type="password" name="pin" inputmode="numeric" maxlength="6" autocomplete="new-password">
        <span class="hint">${isNew ? t('staff.pinHintNew') : t('staff.pinHintEdit')}</span></label>
      ${!p || p.role === 'operator' ? html`<fieldset class="field op-pages"><legend>${t('staff.pages')}</legend>
        <p class="small muted" style="margin:0 0 6px">${t('staff.pagesHint')}</p>
        <div class="op-pages-grid">${OPERATOR_PAGES.map((n) => html`<label class="check"><input type="checkbox" name="pg" value="${n.path}" ${n.path === '/collection' ? 'checked disabled' : (!p?.pages || p.pages.includes(n.path) ? 'checked' : '')}> ${t(n.key)}</label>`)}</div></fieldset>` : ''}
      ${canDisable ? html`<label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> ${t('staff.activeLabel')}</label>
        <p class="small muted" style="margin:0">${t('staff.disableNote')}</p>` : ''}
      <span class="err" role="alert"></span>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary">${t('common.save')}</button></div>
  </form>`, (d, close) => {
    const f = d.querySelector('form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formData(f);
      try {
        const pages = !p || p.role === 'operator' ? ['/collection', ...[...f.querySelectorAll('[name=pg]:checked:not(:disabled)')].map((x) => x.value)] : undefined;
        await api.saveUser({ id: p?.id, name: v.name, mobile: v.mobile, pin: v.pin || undefined, active: canDisable ? v.active : true, pages });
        close(true);
      } catch (err) { $('.err', d).textContent = errorText(err); }
    });
  });
  if (ok) { toast(t('common.saved')); navigate('/staff'); }
}
