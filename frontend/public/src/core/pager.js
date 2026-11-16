// Small in-page pager for long lists (D-57): rows carry data-pg="0,1,2…"; only one page shows at a time.
// ‹ नवीन  ·  1–7 / 18  ·  जुने ›   (newest first, so "next" means older).
import { html, on } from './dom.js';
import { t } from './i18n.js';

/** Page index for row i (use as data-pg) and whether it starts hidden. */
export const pageOf = (i, size) => Math.floor(i / size);
export const pgAttrs = (i, size) => html`data-pg="${pageOf(i, size)}" ${pageOf(i, size) ? 'hidden' : ''}`;

/** Controls for a list of `total` rows shown `size` at a time ('' when everything fits on one page). */
export function pager(key, total, size) {
  if (total <= size) return '';
  return html`<div class="pager" data-pager="${key}" data-total="${total}" data-size="${size}" data-page="0">
    <button type="button" class="btn btn-ghost btn-sm" data-pg-go="-1" disabled aria-label="${t('pager.newer')}">‹ ${t('pager.newer')}</button>
    <span class="pager-info" aria-live="polite">${t('pager.info', { a: 1, b: Math.min(size, total), n: total })}</span>
    <button type="button" class="btn btn-ghost btn-sm" data-pg-go="1" aria-label="${t('pager.older')}">${t('pager.older')} ›</button>
  </div>`;
}

/** Wire every pager in root. The rows it controls are those with data-pg inside the element with data-pg-list="key". */
export function bindPagers(root) {
  on(root, 'click', '[data-pg-go]', (_, b) => {
    const p = b.closest('[data-pager]'); const key = p.dataset.pager;
    const size = Number(p.dataset.size); const total = Number(p.dataset.total); const last = Math.ceil(total / size) - 1;
    const page = Math.max(0, Math.min(last, Number(p.dataset.page) + Number(b.dataset.pgGo)));
    p.dataset.page = page;
    root.querySelectorAll(`[data-pg-list="${key}"] [data-pg]`).forEach((r) => { r.hidden = Number(r.dataset.pg) !== page; });
    p.querySelector('[data-pg-go="-1"]').disabled = page === 0;
    p.querySelector('[data-pg-go="1"]').disabled = page === last;
    p.querySelector('.pager-info').textContent = t('pager.info', { a: page * size + 1, b: Math.min(total, (page + 1) * size), n: total });
  });
}
