// मदत — help & support tickets (D-109). One module for three places:
//   #/help (owner, operator)   report an issue + "माझी तिकिटे"; owner also sees every ticket of the centre
//   #/my/help (farmer)         the same inside the farmer pages (my-help.js)
//   #/support (Bokare support) every ticket, by status; answer and set the status
// A ticket opens at #/help/:id (staff, support) or #/my/help/:id (farmer): the conversation, reply box, status.
import { api } from '../api/index.js';
import { html, mount, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { toast, errorText, empty } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { navigate } from '../core/router.js';

export const CATS = ['milk', 'bill', 'upi', 'app', 'login', 'other'];
const ST_TONE = { open: 'tag-warn', 'in-progress': 'tag-blue', waiting: 'tag-grey', resolved: 'tag-green', closed: 'tag-grey' };
export const statusTag = (st) => html`<span class="tag ${ST_TONE[st] || ''}">${t('tk.st.' + st)}</span>`;
const fromReporter = (m, tk) => m.by.kind === tk.by.kind && m.by.name === tk.by.name;
const kindName = (by) => (by.kind === 'support' ? t('tk.bokare') : by.kind === 'farmer' ? t('tk.farmer') : t('role.' + by.kind));

/** The "report an issue" form. */
export function ticketForm({ open = false } = {}) {
  return html`<details class="card tk-new" ${open ? 'open' : ''}><summary><h2>${icon('plus', 20)} ${t('tk.new')}</h2></summary>
    <form class="stack" data-tk-form novalidate>
      <p class="small muted" style="margin:0">${t('tk.newHelp')}</p>
      <div class="field"><span>${t('tk.cat')}</span><div class="tk-cats" role="radiogroup">${CATS.map((c, i) => html`<label class="tk-cat ${i === 0 ? 'on' : ''}">
        <input type="radio" name="category" value="${c}" ${i === 0 ? 'checked' : ''}><span>${t('tk.cat.' + c)}</span></label>`)}</div></div>
      <label class="field"><span>${t('tk.subject')} *</span><input name="subject" type="text" maxlength="120" required placeholder="${t('tk.subjectPh')}"></label>
      <label class="field"><span>${t('tk.text')} *</span><textarea name="text" rows="4" maxlength="2000" required placeholder="${t('tk.textPh')}"></textarea></label>
      <label class="check"><input type="checkbox" name="urgent"> ${t('tk.urgent')}</label>
      <span class="err" role="alert"></span>
      <div class="row"><span class="spacer"></span><button class="btn btn-primary">${t('tk.send')}</button></div>
    </form></details>`;
}
export function bindTicketForm(el, base) {
  const f = el.querySelector('[data-tk-form]'); if (!f) return;
  f.addEventListener('change', () => f.querySelectorAll('.tk-cat').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked)));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const tk = await api.createTicket({ category: f.category.value, priority: f.urgent.checked ? 'urgent' : 'normal', subject: f.subject.value, text: f.text.value });
      toast(t('tk.sent', { no: tk.no })); navigate(`${base}/${tk.id}`);
    } catch (err) { f.querySelector('.err').textContent = errorText(err); }
  });
}

/** A list of tickets; `showBy` adds who reported it. */
export function ticketList(list, base, { showBy = false, emptyText = t('tk.none') } = {}) {
  if (!list.length) return empty(emptyText);
  return html`<div class="tk-list">${list.map((x) => html`<a class="tk-row ${x.unread ? 'unread' : ''}" href="#${base}/${x.id}">
    <div class="tk-row-top"><b class="tk-no">${x.no}</b>${statusTag(x.status)}${x.priority === 'urgent' ? html`<span class="tag tag-danger">${t('tk.urgentTag')}</span>` : ''}
      ${x.unread ? html`<span class="tk-dot" aria-label="${t('tk.newReply')}"></span>` : ''}<span class="spacer"></span><span class="small muted">${fmt.dateTime(x.updatedAt)}</span></div>
    <div class="tk-subj">${x.subject}</div>
    <div class="small muted">${t('tk.cat.' + x.category)}${showBy ? ` · ${x.by.name} (${kindName(x.by)})` : ''} · ${t('tk.msgsN', { n: x.messages.filter((m) => m.text).length })}</div>
  </a>`)}</div>`;
}

/** One ticket: details, conversation, reply, status buttons. `role` = who is looking (owner, operator, farmer, support). */
export function ticketView(tk, back) {
  const side = !tk.mine; // owner looking at someone else's ticket, or Bokare support
  return html`
    <div class="tk-head card">
      <div class="row"><a class="btn btn-ghost btn-sm" href="#${back}">${icon('back', 16)} ${t('tk.back')}</a><span class="spacer"></span>${statusTag(tk.status)}</div>
      <h1 class="tk-title"><span class="tk-no">${tk.no}</span> ${tk.subject}</h1>
      <div class="small muted">${t('tk.cat.' + tk.category)} · ${tk.by.name} (${kindName(tk.by)}) · ${fmt.dateTime(tk.createdAt)}${tk.priority === 'urgent' ? html` · <span class="tag tag-danger">${t('tk.urgentTag')}</span>` : ''}</div>
      <p class="small tk-notify">${icon('send', 14)} ${t('tk.notified', { n: tk.notify.length })}</p>
    </div>
    <section class="card tk-thread">${tk.messages.map((m) => m.text ? html`<div class="tk-msg ${fromReporter(m, tk) === !!tk.mine ? 'me' : ''} ${m.by.kind === 'support' ? 'support' : ''}">
        <div class="tk-msg-by"><b>${m.by.name}</b> <span class="small muted">${kindName(m.by)} · ${fmt.dateTime(m.at)}</span></div>
        <div class="tk-msg-text">${m.text}</div></div>`
      : html`<div class="tk-sys small muted">${t('tk.statusBy', { who: m.by.name, st: t('tk.st.' + m.status) })} · ${fmt.dateTime(m.at)}</div>`)}
    </section>
    <form class="card stack" data-tk-reply>
      <label class="field"><span>${t('tk.reply')}</span><textarea name="text" rows="3" maxlength="2000" placeholder="${side ? t('tk.replyPhSide') : t('tk.replyPh')}"></textarea></label>
      <span class="err" role="alert"></span>
      <div class="row tk-actions">
        ${side ? html`<label class="field tk-st"><span>${t('tk.setStatus')}</span><select name="status">${['open', 'in-progress', 'waiting', 'resolved'].map((s) => html`<option value="${s}" ${tk.status === s ? 'selected' : ''}>${t('tk.st.' + s)}</option>`)}</select></label>`
          : tk.status === 'closed' ? html`<button type="button" class="btn btn-ghost" data-tk-status="open">${t('tk.reopen')}</button>`
          : html`<button type="button" class="btn btn-ghost" data-tk-status="closed">${icon('check', 16)} ${t('tk.close')}</button>`}
        <span class="spacer"></span><button class="btn btn-primary">${icon('send', 16)} ${t('tk.sendReply')}</button></div>
    </form>`;
}
export function bindTicketView(el, tk, self) {
  const f = el.querySelector('[data-tk-reply]');
  const again = () => navigate(`${self}?r=${Date.now()}`);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const text = f.text.value.trim();
      if (text) await api.replyTicket(tk.id, text);
      if (f.status && f.status.value !== tk.status) await api.setTicketStatus(tk.id, f.status.value);
      if (!text && !(f.status && f.status.value !== tk.status)) { f.querySelector('.err').textContent = t('err.ticket-text-required'); return; }
      toast(t('tk.saved')); again();
    } catch (err) { f.querySelector('.err').textContent = errorText(err); }
  });
  on(el, 'click', '[data-tk-status]', async (_, b) => {
    try { await api.setTicketStatus(tk.id, b.dataset.tkStatus); toast(t('tk.saved')); again(); } catch (err) { toast(errorText(err), 'warn'); }
  });
}

// ---------------------------------------------------------------- staff: #/help and #/help/:id
export default {
  title: 'nav.help',
  roles: ['owner', 'operator', 'support'],
  async render(el, { params = {}, query = {}, user }) {
    if (params.id) {
      const tk = await api.ticket(params.id);
      const back = user.role === 'support' ? '/support' : tk.mine ? '/help' : '/help?scope=center';
      mount(el, html`<div class="tk-page">${ticketView(tk, back)}</div>`);
      return bindTicketView(el, tk, '/help/' + tk.id);
    }
    const owner = user.role === 'owner';
    const scope = owner && query.scope === 'center' ? 'center' : 'mine';
    const list = await api.tickets({ scope });
    mount(el, html`
      <div class="page-head"><h1>${t('nav.help')}</h1></div>
      ${owner ? html`<nav class="tabs">${[['mine', t('tk.mine')], ['center', t('tk.center')]].map(([k, l]) => html`<a href="#/help${k === 'center' ? '?scope=center' : ''}" class="${k === scope ? 'on' : ''}" ${k === scope ? html`aria-current="page"` : ''}>${l}</a>`)}</nav>` : ''}
      ${scope === 'mine' ? ticketForm({ open: !list.length }) : html`<p class="note">${t('tk.centerNote')}</p>`}
      <section class="card"><h2>${scope === 'center' ? t('tk.center') : t('tk.mine')} <span class="muted small">(${list.length})</span></h2>
        ${ticketList(list, '/help', { showBy: scope === 'center' })}</section>`);
    bindTicketForm(el, '/help');
  },
};

// ---------------------------------------------------------------- Bokare support inbox: #/support
export const supportPage = {
  title: 'nav.support',
  roles: ['support'],
  async render(el, { query = {} }) {
    const all = await api.tickets({});
    const ST = ['open', 'in-progress', 'waiting', 'resolved', 'closed'];
    const st = ST.includes(query.st) ? query.st : 'active';
    const list = st === 'active' ? all.filter((x) => !['resolved', 'closed'].includes(x.status)) : all.filter((x) => x.status === st);
    const n = (s) => all.filter((x) => x.status === s).length;
    mount(el, html`
      <div class="page-head"><h1>${t('nav.support')}</h1></div>
      <div class="stats" style="margin-bottom:16px">
        ${['open', 'in-progress', 'waiting', 'resolved'].map((s) => html`<a class="stat ${s === 'open' && n(s) ? 'warn' : ''}" href="#/support?st=${s}"><div class="stat-label">${t('tk.st.' + s)}</div><div class="stat-value">${n(s)}</div></a>`)}
      </div>
      <nav class="chips" style="margin-bottom:12px">${['active', ...ST].map((s) => html`<a class="chip-btn ${s === st ? 'on' : ''}" href="#/support${s === 'active' ? '' : '?st=' + s}">${s === 'active' ? t('tk.active') : t('tk.st.' + s)}</a>`)}</nav>
      <section class="card">${ticketList(list, '/help', { showBy: true, emptyText: t('tk.noneHere') })}</section>`);
  },
};
