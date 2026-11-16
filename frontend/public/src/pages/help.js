// मदत — help & support tickets (D-109). One module for three places:
//   #/help (owner, operator)   report an issue + "माझी तिकिटे"; owner also sees every ticket of the centre
//   #/my/help (farmer)         the same inside the farmer pages (my-help.js)
//   #/support (Bokare support) every ticket, most urgent first (SLA); answer and set the status
// A ticket opens at #/help/:id (staff, support) or #/my/help/:id (farmer): the conversation, reply box, status.
// D-138: who raised it + call / WhatsApp buttons (support and owner), SLA clocks, screenshots on any message.
import { api } from '../api/index.js';
import { html, mount, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { toast, errorText, empty, modal } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { navigate } from '../core/router.js';
import { shrinkImage } from '../core/image.js';
import { slaOf, slaNext } from '../lib/sla.js';

export const CATS = ['milk', 'bill', 'upi', 'app', 'login', 'other'];
const MAX_PICS = 3;
const ST_TONE = { open: 'tag-warn', 'in-progress': 'tag-blue', waiting: 'tag-grey', resolved: 'tag-green', closed: 'tag-grey' };
export const statusTag = (st) => html`<span class="tag ${ST_TONE[st] || ''}">${t('tk.st.' + st)}</span>`;
const fromReporter = (m, tk) => m.by.kind === tk.by.kind && m.by.name === tk.by.name;
const kindName = (by) => (by.kind === 'support' ? t('tk.bokare') : by.kind === 'farmer' ? t('tk.farmer') : t('role.' + by.kind));

/** 1 दिवस 3 तास · 2 तास 15 मि. · 40 मि. */
export function durText(msLeft) {
  const m = Math.max(1, Math.round(Math.abs(msLeft) / 60000)); const h = Math.floor(m / 60); const d = Math.floor(h / 24);
  return d ? t('tk.dur.dh', { d, h: h % 24 }) : h ? t('tk.dur.hm', { h, m: m % 60 }) : t('tk.dur.m', { m });
}
const SLA_TONE = { ok: 'tag-blue', soon: 'tag-warn', breached: 'tag-danger', met: 'tag-green', late: 'tag-grey' };
/** The badge for the clock that matters now (list rows, support inbox). */
export function slaBadge(tk) {
  const c = slaNext(tk);
  const txt = c.state === 'met' || c.state === 'late' ? t('tk.sla.' + c.state + '.' + c.kind)
    : c.state === 'breached' ? t('tk.sla.over.' + c.kind, { d: durText(c.leftMs) }) : t('tk.sla.left.' + c.kind, { d: durText(c.leftMs) });
  return html`<span class="tag ${SLA_TONE[c.state]}" title="${t('tk.sla.due', { d: fmt.dateTime(new Date(c.due).toISOString()) })}">${icon('clock', 13)} ${txt}</span>`;
}
const slaLine = (label, c) => html`<div class="tk-sla-row"><span>${label}</span>
  <b>${c.at != null ? fmt.dateTime(new Date(c.at).toISOString()) : t('tk.sla.dueBy', { d: fmt.dateTime(new Date(c.due).toISOString()) })}</b>
  <span class="tag ${SLA_TONE[c.state]}">${c.state === 'met' ? t('tk.sla.inTime') : c.state === 'late' ? t('tk.sla.lateBy', { d: durText(c.leftMs) })
    : c.state === 'breached' ? t('tk.sla.overBy', { d: durText(c.leftMs) }) : t('tk.sla.leftShort', { d: durText(c.leftMs) })}</span></div>`;

// ---------------------------------------------------------------- screenshots (D-138)
const attachBox = () => html`<div class="field tk-att"><span>${t('tk.pics')}</span>
    <div class="tk-att-row"><label class="btn btn-ghost btn-sm">${icon('upload', 16)} ${t('tk.addPic')}
      <input type="file" accept="image/*" multiple hidden data-pic-input></label><span class="small muted">${t('tk.picHint', { n: MAX_PICS })}</span></div>
    <div class="tk-thumbs" data-thumbs></div></div>`;
/** Wire a form's picture box: files and pasted screenshots → shrunk previews; returns () => the data URLs. */
function bindAttach(form) {
  const pics = [];
  const box = form.querySelector('[data-thumbs]');
  const draw = () => mount(box, html`${pics.map((src, i) => html`<span class="tk-thumb"><img src="${src}" alt=""><button type="button" data-rm-pic="${i}" aria-label="${t('tk.removePic')}">✕</button></span>`)}`);
  const add = async (files) => {
    for (const f of files) {
      if (pics.length >= MAX_PICS) { toast(t('tk.maxPics', { n: MAX_PICS }), 'warn'); break; }
      if (!f.type.startsWith('image/')) continue;
      try { pics.push(await shrinkImage(f, 1600, 0.75)); } catch { toast(t('tk.picBad'), 'err'); }
    }
    draw();
  };
  form.querySelector('[data-pic-input]').addEventListener('change', async (e) => { await add([...e.target.files]); e.target.value = ''; }); // clear only after reading
  form.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); add(files); } });
  on(form, 'click', '[data-rm-pic]', (_, b) => { pics.splice(Number(b.dataset.rmPic), 1); draw(); });
  return { get: () => [...pics], clear: () => { pics.length = 0; draw(); } };
}
const picsHtml = (list = []) => (list.length ? html`<div class="tk-pics">${list.map((src, i) => html`<button type="button" class="tk-pic" data-pic aria-label="${t('tk.openPic', { n: i + 1 })}"><img src="${src}" alt="" loading="lazy"></button>`)}</div>` : '');
function bindPics(el) {
  on(el, 'click', '[data-pic]', (_, b) => modal(html`<div class="modal-body tk-pic-big"><img src="${b.querySelector('img').src}" alt=""></div>
    <div class="modal-actions"><button type="button" class="btn btn-primary" data-close>${t('common.back')}</button></div>`));
}

/** The "report an issue" form. */
export function ticketForm({ open = false } = {}) {
  return html`<details class="card tk-new" ${open ? 'open' : ''}><summary><h2>${icon('plus', 20)} ${t('tk.new')}</h2></summary>
    <form class="stack" data-tk-form novalidate>
      <p class="small muted" style="margin:0">${t('tk.newHelp')}</p>
      <div class="field"><span>${t('tk.cat')}</span><div class="tk-cats" role="radiogroup">${CATS.map((c, i) => html`<label class="tk-cat ${i === 0 ? 'on' : ''}">
        <input type="radio" name="category" value="${c}" ${i === 0 ? 'checked' : ''}><span>${t('tk.cat.' + c)}</span></label>`)}</div></div>
      <label class="field"><span>${t('tk.subject')} *</span><input name="subject" type="text" maxlength="120" required placeholder="${t('tk.subjectPh')}"></label>
      <label class="field"><span>${t('tk.text')} *</span><textarea name="text" rows="4" maxlength="2000" required placeholder="${t('tk.textPh')}"></textarea></label>
      ${attachBox()}
      <label class="check"><input type="checkbox" name="urgent"> ${t('tk.urgent')}</label>
      <p class="small muted" style="margin:-6px 0 0">${t('tk.slaPromise')}</p>
      <span class="err" role="alert"></span>
      <div class="row"><span class="spacer"></span><button class="btn btn-primary">${t('tk.send')}</button></div>
    </form></details>`;
}
export function bindTicketForm(el, base) {
  const f = el.querySelector('[data-tk-form]'); if (!f) return;
  const pics = bindAttach(f);
  f.addEventListener('change', () => f.querySelectorAll('.tk-cat').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked)));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const tk = await api.createTicket({ category: f.category.value, priority: f.urgent.checked ? 'urgent' : 'normal', subject: f.subject.value, text: f.text.value, images: pics.get() });
      toast(t('tk.sent', { no: tk.no })); navigate(`${base}/${tk.id}`);
    } catch (err) { f.querySelector('.err').textContent = errorText(err); }
  });
}

/** A list of tickets; `showBy` adds who reported it (+ their mobile), `sla` the service-level badge. */
export function ticketList(list, base, { showBy = false, sla = false, emptyText = t('tk.none') } = {}) {
  if (!list.length) return empty(emptyText);
  return html`<div class="tk-list">${list.map((x) => html`<a class="tk-row ${x.unread ? 'unread' : ''}" href="#${base}/${x.id}">
    <div class="tk-row-top"><b class="tk-no">${x.no}</b>${statusTag(x.status)}${x.priority === 'urgent' ? html`<span class="tag tag-danger">${t('tk.urgentTag')}</span>` : ''}
      ${sla ? slaBadge(x) : ''}${x.unread ? html`<span class="tk-dot" aria-label="${t('tk.newReply')}"></span>` : ''}<span class="spacer"></span><span class="small muted">${fmt.dateTime(x.updatedAt)}</span></div>
    <div class="tk-subj">${x.subject}${x.messages.some((m) => m.images?.length) ? html` <span class="muted" title="${t('tk.pics')}">${icon('receipt', 14)}</span>` : ''}</div>
    <div class="small muted">${t('tk.cat.' + x.category)}${showBy ? ` · ${x.who?.name || x.by.name} (${kindName(x.by)}${x.who?.code != null ? ' ' + x.who.code : ''})${x.who?.mobile ? ' · ' + x.who.mobile : ''}` : ''} · ${t('tk.msgsN', { n: x.messages.filter((m) => m.text).length })}</div>
  </a>`)}</div>`;
}

/** Who raised it + call / WhatsApp (support, and the owner on someone else's ticket). */
const whoCard = (tk) => { const w = tk.who || {}; return html`<div class="tk-who">
    <div><div class="small muted">${t('tk.raisedBy')}</div><b>${w.name || tk.by.name}</b> <span class="muted">· ${kindName(tk.by)}${w.code != null ? ' · ' + t('tk.code', { c: w.code }) : ''}${w.village ? ' · ' + w.village : ''}</span>
      <div class="small muted">${w.center}${w.mobile ? ' · ' + w.mobile : ''}</div></div>
    ${w.mobile ? html`<div class="tk-who-btns"><a class="btn btn-green btn-sm" href="tel:+91${w.mobile}">${icon('phone', 16)} ${t('tk.call')}</a>
      ${w.whatsapp ? html`<a class="btn btn-ghost btn-sm" href="https://wa.me/91${w.mobile}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>`
      : html`<span class="small muted">${t('tk.noMobile')}</span>`}
  </div>`; };

/** One ticket: details, who raised it, SLA, conversation (with pictures), reply, status buttons. */
export function ticketView(tk, back) {
  const side = !tk.mine; // owner looking at someone else's ticket, or Bokare support
  const s = slaOf(tk);
  return html`
    <div class="tk-head card">
      <div class="row"><a class="btn btn-ghost btn-sm" href="#${back}">${icon('back', 16)} ${t('tk.back')}</a><span class="spacer"></span>${statusTag(tk.status)}</div>
      <h1 class="tk-title"><span class="tk-no">${tk.no}</span> ${tk.subject}</h1>
      <div class="small muted">${t('tk.cat.' + tk.category)} · ${tk.by.name} (${kindName(tk.by)}) · ${fmt.dateTime(tk.createdAt)}${tk.priority === 'urgent' ? html` · <span class="tag tag-danger">${t('tk.urgentTag')}</span>` : ''}</div>
      ${side ? whoCard(tk) : ''}
      <div class="tk-sla">${side ? html`${slaLine(t('tk.sla.firstReply', { h: s.target.replyH }), s.reply)}${slaLine(t('tk.sla.solve', { h: s.target.resolveH }), s.resolve)}`
        : s.reply.at == null ? html`<p class="small" style="margin:0">${icon('clock', 14)} ${t('tk.sla.expect', { h: s.target.replyH })}</p>` : ''}</div>
      <p class="small tk-notify">${icon('send', 14)} ${t('tk.notified', { n: tk.notify.length })}</p>
    </div>
    <section class="card tk-thread">${tk.messages.map((m) => m.text ? html`<div class="tk-msg ${fromReporter(m, tk) === !!tk.mine ? 'me' : ''} ${m.by.kind === 'support' ? 'support' : ''}">
        <div class="tk-msg-by"><b>${m.by.name}</b> <span class="small muted">${kindName(m.by)} · ${fmt.dateTime(m.at)}</span></div>
        <div class="tk-msg-text">${m.text === '📷' && m.images?.length ? '' : m.text}</div>${picsHtml(m.images)}</div>`
      : html`<div class="tk-sys small muted">${t('tk.statusBy', { who: m.by.name, st: t('tk.st.' + m.status) })} · ${fmt.dateTime(m.at)}</div>`)}
    </section>
    <form class="card stack" data-tk-reply>
      <label class="field"><span>${t('tk.reply')}</span><textarea name="text" rows="3" maxlength="2000" placeholder="${side ? t('tk.replyPhSide') : t('tk.replyPh')}"></textarea></label>
      ${attachBox()}
      <span class="err" role="alert"></span>
      <div class="row tk-actions">
        ${side ? html`<label class="field tk-st"><span>${t('tk.setStatus')}</span><select name="status">${['open', 'in-progress', 'waiting', 'resolved'].map((st) => html`<option value="${st}" ${tk.status === st ? 'selected' : ''}>${t('tk.st.' + st)}</option>`)}</select></label>`
          : tk.status === 'closed' ? html`<button type="button" class="btn btn-ghost" data-tk-status="open">${t('tk.reopen')}</button>`
          : html`<button type="button" class="btn btn-ghost" data-tk-status="closed">${icon('check', 16)} ${t('tk.close')}</button>`}
        <span class="spacer"></span><button class="btn btn-primary">${icon('send', 16)} ${t('tk.sendReply')}</button></div>
    </form>`;
}
export function bindTicketView(el, tk, self) {
  const f = el.querySelector('[data-tk-reply]');
  const pics = bindAttach(f);
  bindPics(el);
  const again = () => navigate(`${self}?r=${Date.now()}`);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const text = f.text.value.trim(); const imgs = pics.get();
      const statusChange = f.status && f.status.value !== tk.status;
      if (!text && !imgs.length && !statusChange) { f.querySelector('.err').textContent = t('err.ticket-text-required'); return; }
      if (text || imgs.length) await api.replyTicket(tk.id, text, imgs);
      if (statusChange) await api.setTicketStatus(tk.id, f.status.value);
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
        ${ticketList(list, '/help', { showBy: scope === 'center', sla: true })}</section>`);
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
    const active = (x) => !['resolved', 'closed'].includes(x.status);
    let list = st === 'active' ? all.filter(active) : all.filter((x) => x.status === st);
    if (st === 'active' || !['resolved', 'closed'].includes(st)) list = [...list].sort((a, b) => slaNext(a).leftMs - slaNext(b).leftMs); // most urgent first (D-138)
    const n = (s) => all.filter((x) => x.status === s).length;
    const breached = all.filter((x) => active(x) && slaNext(x).state === 'breached').length;
    mount(el, html`
      <div class="page-head"><h1>${t('nav.support')}</h1></div>
      <div class="stats" style="margin-bottom:16px">
        <a class="stat ${breached ? 'warn' : 'good'}" href="#/support"><div class="stat-label">${t('tk.sla.breachedN')}</div><div class="stat-value">${breached}</div><div class="stat-sub">${t('tk.sla.targets')}</div></a>
        ${['open', 'in-progress', 'waiting', 'resolved'].map((s) => html`<a class="stat ${s === 'open' && n(s) ? 'warn' : ''}" href="#/support?st=${s}"><div class="stat-label">${t('tk.st.' + s)}</div><div class="stat-value">${n(s)}</div></a>`)}
      </div>
      <nav class="chips" style="margin-bottom:12px">${['active', ...ST].map((s) => html`<a class="chip-btn ${s === st ? 'on' : ''}" href="#/support${s === 'active' ? '' : '?st=' + s}">${s === 'active' ? t('tk.active') : t('tk.st.' + s)}</a>`)}</nav>
      <section class="card">${ticketList(list, '/help', { showBy: true, sla: true, emptyText: t('tk.noneHere') })}</section>`);
  },
};
