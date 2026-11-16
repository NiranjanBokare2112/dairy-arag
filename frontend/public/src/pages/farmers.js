// Farmer list with quick search by code / name / village / mobile — the name in Marathi or English (D-118).
import { api } from '../api/index.js';
import { html, mount, $, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { empty, waTag } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { keepInUrl } from '../core/backnav.js';
import { navigate } from '../core/router.js';
import { toEnglish, toMarathi, hasLatin } from '../lib/translit.js';

export default {
  title: 'nav.farmers',
  roles: ['owner', 'operator'],
  async render(el, { user, query }) {
    const all = await api.farmers({ includeInactive: true });
    const isOwner = user.role === 'owner';
    mount(el, html`
      <div class="page-head"><h1>${t('nav.farmers')}</h1>
        <a class="btn btn-primary" href="#/farmers/new">${icon('plus')} ${t('farmers.add')}</a></div>
      <div class="filters">
        <label class="field search"><span>${t('common.search')}</span><input type="text" name="q" value="${query.q || ''}" placeholder="${t('farmers.searchHint')}"></label>
        <label class="check"><input type="checkbox" name="inactive" ${query.inactive ? 'checked' : ''}> ${t('farmers.showInactive')}</label>
      </div>
      <div id="list"></div>`);
    const draw = () => {
      const q = $('[name=q]', el).value.trim().toLowerCase();
      const showIn = $('[name=inactive]', el).checked;
      // "mane" finds माने and "माने" finds Mane: compare in both scripts
      const qMr = hasLatin(q) ? toMarathi(q) : q; const fold = (x) => x.toLowerCase().replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/w/g, 'v');
      const nameHit = (f) => f.name.toLowerCase().includes(q) || (qMr && f.name.includes(qMr))
        || fold(f.nameEn || toEnglish(f.name)).includes(fold(q)) || (hasLatin(q) && fold(toEnglish(f.village)).includes(fold(q)));
      const rows = all.filter((f) => (showIn || f.active) && (!q || String(f.code) === q || nameHit(f) || f.village.toLowerCase().includes(q) || (f.mobile || '').includes(q)));
      mount($('#list', el), rows.length ? html`<div class="table-wrap"><table class="tbl">
        <thead><tr><th>${t('common.code')}</th><th>${t('common.name')}</th><th>${t('farmers.village')}</th><th>${t('common.milk')}</th><th>${t('farmers.mobile')}</th><th>${t('farmers.messages')}</th></tr></thead>
        <tbody>${rows.map((f) => html`<tr class="clickable" data-id="${f.id}" tabindex="0">
          <td><b>${f.code}</b></td><td>${f.name} ${f.active ? '' : html`<span class="tag tag-grey">${t('farmers.inactive')}</span>`}${f.nameEn ? html`<div class="small muted">${f.nameEn}</div>` : ''}</td><td>${f.village}</td>
          <td>${f.milkTypes.map((m) => html`<span class="tag ${m === 'cow' ? 'tag-cow' : 'tag-buf'}">${fmt.milk(m)}</span> `)}</td>
          <td class="nowrap">${isOwner ? f.mobile : fmt.maskMobile(f.mobile)}</td>
          <td>${!f.consent ? html`<span class="tag tag-grey">${t('farmers.noConsent')}</span>` : f.hasWhatsapp ? waTag() : html`<span class="tag tag-warn">SMS</span>`}</td>
        </tr>`)}</tbody></table></div>
        <p class="small muted">${t('farmers.count', { n: rows.length })}</p>` : empty(t('farmers.none')));
    };
    // search and the inactive tick live in the address, so Back from a farmer brings the same list (D-63)
    el.addEventListener('input', () => { draw(); keepInUrl({ q: $('[name=q]', el).value.trim(), inactive: $('[name=inactive]', el).checked }); });
    el.addEventListener('change', () => { draw(); keepInUrl({ inactive: $('[name=inactive]', el).checked }); });
    on(el, 'click', 'tr[data-id]', (_, tr) => navigate('/farmers/' + tr.dataset.id));
    on(el, 'keydown', 'tr[data-id]', (e, tr) => { if (e.key === 'Enter') navigate('/farmers/' + tr.dataset.id); });
    draw();
  },
};
