// Farmer's "डॉक्टर" tab (#/my/doctors, D-91): veterinary doctors the center published.
// Emergency doctors first; filter सर्व / सरकारी / खाजगी (only when both kinds exist); one big call button per doctor.
import { api } from '../api/index.js';
import { html, mount } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { empty } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { farmerTop, unseenCount } from './myshell.js';

const KINDS = ['all', 'govt', 'private'];
// D-106: the doctor's own number is shown big (98765 43210) and the whole strip calls it
const spaced = (m) => String(m).replace(/^(\d{5})(\d{5})$/, '$1 $2');

export default {
  title: 'my.tab.doctors',
  layout: 'bare',
  roles: ['farmer'],
  async render(el, { query = {} } = {}) {
    const [c, all, schemes] = await Promise.all([api.center(), api.doctors().catch(() => []), api.schemes().catch(() => [])]);
    const both = all.some((d) => d.kind === 'govt') && all.some((d) => d.kind === 'private');
    const kind = both && KINDS.includes(query.kind) ? query.kind : 'all';
    const list = all.filter((d) => kind === 'all' || d.kind === kind);
    const urgent = list.filter((d) => d.emergency);
    const rest = list.filter((d) => !d.emergency);

    const card = (d) => html`<article class="card fdoc ${d.emergency ? 'fdoc-urgent' : ''}">
      <div class="fdoc-top">
        <div class="doctor-ic" aria-hidden="true">${icon('doctor', 26)}</div>
        <div class="fdoc-who"><h3>${d.name}</h3>${d.qualification ? html`<span class="small muted">${d.qualification}</span>` : ''}</div>
        <span class="tag ${d.kind === 'govt' ? 'tag-buf' : 'tag-cow'}">${t('doctors.kind.' + d.kind)}</span>
      </div>
      <dl class="fdoc-facts">
        ${d.place ? html`<div><dt>${icon('pin', 16)}<span class="sr-only">${t('doctors.place')}</span></dt><dd>${d.place}</dd></div>` : ''}
        ${d.timings ? html`<div><dt>${icon('clock', 16)}<span class="sr-only">${t('doctors.timings')}</span></dt><dd>${d.timings}</dd></div>` : ''}
        ${d.areas ? html`<div><dt>${t('doctors.areas')}</dt><dd>${d.areas}</dd></div>` : ''}
        ${d.services ? html`<div><dt>${t('doctors.services')}</dt><dd>${d.services}</dd></div>` : ''}
      </dl>
      ${d.mobile
        ? html`<a class="fdoc-num" href="tel:+91${d.mobile}" aria-label="${t('my.doc.call')} ${d.name} ${d.mobile}">
            <span class="fdoc-num-ic">${icon('phone', 22)}</span>
            <span class="fdoc-num-txt"><small>${t('my.doc.mobile')}</small><b>${spaced(d.mobile)}</b></span>
            <span class="fdoc-num-go">${t('my.doc.call')}</span></a>`
        : html`<div class="fdoc-nonum"><span>${icon('phone', 18)} ${t('my.doc.noNumber')}</span>
            <a class="btn btn-ghost btn-sm" href="tel:+91${c.mobile}">${t('my.doc.askCenter')}</a></div>`}
    </article>`;

    mount(el, html`<div class="my">
      ${farmerTop(c, 'doctors', { newSchemes: unseenCount(schemes) })}
      <section class="my-intro">
        <h1>${icon('doctor', 26)} ${t('my.doc.title')}</h1>
        <p>${t('my.doc.intro')}</p>
      </section>
      ${both ? html`<div class="chips" role="group" aria-label="${t('doctors.kind')}">${KINDS.map((k) => html`<a class="chip-btn ${k === kind ? 'on' : ''}" href="#/my/doctors${k === 'all' ? '' : '?kind=' + k}" ${k === kind ? html`aria-current="true"` : ''}>${t('my.doc.kind.' + k)}</a>`)}</div>` : ''}
      ${!list.length ? html`<div class="card">${empty(t('my.noDoctors'))}</div>` : ''}
      ${urgent.length ? html`<h2 class="my-sub danger-text">${t('my.doc.urgent')}</h2><div class="fdoc-grid">${urgent.map(card)}</div>` : ''}
      ${rest.length ? html`${urgent.length ? html`<h2 class="my-sub">${t('my.doc.others')}</h2>` : ''}<div class="fdoc-grid">${rest.map(card)}</div>` : ''}
      <p class="small muted my-help">${t('my.doc.help')} <a href="tel:+91${c.mobile}"><b>${c.mobile}</b></a></p>
    </div>`);
  },
};
