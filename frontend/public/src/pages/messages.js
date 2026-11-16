// Messaging outbox (A8): queue daily summary, see status/retries, SMS daily counter.
import { api } from '../api/index.js';
import { html, mount, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon, whatsappIcon } from '../core/icons.js';
import { toast, errorText, stat, empty, modal, confirmBox, channelTag } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { todayIST } from '../lib/dates.js';
import { navigate } from '../core/router.js';

const STATUS_TAG = { queued: 'tag', deferred: 'tag tag-warn', sent: 'tag tag-green', failed: 'tag tag-danger' };

import { rangeOf, filterCard, bindRangeBar, inRange } from '../core/rangebar.js';
const toIstDay = (iso) => todayIST(new Date(iso));

export default {
  title: 'nav.messages',
  roles: ['owner', 'operator'],
  async render(el, { query, user, center }) {
    const filter = query.status || '';
    const today = todayIST();
    const range = rangeOf(query, today, '7'); // D-55; the status counts follow the dates too (D-66)
    const [allRows, sms, farmersList] = await Promise.all([api.outbox({ status: filter || undefined }), api.smsCounter(), api.farmers({ includeInactive: true })]);
    const rows = allRows.filter((m) => inRange(range, toIstDay(m.createdAt)));
    const farmers = new Map(farmersList.map((f) => [f.id, f]));
    const all = (filter ? await api.outbox() : allRows).filter((m) => inRange(range, toIstDay(m.createdAt)));
    const count = (s) => all.filter((m) => m.status === s).length;
    const pct = sms.cap ? Math.round(sms.sent * 100 / sms.cap) : 0;

    mount(el, html`
      <div class="page-head"><h1>${t('nav.messages')}</h1>
        <div class="row"><button class="btn btn-green" data-notice>${icon('send')} ${t('notice.button')}</button>
          <button class="btn btn-ghost" data-run>${icon('send')} ${t('messages.sendNow')}</button></div></div>
      ${filterCard('/messages', query, range, { count: rows.length, unit: t('ledger.entries') })}
      <div class="note" style="margin-bottom:16px">${whatsappIcon(16)} ${t('messages.demoNote')}</div>
      <div class="stats" style="margin-bottom:16px">
        ${stat(t('messages.status.queued'), count('queued'))}
        ${stat(t('messages.status.deferred'), count('deferred'), '', count('deferred') ? 'warn' : '')}
        ${stat(t('messages.status.sent'), count('sent'), '', 'good')}
        ${stat(t('messages.status.failed'), count('failed'), '', count('failed') ? 'warn' : '')}
        <div class="stat"><div class="stat-label">${t('messages.smsToday')}</div><div class="stat-value">${sms.sent} / ${sms.cap}</div>
          <div class="meter ${pct > 85 ? 'warn' : ''}" style="margin-top:6px"><i style="width:${Math.min(100, pct)}%"></i></div></div>
      </div>
      <nav class="tabs">${['', 'queued', 'deferred', 'sent', 'failed'].map((s) => html`<a href="#/messages?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(query.range ? { range: query.range } : {}), ...(query.from ? { from: query.from, to: query.to } : {}) })}" class="${s === filter ? 'on' : ''}">${s ? t('messages.status.' + s) : t('common.all')}</a>`)}</nav>
      ${rows.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>${t('common.date')}</th><th>${t('common.name')}</th><th>${t('messages.kind')}</th><th>${t('messages.channel')}</th><th>${t('common.status')}</th><th>${t('messages.text')}</th><th></th></tr></thead>
        <tbody>${rows.slice(0, 200).map((m) => html`<tr>
          <td class="date-cell">${fmt.dateTime(m.createdAt)}</td><td>${farmers.get(m.farmerId)?.code} ${farmers.get(m.farmerId)?.name}</td><td>${t('messages.kind.' + m.kind)}</td>
          <td>${channelTag(m.channel)}${m.fellBack ? html` <span class="tag tag-warn">${t('messages.fallback')}</span>` : ''}</td>
          <td><span class="${STATUS_TAG[m.status]}">${t('messages.status.' + m.status)}</span>${m.attempts > 1 ? html` <span class="small muted">×${m.attempts}</span>` : ''}${m.lastError && m.status !== 'sent' ? html`<br><span class="small muted">${m.lastError}</span>` : ''}</td>
          <td class="small cell-long" style="white-space:pre-line">${m.channel === 'sms' ? m.texts.sms : m.texts.whatsapp}</td>
          <td>${m.status === 'failed' && user.role === 'owner' ? html`<button class="btn btn-sm btn-ghost" data-retry="${m.id}">${t('messages.retry')}</button>` : ''}</td></tr>`)}</tbody></table></div>` : empty(t('messages.none'))}`);

    const reload = () => navigate(location.hash.slice(1) || '/messages');
    bindRangeBar(el, '/messages', query, range, today);
    on(el, 'click', '[data-notice]', async () => { const r = await noticeDialog(); if (r) { const run = await api.runOutbox(); toast(t('notice.sent', { n: r.counts.whatsapp + r.counts.sms, s: run.sent })); reload(); } });
    on(el, 'click', '[data-run]', async () => { const r = await api.runOutbox(); toast(t('messages.runResult', r)); reload(); });
    on(el, 'click', '[data-retry]', async (_, b) => { await api.retryMessage(b.dataset.retry); reload(); });
  },
};

/** Broadcast / custom notice to farmers (D-72): who, text, optional SMS; shows how many get it before sending. */
function noticeDialog() {
  return modal(html`<form novalidate class="notice-form">
    <div class="modal-head"><h2>${t('notice.title')}</h2><p class="muted small" style="margin:4px 0 0">${t('notice.sub')}</p></div>
    <div class="modal-body stack">
      <div class="field"><span>${t('notice.to')}</span>
        <div class="chips" role="radiogroup">${['all', 'cow', 'buffalo', 'codes'].map((a, i) => html`<label class="chip-btn notice-aud ${i ? '' : 'on'}"><input type="radio" name="aud" value="${a}" ${i ? '' : 'checked'}> ${t('notice.aud.' + a)}</label>`)}</div></div>
      <label class="field" data-codes hidden><span>${t('notice.codes')}</span><input name="codes" type="text" inputmode="numeric" placeholder="101, 105, 110"><span class="hint">${t('notice.codesHint')}</span></label>
      <label class="field"><span>${t('notice.text')} *</span><textarea name="text" rows="5" maxlength="500" placeholder="${t('notice.placeholder')}"></textarea>
        <span class="hint" data-len></span></label>
      <label class="check"><input type="checkbox" name="sms"> ${t('notice.sms')}</label>
      <p class="small muted" style="margin:-6px 0 0">${t('notice.smsRule')}</p>
      <div class="note" data-count aria-live="polite"></div>
      <span class="err" role="alert"></span>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-green">${icon('send')} ${t('notice.send')}</button></div>
  </form>`, (d, close) => {
    const f = d.querySelector('form');
    const input = () => ({ text: f.text.value, audience: f.aud.value, codes: f.codes.value.split(/[^0-9]+/).filter(Boolean).map(Number), sms: f.sms.checked });
    let seq = 0;
    const refresh = async () => {
      d.querySelectorAll('.notice-aud').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
      d.querySelector('[data-codes]').hidden = f.aud.value !== 'codes';
      const len = f.text.value.trim().length;
      d.querySelector('[data-len]').textContent = t(f.sms.checked ? 'notice.lenSms' : 'notice.len', { n: len });
      d.querySelector('[data-len]').classList.toggle('bad', f.sms.checked && len > 140);
      const my = ++seq;
      try {
        const p = await api.broadcast({ ...input(), preview: true });
        if (my !== seq) return;
        mount(d.querySelector('[data-count]'), html`${t('notice.count', { w: p.whatsapp, s: p.sms })}${p.skipped ? html` <span class="muted">${t('notice.skipped', { n: p.skipped })}</span>` : ''}
          ${p.sms > p.smsLeft ? html`<br><b>${t('notice.smsLater', { n: p.sms - p.smsLeft })}</b>` : ''}${p.unknown.length ? html`<br><b>${t('notice.unknown', { c: p.unknown.join(', ') })}</b>` : ''}`);
        d.querySelector('.err').textContent = '';
      } catch (err) { if (my === seq) d.querySelector('.err').textContent = errorText(err); }
    };
    f.addEventListener('input', refresh); f.addEventListener('change', refresh); refresh();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const p = await api.broadcast({ ...input(), preview: true });
        if (!f.text.value.trim()) throw { code: 'notice-empty' };
        if (!await confirmBox(t('notice.confirm', { n: p.whatsapp + p.sms }), { okText: t('notice.send') })) return;
        close(await api.broadcast(input()));
      } catch (err) { d.querySelector('.err').textContent = errorText(err); }
    });
    setTimeout(() => f.text.focus(), 50);
  });
}
