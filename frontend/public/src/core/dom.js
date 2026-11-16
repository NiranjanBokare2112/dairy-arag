// Tiny, dependency-free rendering helpers.
// html`...` escapes every interpolated value unless it is itself html`` / raw(). Arrays are joined.

class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function flat(v) {
  if (v == null || v === false || v === true) return ''; // booleans render nothing (for ${cond && html`…`}); use String(x) for aria-*="true/false"
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(flat).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += flat(vals[i]) + strings[i + 1];
  return new Safe(out);
}

/** Trusted markup only (never user data). */
export const raw = (s) => new Safe(String(s));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function mount(el, view) { el.innerHTML = String(view); }

/** Delegated event: on(root, 'click', '[data-act=save]', (ev, target) => …) */
export function on(root, type, selector, fn) {
  root.addEventListener(type, (ev) => {
    const t = ev.target.closest(selector);
    if (t && root.contains(t)) fn(ev, t);
  });
}

/** Read a <form> into a plain object of trimmed strings (checkboxes → boolean). */
export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi) { (o[el.name] ||= []); if (el.checked) o[el.name].push(el.value); } else o[el.name] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else o[el.name] = el.value.trim();
  }
  return o;
}

export function download(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
