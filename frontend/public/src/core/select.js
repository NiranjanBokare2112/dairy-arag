// Styled dropdowns. Every <select> in the app is enhanced automatically (see watchSelects in app.js):
// the native <select> stays in the form (hidden) and keeps the value, so forms, filters and formData()
// work unchanged; a button shows the chosen option and opens a list styled like the date picker —
// anchored under the field on desktop, a bottom sheet on phones.
//   <option data-sub="…">  second, muted line under the option (e.g. price · stock, a rule's meaning)
//   <select data-native>   opt out (keep the browser's own dropdown)
// Keyboard: ↓/↑/Enter/Space open; in the list ↑/↓/Home/End move, Enter/Space pick, Esc closes,
// typing a letter jumps to the next option starting with it. Picking fires 'input' and 'change' on the <select>.
import { html, mount } from './dom.js';
import { t } from './i18n.js';

const isPhone = () => window.matchMedia('(max-width: 640px)').matches;
const CHEV = '<svg class="dd-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
let uid = 0;

const labelOf = (sel) => (sel.closest('label')?.querySelector(':scope > span')?.textContent
  || sel.getAttribute('aria-label') || '').replace(/\s*\*\s*$/, '').trim();

/** Update the button text from the <select>'s current value. */
function sync(sel, btn) {
  const o = sel.options[sel.selectedIndex];
  btn.querySelector('.dd-text').textContent = o ? o.textContent.trim() : '—';
  btn.setAttribute('aria-label', `${labelOf(sel)}: ${o ? o.textContent.trim() : '—'}`);
  btn.disabled = sel.disabled || sel.matches(':disabled');
}

function enhance(sel) {
  if (sel.dataset.dd || sel.hasAttribute('data-native') || sel.multiple) return;
  sel.dataset.dd = String(++uid);
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'dd-field'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<span class="dd-text"></span>${CHEV}`;
  sel.classList.add('dd-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  sel.after(btn);
  sync(sel, btn);
  sel.addEventListener('change', () => sync(sel, btn));
  sel.addEventListener('focus', () => btn.focus());
  // a click on the field's label text opens the list instead of focusing the hidden <select>
  sel.closest('label')?.addEventListener('click', (e) => { if (e.target === btn || btn.contains(e.target)) return; e.preventDefault(); if (!btn.disabled) open(sel, btn); });
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(sel, btn); });
  btn.addEventListener('keydown', (e) => { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(sel, btn); } });
}

function open(sel, btn) {
  if (btn.disabled || btn.getAttribute('aria-expanded') === 'true') return;
  const phone = isPhone(); const title = labelOf(sel); const lid = 'dd-list-' + sel.dataset.dd;
  const d = document.createElement('dialog');
  d.className = 'dd-pop' + (phone ? ' dd-sheet' : '');
  d.setAttribute('aria-label', title || t('common.choose'));
  const opts = [...sel.options];
  mount(d, html`${phone ? html`<div class="dd-head"><b>${title}</b><button type="button" class="dp-x" data-close aria-label="${t('common.cancel')}">✕</button></div>` : ''}
    <div class="dd-list" role="listbox" id="${lid}" aria-label="${title}">${opts.map((o, i) => html`<div class="dd-opt ${o.selected ? 'on' : ''}" role="option" tabindex="-1" data-i="${i}"
      aria-selected="${String(o.selected)}" ${o.disabled ? 'aria-disabled="true"' : ''}><span class="dd-tick" aria-hidden="true"></span><span class="dd-lbl">${o.textContent.trim()}${o.dataset.sub ? html`<small>${o.dataset.sub}</small>` : ''}</span></div>`)}</div>`);
  d.querySelectorAll('.dd-opt.on .dd-tick').forEach((x) => { x.innerHTML = CHECK; });
  document.body.append(d);
  const close = (focus = true) => { if (d.open) d.close(); d.remove(); btn.setAttribute('aria-expanded', 'false'); if (focus) btn.focus(); };
  const pick = (i) => {
    const o = opts[i]; if (!o || o.disabled) return;
    const changed = sel.selectedIndex !== i;
    sel.selectedIndex = i; sync(sel, btn); close();
    if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  const items = [...d.querySelectorAll('.dd-opt')];
  const focusAt = (i) => { const k = Math.max(0, Math.min(items.length - 1, i)); items[k]?.focus(); items[k]?.scrollIntoView({ block: 'nearest' }); };
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.addEventListener('mousedown', (e) => { if (e.target === d) close(); });
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    const it = e.target.closest('.dd-opt'); if (it) pick(Number(it.dataset.i));
  });
  d.addEventListener('keydown', (e) => {
    const cur = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(cur + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(cur - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
    else if (e.key === 'End') { e.preventDefault(); focusAt(items.length - 1); }
    else if ((e.key === 'Enter' || e.key === ' ') && cur >= 0) { e.preventDefault(); pick(cur); }
    else if (e.key === 'Tab') { e.preventDefault(); close(); }
    else if (e.key.length === 1 && /\S/.test(e.key)) { // type-ahead
      const k = e.key.toLowerCase();
      const n = opts.length; for (let s = 1; s <= n; s++) { const j = (cur + s + n) % n; if (opts[j].textContent.trim().toLowerCase().startsWith(k)) { focusAt(j); break; } }
    }
  });
  d.showModal();
  if (!phone) {
    const r = btn.getBoundingClientRect();
    d.style.width = Math.max(r.width, 200) + 'px';
    const w = d.offsetWidth; const h = d.offsetHeight;
    d.style.left = Math.min(Math.max(8, r.left), innerWidth - w - 8) + 'px';
    d.style.top = (r.bottom + 6 + h <= innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - h)) + 'px';
  }
  btn.setAttribute('aria-expanded', 'true');
  focusAt(Math.max(0, sel.selectedIndex));
}

/** Enhance every <select> under root now. */
export function enhanceSelects(root = document) { root.querySelectorAll('select').forEach(enhance); }

/** Enhance selects now and whenever new ones are added to the page (re-renders, modals). */
export function watchSelects(root = document.body) {
  enhanceSelects(root);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return; queued = true;
    queueMicrotask(() => { queued = false; enhanceSelects(root); });
  }).observe(root, { childList: true, subtree: true });
}
