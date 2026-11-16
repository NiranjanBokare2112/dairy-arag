// सरकारी योजना (D-71): the owner adds government schemes for farmers. Every scheme marked "वेबसाइटवर दाखवा" appears
// at once in the योजना section of the center's website (#/welcome) until its last date has passed.
import { api } from '../api/index.js';
import { html, mount, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { toast, errorText, empty, modal, confirmBox } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { navigate } from '../core/router.js';
import { dateField, bindDateFields } from '../core/datepicker.js';
import { todayIST, addDays } from '../lib/dates.js';

const BLANK = { title: '', summary: '', benefit: '', eligibility: '', documents: '', howTo: '', lastDate: '', link: '', published: true };

/** 'live' (on the website), 'hidden' (owner turned it off) or 'expired' (last date passed). */
export const schemeState = (s, today) => (!s.published ? 'hidden' : s.lastDate && s.lastDate < today ? 'expired' : 'live');

export default {
  title: 'nav.schemes',
  roles: ['owner'],
  async render(el) {
    const today = todayIST();
    const list = await api.schemes({ all: true });
    const tag = (st) => html`<span class="tag ${st === 'live' ? 'tag-green' : st === 'expired' ? 'tag-warn' : 'tag-grey'}">${t('schemes.state.' + st)}</span>`;
    const card = (s) => { const st = schemeState(s, today); return html`<article class="card scheme-card ${st}">
      <div class="scheme-top"><h2>${s.title}</h2>${tag(st)}</div>
      <p class="scheme-sum">${s.summary}</p>
      <dl class="scheme-facts">
        ${s.benefit ? html`<div><dt>${t('schemes.benefit')}</dt><dd>${s.benefit}</dd></div>` : ''}
        ${s.eligibility ? html`<div><dt>${t('schemes.eligibility')}</dt><dd>${s.eligibility}</dd></div>` : ''}
        ${s.documents ? html`<div><dt>${t('schemes.documents')}</dt><dd>${s.documents}</dd></div>` : ''}
        ${s.howTo ? html`<div><dt>${t('schemes.howTo')}</dt><dd>${s.howTo}</dd></div>` : ''}
        <div><dt>${t('schemes.lastDate')}</dt><dd>${s.lastDate ? fmt.date(s.lastDate) : t('schemes.noLastDate')}</dd></div>
        ${s.link ? html`<div><dt>${t('schemes.link')}</dt><dd><a href="${s.link}" target="_blank" rel="noopener">${s.link}</a></dd></div>` : ''}
      </dl>
      <div class="row">
        <button class="btn btn-sm btn-ghost" data-edit="${s.id}">${icon('edit', 16)} ${t('schemes.edit')}</button>
        <button class="btn btn-sm btn-ghost" data-toggle="${s.id}">${s.published ? t('schemes.hide') : t('schemes.show')}</button>
        <button class="btn btn-sm btn-ghost danger-text" data-del="${s.id}">${t('schemes.delete')}</button>
      </div></article>`; };
    const live = list.filter((s) => schemeState(s, today) === 'live').length;

    mount(el, html`
      <div class="page-head"><h1>${t('nav.schemes')}</h1>
        <div class="row"><a class="btn btn-ghost" href="#/welcome" target="_blank" rel="noopener">${t('schemes.viewSite')} ↗</a>
          <button class="btn btn-primary" data-add>${icon('plus')} ${t('schemes.add')}</button></div></div>
      <p class="note" style="margin-bottom:16px">${t('schemes.intro', { n: live })}</p>
      ${list.length ? html`<div class="scheme-grid">${list.map(card)}</div>` : empty(t('schemes.none'))}`);

    const again = () => navigate('/schemes');
    on(el, 'click', '[data-add]', async () => { if (await schemeForm({ ...BLANK })) again(); });
    on(el, 'click', '[data-edit]', async (_, b) => { if (await schemeForm(list.find((s) => s.id === b.dataset.edit))) again(); });
    on(el, 'click', '[data-toggle]', async (_, b) => {
      const s = list.find((x) => x.id === b.dataset.toggle);
      try { await api.saveScheme({ ...s, published: !s.published }); toast(s.published ? t('schemes.hidden') : t('schemes.shown')); again(); } catch (err) { toast(errorText(err), 'warn'); }
    });
    on(el, 'click', '[data-del]', async (_, b) => {
      const s = list.find((x) => x.id === b.dataset.del);
      if (!await confirmBox(t('schemes.deleteConfirm', { title: s.title }), { danger: true, okText: t('schemes.delete') })) return;
      try { await api.deleteScheme(s.id); toast(t('schemes.deleted')); again(); } catch (err) { toast(errorText(err), 'warn'); }
    });
  },
};

function schemeForm(s) {
  const isNew = !s.id;
  return modal(html`<form novalidate>
    <div class="modal-head"><h2>${isNew ? t('schemes.add') : t('schemes.edit')}</h2></div>
    <div class="modal-body stack scheme-form">
      <label class="field"><span>${t('schemes.title')} *</span><input name="title" type="text" value="${s.title}" required maxlength="120"></label>
      <label class="field"><span>${t('schemes.summary')} *</span><textarea name="summary" rows="3" required maxlength="800">${s.summary}</textarea></label>
      <div class="form-grid">
        <label class="field"><span>${t('schemes.benefit')}</span><textarea name="benefit" rows="2" maxlength="800" placeholder="${t('schemes.benefitHint')}">${s.benefit}</textarea></label>
        <label class="field"><span>${t('schemes.link')}</span><input name="link" type="text" inputmode="url" autocomplete="off" value="${s.link}" placeholder="https://"></label>
      </div>
      <div class="form-grid">
        <label class="field"><span>${t('schemes.eligibility')}</span><textarea name="eligibility" rows="3" maxlength="1000">${s.eligibility}</textarea></label>
        <label class="field"><span>${t('schemes.documents')}</span><textarea name="documents" rows="3" maxlength="800" placeholder="${t('schemes.documentsHint')}">${s.documents}</textarea></label>
      </div>
      <label class="field"><span>${t('schemes.howTo')}</span><textarea name="howTo" rows="3" maxlength="1000" placeholder="${t('schemes.howToHint')}">${s.howTo || ''}</textarea></label>
      <div class="form-grid">
        <div class="field"><span>${t('schemes.lastDate')}</span>
          <div class="last-row">
            <label class="check"><input type="checkbox" name="hasLast" ${s.lastDate ? 'checked' : ''}> ${t('schemes.hasLastDate')}</label>
            <div data-last ${s.lastDate ? '' : 'hidden'}>${dateField({ name: 'lastDate', value: s.lastDate || addDays(todayIST(), 30), max: '' })}</div>
          </div>
          <span class="hint">${t('schemes.lastDateHint')}</span></div>
        <div class="field"><span>${t('schemes.website')}</span>
          <label class="check publish-check"><input type="checkbox" name="published" ${s.published ? 'checked' : ''}> ${t('schemes.publish')}</label></div>
      </div>
      <span class="err" role="alert"></span>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary">${t('common.save')}</button></div>
  </form>`, (d, close) => {
    bindDateFields(d);
    const f = d.querySelector('form');
    f.hasLast.addEventListener('change', () => { d.querySelector('[data-last]').hidden = !f.hasLast.checked; if (f.hasLast.checked) d.querySelector('[data-last] .dp-field')?.focus(); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = (n) => f.elements[n].value.trim();
      try {
        await api.saveScheme({ id: s.id, title: v('title'), summary: v('summary'), benefit: v('benefit'), eligibility: v('eligibility'),
          documents: v('documents'), howTo: v('howTo'), lastDate: f.hasLast.checked ? v('lastDate') : '', link: v('link'), published: f.published.checked });
        toast(t('common.saved')); close(true);
      } catch (err) { d.querySelector('.err').textContent = errorText(err); }
    });
  });
}
