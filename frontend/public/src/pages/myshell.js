// Farmer pages' shared top (D-91; header = the website's header look, D-102; on PC the tabs sit inside the header, D-105): the brand header and a sticky top bar with three big tabs —
// माझे खाते (#/my) · डॉक्टर (#/my/doctors) · योजना (#/my/schemes) · मदत (#/my/help, D-109). Each tab is its own page.
import { html } from '../core/dom.js';
import { t, getLang } from '../core/i18n.js';
import { brandLogo } from '../core/ui.js';
import { icon } from '../core/icons.js';

export const FARMER_TABS = [
  ['home', '/my', 'milk'],
  ['doctors', '/my/doctors', 'doctor'],
  ['schemes', '/my/schemes', 'scheme'],
  ['help', '/my/help', 'help'], // D-109
];

const SEEN_KEY = 'arag.seenSchemes';

/** Scheme ids this phone has already shown (per-device convenience; empty if storage is blocked). */
export function seenSchemes() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
export function markSchemesSeen(list) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seenSchemes(), ...list.map((s) => s.id)])])); } catch { /* storage blocked: badge just stays */ }
}
export const unseenCount = (schemes) => { const seen = seenSchemes(); return schemes.filter((s) => !seen.has(s.id)).length; };

/** Header + top tab bar. `active` is 'home' | 'doctors' | 'schemes'; `newSchemes` puts a count on योजना. */
export function farmerTop(c, active, { newSchemes = 0 } = {}) {
  const tab = (cls, size) => ([k, path, ic]) => html`<a href="#${path}" class="${cls} ${k === active ? 'on' : ''}" ${k === active ? html`aria-current="page"` : ''}>
      <span class="my-nav-ic">${icon(ic, size)}${k === 'schemes' && newSchemes ? html`<i class="my-nav-new" aria-label="${t('my.newN', { n: newSchemes })}">${newSchemes}</i>` : ''}</span>
      <span>${t('my.tab.' + k)}</span></a>`;
  return html`
    <header class="site-head scrolled my-head" id="my-head">
      <a class="site-brand" href="#/my">${brandLogo(66, { name: c.name, tagline: t('brand.tagline') })}<span><b>${c.name}</b><small>${t('brand.tagline')}</small></span></a>
      <nav class="site-nav my-head-nav" aria-label="${t('my.tabs')}">${FARMER_TABS.map(tab('my-tab', 20))}</nav>
      <div class="site-actions">
        <button class="site-lang" data-lang aria-label="${t('site.switchLang')}">${getLang() === 'mr' ? 'EN' : 'मरा'}</button>
        <button type="button" class="site-login" data-logout aria-label="${t('my.logout')}">${icon('logout', 20)}<span>${t('my.logout')}</span></button>
      </div>
    </header>
    <nav class="my-nav" aria-label="${t('my.tabs')}">${FARMER_TABS.map(tab('', 24))}</nav>`;
}
