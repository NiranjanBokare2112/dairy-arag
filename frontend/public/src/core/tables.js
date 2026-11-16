// Phone tables (D-54): a table that does not fit the screen width is shown as one card per row,
// instead of being cut off at the right edge. Header text becomes a small label above each value
// (data-l); the first text column(s) (code, name, date) become the card title.
// Only applies on phones (≤ 640 px) and only to tables that overflow; opt out with data-nostack
// (e.g. the rate-chart grid, which must stay a grid).

const PHONE = '(max-width: 640px)';
const isPhone = () => window.matchMedia(PHONE).matches;

/** Copy header labels onto each cell (taking colspan into account) and mark the title cells. */
function label(table) {
  const heads = [...(table.tHead?.rows[0]?.cells || [])].flatMap((th) => Array(th.colSpan || 1).fill(th.textContent.trim()));
  const numCol = [...(table.tHead?.rows[0]?.cells || [])].flatMap((th) => Array(th.colSpan || 1).fill(th.classList.contains('num') || th.classList.contains('r')));
  // title = leading non-number columns (at most 2, e.g. code + name, or date + name)
  let lead = 0; while (lead < Math.min(2, heads.length) && !numCol[lead]) lead++;
  if (!lead) lead = 1;
  for (const body of [...table.tBodies, table.tFoot].filter(Boolean)) {
    for (const tr of body.rows) {
      let col = 0;
      for (const td of tr.cells) {
        td.dataset.l = heads[col] || '';
        td.classList.toggle('st-lead', col < lead && td.colSpan < heads.length);
        td.classList.toggle('st-wide', td.colSpan >= Math.max(2, heads.length - 1));
        td.classList.toggle('st-empty', !td.textContent.trim() && !td.querySelector('button,a,input,img,svg'));
        // only buttons / links (print, correct, pay…): no label, sits with the other actions
        td.classList.toggle('st-act', td.children.length > 0 && [...td.children].every((c) => c.matches('.btn, button')));
        // words (item, village, note): a wider slot so they don't break into many lines
        td.classList.toggle('st-num', !!numCol[col]);
        td.classList.toggle('st-text', col >= lead && !numCol[col] && td.textContent.trim().length > 8);
        col += td.colSpan || 1;
      }
      // two title cells (code + name, date + name): one line "112 · नाव"
      const [a, b] = [...tr.cells].filter((c) => c.classList.contains('st-lead'));
      if (a && b && !a.querySelector('button,a,input,.tag')) { b.dataset.pre = a.textContent.trim() + ' · '; a.classList.add('st-merged'); }
      else if (b) delete b.dataset.pre;
    }
  }
}

function fit(table) {
  if (table.dataset.nostack != null) return;
  table.classList.remove('stack');
  const wrap = table.parentElement;
  if (!isPhone() || !wrap) return;
  if (table.scrollWidth > wrap.clientWidth + 2) { label(table); table.classList.add('stack'); }
}

export function fitTables(root = document) { root.querySelectorAll('table.tbl').forEach(fit); }

let queued = false;
const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fitTables(); }); };

/** Re-check tables whenever the page re-renders or the screen size / orientation changes. */
export function watchTables(root = document.body) {
  new MutationObserver((muts) => {
    if (muts.some((m) => m.target.closest?.('table.tbl')
      || [...m.addedNodes].some((x) => x.nodeType === 1 && (x.matches?.('table.tbl') || x.querySelector?.('table.tbl'))))) schedule();
  }).observe(root, { childList: true, subtree: true });
  window.matchMedia(PHONE).addEventListener('change', schedule);
  window.addEventListener('orientationchange', schedule);
  schedule();
}
