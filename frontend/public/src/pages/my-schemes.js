// Farmer's "योजना" tab (#/my/schemes, D-91): government schemes the center published.
// Closing soon first (with "N दिवस बाकी"), then the rest newest first. "नवीन" marks schemes this phone hasn't shown yet;
// opening the tab marks them seen, so the count on the top bar goes away. Details (benefit, who, papers) fold open.
import { api } from '../api/index.js';
import { html, mount } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { empty } from '../core/ui.js';
import { icon } from '../core/icons.js';
import * as fmt from '../core/format.js';
import { todayIST, daysBetween } from '../lib/dates.js';
import { farmerTop, seenSchemes, markSchemesSeen } from './myshell.js';

const SOON = 15; // days: a scheme closing within this is listed first and marked

export default {
  title: 'my.tab.schemes',
  layout: 'bare',
  roles: ['farmer'],
  async render(el) {
    const today = todayIST();
    const [c, list] = await Promise.all([api.center(), api.schemes().catch(() => [])]);
    const seen = seenSchemes();
    const left = (s) => (s.lastDate ? daysBetween(today, s.lastDate) : null);
    const soon = list.filter((s) => left(s) !== null && left(s) <= SOON).sort((a, b) => (a.lastDate < b.lastDate ? -1 : 1));
    const rest = list.filter((s) => !soon.includes(s));

    const card = (s) => {
      const n = left(s);
      return html`<article class="card fsch ${n !== null && n <= SOON ? 'fsch-soon' : ''}">
        <div class="fsch-top">
          <h3>${s.title}</h3>
          ${seen.has(s.id) ? '' : html`<span class="tag tag-green">${t('my.sch.new')}</span>`}
        </div>
        ${s.lastDate ? html`<p class="fsch-date ${n <= SOON ? 'warn' : ''}">${icon('clock', 16)} ${t('site.sch.lastDate', { d: fmt.date(s.lastDate) })}
          · <b>${n === 0 ? t('my.sch.lastDay') : t('my.sch.daysLeft', { n })}</b></p>` : ''}
        <p class="fsch-sum">${s.summary}</p>
        ${s.benefit ? html`<p class="fsch-benefit"><b>${t('site.sch.benefit')}:</b> ${s.benefit}</p>` : ''}
        ${s.eligibility || s.documents || s.howTo ? html`<details class="fsch-more"><summary>${t('my.sch.more')}</summary>
          ${s.eligibility ? html`<p><b>${t('site.sch.who')}:</b><br>${s.eligibility}</p>` : ''}
          ${s.documents ? html`<p><b>${t('site.sch.docs')}:</b><br>${s.documents}</p>` : ''}
          ${s.howTo ? html`<p><b>${t('site.sch.how')}:</b><br>${s.howTo}</p>` : ''}
        </details>` : ''}
        <div class="fsch-actions">
          <a class="btn btn-primary" href="tel:+91${c.mobile}">${icon('phone', 18)} ${t('my.sch.ask')}</a>
          ${s.link ? html`<a class="btn btn-ghost" href="${s.link}" target="_blank" rel="noopener">${t('site.sch.more')} ↗</a>` : ''}
        </div>
      </article>`;
    };

    mount(el, html`<div class="my">
      ${farmerTop(c, 'schemes')}
      <section class="my-intro">
        <h1>${icon('scheme', 26)} ${t('my.sch.title')}</h1>
        <p>${t('my.sch.intro')}</p>
      </section>
      ${!list.length ? html`<div class="card">${empty(t('my.noSchemes'))}</div>` : ''}
      ${soon.length ? html`<h2 class="my-sub warn-text">${t('my.sch.soon')}</h2><div class="fsch-list">${soon.map(card)}</div>` : ''}
      ${rest.length ? html`${soon.length ? html`<h2 class="my-sub">${t('my.sch.others')}</h2>` : ''}<div class="fsch-list">${rest.map(card)}</div>` : ''}
    </div>`);
    markSchemesSeen(list);
  },
};
