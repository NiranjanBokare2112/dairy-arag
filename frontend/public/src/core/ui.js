import { whatsappIcon } from './icons.js';
// Toasts, dialogs and small shared widgets.
import { html, mount, $ } from './dom.js';
import { t } from './i18n.js';

export function toast(message, kind = 'ok', ms = 2600) {
  let box = $('#toasts');
  if (!box) { box = Object.assign(document.createElement('div'), { id: 'toasts' }); box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

/** Opens a modal <dialog>. `view` is html``; `bind(dialog, close)` wires events. Resolves with close(value). */
export function modal(view, bind) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'modal';
    mount(d, view);
    document.body.append(d);
    const close = (v) => { d.close(); d.remove(); resolve(v); };
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(undefined); });
    d.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(undefined); });
    bind?.(d, close);
    d.showModal();
    d.querySelector('[autofocus]')?.focus();
  });
}

export function confirmBox(message, { okText = t('common.yes'), danger = false } = {}) {
  return modal(html`
    <div class="modal-body"><p class="lead">${message}</p></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>${t('common.cancel')}</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok autofocus>${okText}</button>
    </div>`, (d, close) => d.querySelector('[data-ok]').addEventListener('click', () => close(true)));
}

/** "WhatsApp" with the brand icon (same mark as the website), and the SMS counterpart (D-72). */
export const waTag = (label = 'WhatsApp') => html`<span class="tag tag-wa">${whatsappIcon(14)}${label}</span>`;
export const channelTag = (channel) => (channel === 'sms' ? html`<span class="tag tag-warn">SMS</span>` : waTag());

/** Small round badge (header, bill, receipt): sky disc, grass strip, cow & calf — same art as the brand logo. */
export const badge = (size = 44) => html`<span class="badge" style="--s:${size}px" aria-hidden="true"><span class="badge-grass"></span><img src="./assets/img/cow-calf.png" alt=""></span>`;

let logoSeq = 0;
/**
 * Full brand logo, geometry copied from design-assets/logo/arag-logo-badge.html (480-unit viewBox):
 * blue ring with the center name on the top arc and the tagline on the bottom arc, white inner ring,
 * sky disc (r=170) with a curved grass strip, cow & calf at x=12 y=59 w=316 inside the disc.
 */
export function brandLogo(size, { name, tagline, alt = '' }) {
  const id = 'bl' + (++logoSeq);
  return html`<span class="brand-logo" style="--s:${size}px" role="img" aria-label="${alt || name}">
    <svg viewBox="0 0 480 480" aria-hidden="true">
      <defs>
        <clipPath id="${id}-c"><circle cx="240" cy="240" r="170"/></clipPath>
        <path id="${id}-t" d="M48 240 A192 192 0 0 1 432 240"/>
        <path id="${id}-b" d="M30 240 A210 210 0 0 0 450 240"/>
      </defs>
      <circle cx="240" cy="240" r="236" fill="#1F4E9A"/>
      <circle cx="240" cy="240" r="228" fill="none" stroke="#FFFFFF" stroke-width="1.5"/>
      <circle cx="240" cy="240" r="176" fill="#FFFFFF"/>
      <g clip-path="url(#${id}-c)">
        <rect x="70" y="70" width="340" height="340" fill="#E3EFF8"/>
        <path d="M60 342 Q240 334 420 342 L420 420 L60 420 Z" fill="#8FAD3E"/>
        <image href="./assets/img/cow-calf.png" x="82" y="129" width="316" height="234" preserveAspectRatio="xMidYMid meet"/>
      </g>
      <text font-family="Mukta, sans-serif" font-size="38" font-weight="800" fill="#FFFFFF"><textPath href="#${id}-t" startOffset="50%" text-anchor="middle">${name}</textPath></text>
      <text font-family="Mukta, sans-serif" font-size="24" font-weight="700" fill="#FFFFFF"><textPath href="#${id}-b" startOffset="50%" text-anchor="middle">${tagline}</textPath></text>
      <circle cx="38" cy="240" r="5" fill="#FFFFFF"/><circle cx="442" cy="240" r="5" fill="#FFFFFF"/>
    </svg></span>`;
}

export const empty = (text) => html`<div class="empty">${text}</div>`;

export const stat = (label, value, sub = '', tone = '') => html`
  <div class="stat ${tone}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${sub ? html`<div class="stat-sub">${sub}</div>` : ''}</div>`;

/** Segmented control (large touch). */
export const seg = (name, options, value) => html`<div class="seg" role="radiogroup">${options.map(([v, label]) => html`
  <label class="seg-item ${v === value ? 'on' : ''}"><input type="radio" name="${name}" value="${v}" ${v === value ? 'checked' : ''}><span>${label}</span></label>`)}</div>`;

export function bindSeg(root) {
  root.addEventListener('change', (e) => {
    if (e.target.type !== 'radio') return;
    const g = e.target.closest('.seg');
    if (!g) return;
    g.querySelectorAll('.seg-item').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
  });
}

export function errorText(err) {
  const code = err?.code || 'unknown';
  const k = 'err.' + code;
  const s = t(k);
  return s === k ? (err?.message || t('err.unknown')) : s;
}
