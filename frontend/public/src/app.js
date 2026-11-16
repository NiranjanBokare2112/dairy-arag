// App shell: routing, role guard, navigation chrome, online status, service worker.
import { api } from './api/index.js';
import { installBackNav, afterRender } from './core/backnav.js';
import { route, match, navigate } from './core/router.js';
import { html, mount, $ } from './core/dom.js';
import { t, getLang, setLang } from './core/i18n.js';
import { icon } from './core/icons.js';
import { brandLogo, toast, errorText } from './core/ui.js';
import { navFor, allowedFor } from './core/nav.js';
import { enhanceSelects, watchSelects } from './core/select.js';
import { watchTables } from './core/tables.js';
import { applyFont, savedFont } from './core/fonttest.js';

applyFont(savedFont()); // D-133: a font chosen in the website's font tester stays on in this browser

import welcome from './pages/welcome.js';
import login from './pages/login.js';
import home, { startPage } from './pages/home.js';
import collection from './pages/collection.js';
import receipt from './pages/receipt.js';
import feedReceipt from './pages/feed-receipt.js';
import farmers from './pages/farmers.js';
import farmerForm from './pages/farmer-form.js';
import rates from './pages/rates.js';
import rateEdit from './pages/rate-edit.js';
import ledger from './pages/ledger.js';
import expenses from './pages/expenses.js';
import billing from './pages/billing.js';
import bill from './pages/bill.js';
import payments from './pages/payments.js';
import dispatch from './pages/dispatch.js';
import dashboard from './pages/dashboard.js';
import messages from './pages/messages.js';
import approvals from './pages/approvals.js';
import schemes from './pages/schemes.js';
import doctors from './pages/doctors.js';
import settings from './pages/settings.js';
import auditPage from './pages/audit.js';
import myPage from './pages/my.js';
import myDoctors from './pages/my-doctors.js';
import mySchemes from './pages/my-schemes.js';
import help, { supportPage } from './pages/help.js';
import myHelp from './pages/my-help.js';
import buyersPage from './pages/buyers.js';
import staff from './pages/staff.js';

route('/welcome', welcome);
route('/login', login);
route('/', home);
route('/collection', collection);
route('/receipt/:id', receipt);
route('/feed-receipt/:id', feedReceipt);
route('/farmers', farmers);
route('/farmers/new', farmerForm);
route('/farmers/:id', farmerForm);
route('/rates', rates);
route('/rates/new', rateEdit);
route('/rates/:id', rateEdit);
route('/ledger', ledger);
route('/expenses', expenses);
route('/billing', billing);
route('/bill/:id', bill);
route('/b/:token', { ...bill, public: true });
route('/payments', payments);
route('/dispatch', dispatch);
route('/dashboard', dashboard);
route('/messages', messages);
route('/approvals', approvals);
route('/schemes', schemes);
route('/doctors', doctors);
route('/settings', settings);
route('/audit', auditPage);
route('/staff', staff);
const FARMER_PATHS = ['/my', '/my/doctors', '/my/schemes', '/my/help'];
const isFarmerPath = (p) => FARMER_PATHS.includes(p) || p.startsWith('/my/help/');
route('/my', myPage);
route('/my/doctors', myDoctors); // D-91
route('/my/schemes', mySchemes);
route('/my/help', myHelp); // D-109
route('/my/help/:id', myHelp);
route('/help', help);
route('/help/:id', help);
route('/support', supportPage);
route('/buyers', buyersPage);

let user = null;
let center = null;
let renderSeq = 0;
let shown = null; // { path, pattern, user } of the page on screen: a filter / tab change on it updates in place (D-76)
let moreItems = []; // pages in the phone bar's "अधिक" sheet

function section(path) { return '/' + (path.split('/')[1] || ''); }

function chrome(r) {
  const cur = section(r.path);
  const items = navFor(user);
  const link = (n, cls) => html`<a href="#${n.path}" class="${cls} ${cur === n.path ? 'on' : ''}" ${cur === n.path ? html`aria-current="page"` : ''}>${icon(n.ic)}<span>${t(n.key)}</span></a>`;
  mount($('#topbar'), html`
    <a class="brand" href="#/">${brandLogo(48, { name: center.name, tagline: t('brand.tagline') })}<span class="brand-text"><b>${center.name}</b><small>${t('brand.tagline')}</small></span></a>
    <span class="spacer"></span>
    <span id="net" class="chip"></span>
    <button class="btn btn-ghost btn-sm lang" data-lang>${getLang() === 'mr' ? 'EN' : 'मरा'}</button>
    <span class="who">${user.name} · ${t('role.' + user.role)}</span>
    <button class="btn btn-ghost btn-sm" data-logout title="${t('nav.logout')}">${icon('logout', 20)}<span class="sr-only">${t('nav.logout')}</span></button>`);
  mount($('#sidenav'), html`${items.map((n) => link(n, 'side-link'))}`);
  // phone bar: up to 4 main pages + "अधिक" with every other page of the role (D-52)
  const bar = items.filter((n) => n.bottom?.includes(user.role)).slice(0, 4);
  const rest = items.filter((n) => !bar.includes(n));
  const moreOn = rest.some((n) => n.path === cur);
  mount($('#bottomnav'), html`${bar.map((n) => link(n, 'bottom-link'))}${rest.length ? html`<button type="button" class="bottom-link ${moreOn ? 'on' : ''}" data-more-nav
    aria-haspopup="dialog" aria-expanded="false">${icon('more')}<span>${moreOn ? t(rest.find((n) => n.path === cur).key) : t('nav.more')}</span></button>` : ''}`);
  moreItems = rest;
  netStatus();
}

function netStatus() {
  const el = $('#net'); if (!el) return;
  const online = navigator.onLine;
  // Nothing is shown while online; only a warning chip when the internet drops (work continues on the LAN).
  el.hidden = online;
  el.className = 'chip chip-warn';
  el.innerHTML = online ? '' : String(html`${icon('wifi', 16)}<span class="chip-label">${t('net.offline')}</span>`);
  el.title = online ? '' : t('net.offline');
}

async function render() {
  const seq = ++renderSeq;
  const r = match(location.hash);
  const view = $('#view');
  if (!r) { navigate('/'); return; }
  const page = r.page;
  if (!page.public) {
    user = await api.me();
    if (!user && r.path !== '/login') { navigate('/welcome'); return; }
    // "/" has no page (D-44), and a logged-in user doesn't need the login screen: show the role's start page
    // in place — replaceState, so no second navigation (which a still-loading page can drop) and no extra Back step
    if (user && (r.path === '/' || r.path === '/login')) { history.replaceState(history.state, '', '#' + startPage(user.role)); return render(); }
    // a farmer only ever sees their own page (and the public pages)
    if (user?.role === 'farmer' && !isFarmerPath(r.path)) { history.replaceState(history.state, '', '#/my'); return render(); }
    if (user && page.roles && !page.roles.includes(user.role)) { toast(t('err.forbidden'), 'warn'); navigate(startPage(user.role)); return; }
    // D-86: an operator only opens the tabs the owner allowed
    if (user && !allowedFor(user, section(r.path))) { toast(t('err.page-not-allowed'), 'warn'); history.replaceState(history.state, '', '#' + startPage(user.role)); return render(); }
  }
  center = center || await api.center();
  const bare = page.public || page.layout === 'bare' || !user;
  // D-76: same page, only the query changed (date filter, sub-tab, search…): keep the page and its scroll on screen,
  // load the new data behind it and swap in place — no blank "loading" screen, no jump to the top, menu untouched
  const soft = !!shown && shown.pattern === r.pattern && shown.path === r.path && shown.user === user?.id && !!view.querySelector(':scope > .page');
  // D-93: the farmer's tabs (माझे खाते / डॉक्टर / योजना) share one header and tab bar: switching keeps them on screen,
  // swaps only the content (no blank "loading" screen) and starts the new tab at the top
  const tabSwitch = !soft && !!shown && shown.user === user?.id && shown.path !== r.path && isFarmerPath(shown.path)
    && isFarmerPath(r.path) && !!view.querySelector(':scope > .page');
  document.body.classList.toggle('bare', bare);
  if (!bare && !soft) chrome(r);
  document.title = `${t(page.title || 'brand.name')} · ${t('brand.short')}`;
  const keepY = window.scrollY;
  const focusKey = soft ? focusKeyOf(document.activeElement) : null;
  if (!soft && !tabSwitch) { view.scrollTop = 0; window.scrollTo(0, 0); } // afterRender() puts it back on Back/Forward
  try {
    if (soft || tabSwitch) view.classList.add('is-updating'); else mount(view, html`<div class="loading">${t('common.loading')}</div>`);
    // Each render gets a fresh container, so listeners a page attaches die with it.
    const host = document.createElement('div');
    host.className = 'page';
    await page.render(host, { params: r.params, query: r.query, user, center, refresh: render, isCurrent: () => seq === renderSeq });
    if (seq !== renderSeq) return; // user navigated away while this page was loading
    enhanceSelects(host); // styled dropdowns before the page shows (no flash of the plain ones)
    view.replaceChildren(host);
    view.classList.remove('is-updating');
    shown = { path: r.path, pattern: r.pattern, user: user?.id };
    if (soft) {
      window.scrollTo(0, keepY); // same place on the page
      const back = focusKey && host.querySelector(focusKey); // the chip / tab that was pressed keeps the keyboard focus
      back?.focus({ preventScroll: true });
    } else if (tabSwitch) window.scrollTo(0, 0);
    else host.querySelector('[autofocus]')?.focus();
    afterRender({ keepScroll: soft }); // an in-place update stays where it is (no remembered position from an older visit)
  } catch (err) {
    console.error(err);
    view.classList.remove('is-updating'); shown = null;
    if (seq !== renderSeq) return;
    if (err?.code === 'unauthenticated') { navigate('/login'); return; }
    mount(view, html`<div class="card error-card"><h1>${t('err.title')}</h1><p>${errorText(err)}</p><a class="btn btn-primary" href="#${user ? startPage(user.role) : '/welcome'}">${t(user?.role === 'owner' ? 'nav.dashboard' : user ? 'nav.collection' : 'brand.name')}</a></div>`);
  }
}

/** A selector that finds "the same" control in the re-rendered page (links by href, buttons by their data-* or name). */
function focusKeyOf(el) {
  if (!el || el === document.body || !el.closest?.('#view')) return null;
  const esc = (v) => CSS.escape(v);
  const cls = el.classList[0] ? '.' + esc(el.classList[0]) : ''; // a date chip and a tab can share an address: match the kind too
  const href = el.getAttribute('href'); if (href) return `${el.tagName.toLowerCase()}${cls}[href="${esc(href)}"]`;
  const data = [...el.attributes].find((a) => a.name.startsWith('data-')); if (data) return `[${data.name}${data.value ? `="${esc(data.value)}"` : ''}]`;
  if (el.name) return `[name="${esc(el.name)}"]`;
  return el.id ? `#${esc(el.id)}` : null;
}

/** Phone "अधिक" sheet: every page that is not in the bottom bar. */
function openMoreNav(btn) {
  const d = document.createElement('dialog');
  d.className = 'dd-pop dd-sheet more-sheet';
  d.setAttribute('aria-label', t('nav.more'));
  const cur = section(match(location.hash)?.path || '/');
  mount(d, html`<div class="dd-head"><b>${t('nav.more')}</b><button type="button" class="dp-x" data-close aria-label="${t('common.cancel')}">✕</button></div>
    <nav class="more-grid">${moreItems.map((n) => html`<a href="#${n.path}" class="${cur === n.path ? 'on' : ''}" ${cur === n.path ? html`aria-current="page"` : ''}>${icon(n.ic, 26)}<span>${t(n.key)}</span></a>`)}</nav>`);
  document.body.append(d);
  const close = () => { if (d.open) d.close(); d.remove(); btn.setAttribute('aria-expanded', 'false'); };
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]') || e.target.closest('a')) close(); });
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); btn.focus(); });
  d.showModal(); btn.setAttribute('aria-expanded', 'true');
  d.querySelector('a')?.focus();
}

document.addEventListener('click', async (e) => {
  const more = e.target.closest('[data-more-nav]'); if (more) { openMoreNav(more); return; }
  const farmerTab = e.target.closest('.my-nav a, .my-head-nav a'); // D-93: the pressed tab lights up at once, before its content arrives
  if (farmerTab) farmerTab.parentElement.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a === farmerTab));
  if (e.target.closest('[data-logout]')) { await api.logout(); user = null; navigate('/welcome'); }
  if (e.target.closest('[data-lang]')) { setLang(getLang() === 'mr' ? 'en' : 'mr'); shown = null; render(); } // menu text changes too: full redraw
});
window.addEventListener('hashchange', render);
installBackNav(); // D-63: Back closes popups, restores scroll; मागे returns to where you were
window.addEventListener('online', () => { netStatus(); toast(t('net.backOnline')); });
window.addEventListener('offline', () => { netStatus(); toast(t('net.wentOffline'), 'warn'); });
window.addEventListener('arag:center-changed', async () => { center = await api.center(); });

document.documentElement.lang = getLang();
watchSelects(document.body); // selects added later (partial re-renders, dialogs)
watchTables(document.body); // phone: tables wider than the screen become one card per row (D-54)
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* non-fatal */ });
}
