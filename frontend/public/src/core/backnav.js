// Back that never frustrates (D-63):
//  1. Any popup (<dialog> opened with showModal: forms, side panel, date picker, dropdown sheet, अधिक sheet) adds one
//     Back step. Phone/browser Back closes the popup instead of leaving the page; closing it any other way removes
//     that step again.
//  2. Back to a page puts you where you were: the scroll position is remembered per address.
//  3. In-page "मागे" buttons (data-back) go back in history when you came from inside the app, so lists come back with
//     their dates, tab, search and scroll. Opened from a link or a refresh, they go to their href instead.
//  4. keepInUrl(): pages write filters (search text, date, shift…) into the address without reloading, so Back and
//     refresh bring them back.

// Every history entry gets a number (history.state.idx). The browser fires 'popstate' for ordinary link clicks
// too (a new #… address), so Back/Forward is told apart by the number: a new address has no number yet (D-76).
let cur = 0;            // number of the entry on screen
let base = 0;           // number of the first entry of this visit (opened from a link / refresh)
let popped = false;     // the next render comes from Back/Forward
let restoreY = 0;       // scroll of the page we went back to, read before the re-render resets it
const scrolls = new Map();
let dlgSeq = 0;
let ignorePop = 0;      // popstates caused by our own history.back() after a popup closed

/** After saving a form page: back to where you came from (with its filters and scroll), else to `path`. */
export function doneGoBack(path) { if (cur > base) history.back(); else location.replace('#' + path); }

/** Give the entry on screen its number if it has none (asNew: it was just added after the current one). */
function stamp(asNew) {
  const st = history.state;
  if (st && typeof st.idx === 'number') { cur = st.idx; return; }
  cur = asNew ? cur + 1 : cur;
  history.replaceState({ ...(st || {}), idx: cur }, '', location.href);
}

/** Send this address elsewhere without leaving a Back step that bounces forward again. */
export const redirect = (path) => location.replace('#' + path);

export function keepInUrl(changes) {
  const [path, qs] = location.hash.slice(1).split('?');
  const q = new URLSearchParams(qs || '');
  for (const [k, v] of Object.entries(changes)) { if (v === '' || v == null || v === false) q.delete(k); else q.set(k, v === true ? '1' : v); }
  const s = q.toString();
  history.replaceState(history.state, '', '#' + path + (s ? '?' + s : ''));
}

/** Called by the router after a page is shown. */
export function afterRender({ keepScroll = false } = {}) {
  if (typeof history.state?.idx !== 'number') stamp(false); // e.g. a page that replaced its own address
  const y = popped && !keepScroll ? restoreY : 0;
  popped = false; restoreY = 0;
  if (!y) return;
  // tables on phones turn into cards just after the page shows, so the page may still be short: retry briefly
  let tries = 0;
  const go = () => { window.scrollTo(0, y); if (Math.abs(window.scrollY - y) > 2 && tries++ < 20) setTimeout(go, 50); };
  requestAnimationFrame(go);
}

export function installBackNav() {
  stamp(false); base = cur;
  // remember scroll per address
  let tick = 0;
  window.addEventListener('scroll', () => { if (!tick) tick = requestAnimationFrame(() => { tick = 0; scrolls.set(location.hash, window.scrollY); }); }, { passive: true });

  window.addEventListener('popstate', (e) => {
    if (ignorePop) { ignorePop--; return; }
    // Back while a popup is open: close the top one (through its own cancel handling), stay on the page
    const open = [...document.querySelectorAll('dialog[open]')].pop();
    if (open && open.dataset.dlg) {
      open.dataset.popped = '1';
      open.dispatchEvent(new Event('cancel', { cancelable: true }));
      if (open.open) open.close();
      return;
    }
    if (typeof e.state?.idx !== 'number') return; // a new address (link click), not Back/Forward: hashchange numbers it
    popped = true; cur = e.state.idx; restoreY = scrolls.get(location.hash) || 0;
    // landed on a popup step whose popup is gone (rare): skip it so Back never "does nothing"
    if (e.state.dlg) { ignorePop++; history.back(); }
  });
  window.addEventListener('hashchange', () => {
    if (typeof history.state?.idx === 'number') return; // Back/Forward to a numbered entry (handled in popstate)
    popped = false; stamp(true); // a new page: one more step behind it (location.replace counts too; harmless)
  });

  // 1. popups own one history step
  const show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function showModalWithBack() {
    show.call(this);
    const id = String(++dlgSeq);
    this.dataset.dlg = id;
    history.pushState({ dlg: id, idx: cur }, '', location.href); // same page number: the popup is not a page
    this.addEventListener('close', () => {
      // closed by ✕ / outside click / Esc / save: take our step back off (only if it is still the current one)
      if (!this.dataset.popped && history.state?.dlg === id) { ignorePop++; history.back(); }
    }, { once: true });
  };

  // a link inside a popup (e.g. पूर्ण माहिती उघडा, the अधिक sheet) replaces the popup's step, so Back from the new
  // page returns straight to the page under the popup
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]'); const dlg = a?.closest('dialog[data-dlg]');
    if (!dlg || e.ctrlKey || e.metaKey || e.shiftKey || history.state?.dlg !== dlg.dataset.dlg) return;
    e.preventDefault();
    dlg.dataset.popped = '1';
    dlg.dispatchEvent(new Event('cancel', { cancelable: true }));
    if (dlg.open) dlg.close();
    location.replace(a.getAttribute('href'));
  }, true);

  // 3. smart "मागे"
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-back]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (cur > base) { e.preventDefault(); history.back(); }
  });
}
