// पशुवैद्यक डॉक्टर (D-83, D-88): the owner keeps a list of veterinary doctors for the farmers. Every doctor marked
// "दाखवा" appears on the farmers' own page (माझी माहिती) only; the website just mentions the service.
import { api } from '../api/index.js';
import { html, mount, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { toast, errorText, empty, modal, confirmBox } from '../core/ui.js';
import { navigate } from '../core/router.js';

const BLANK = { name: '', qualification: '', kind: 'govt', mobile: '', place: '', areas: '', timings: '', services: '', emergency: false, published: true };
const KINDS = ['govt', 'private'];

/** A doctor card; `admin` adds the edit / hide / delete buttons. Shared by the owner page, farmer page and website. */
export function doctorCard(d, { admin = false } = {}) {
  return html`<article class="card doctor-card ${d.published ? '' : 'hidden'}">
    <div class="doctor-top"><div class="doctor-ic" aria-hidden="true">${icon('doctor', 26)}</div>
      <div><h3>${d.name}</h3>${d.qualification ? html`<p class="small muted">${d.qualification}</p>` : ''}</div>
      <span class="tag ${d.kind === 'govt' ? 'tag-buf' : 'tag-cow'}">${t('doctors.kind.' + d.kind)}</span></div>
    <dl class="scheme-facts">
      ${d.place ? html`<div><dt>${t('doctors.place')}</dt><dd>${d.place}</dd></div>` : ''}
      ${d.areas ? html`<div><dt>${t('doctors.areas')}</dt><dd>${d.areas}</dd></div>` : ''}
      ${d.timings ? html`<div><dt>${t('doctors.timings')}</dt><dd>${d.timings}</dd></div>` : ''}
      ${d.services ? html`<div><dt>${t('doctors.services')}</dt><dd>${d.services}</dd></div>` : ''}
    </dl>
    <div class="row doctor-actions">
      ${d.emergency ? html`<span class="tag tag-danger">${t('doctors.emergencyTag')}</span>` : ''}
      ${d.mobile ? html`<a class="btn btn-sm btn-green" href="tel:+91${d.mobile}">${icon('phone', 16)} ${d.mobile}</a>` : html`<span class="small muted">${t('doctors.noMobile')}</span>`}
      ${admin ? html`<span class="spacer"></span>
        ${d.published ? '' : html`<span class="tag tag-grey">${t('doctors.hiddenTag')}</span>`}
        <button class="btn btn-sm btn-ghost" data-edit="${d.id}">${icon('edit', 16)} ${t('schemes.edit')}</button>
        <button class="btn btn-sm btn-ghost" data-toggle="${d.id}">${d.published ? t('doctors.hide') : t('doctors.show')}</button>
        <button class="btn btn-sm btn-ghost danger-text" data-del="${d.id}">${t('schemes.delete')}</button>` : ''}
    </div></article>`;
}

export default {
  title: 'nav.doctors',
  roles: ['owner'],
  async render(el) {
    const list = await api.doctors({ all: true });
    const shown = list.filter((d) => d.published).length;
    mount(el, html`
      <div class="page-head"><h1>${t('nav.doctors')}</h1>
        <button class="btn btn-primary" data-add>${icon('plus')} ${t('doctors.add')}</button></div>
      <p class="note" style="margin-bottom:16px">${t('doctors.intro', { n: shown })}</p>
      ${list.length ? html`<div class="scheme-grid">${list.map((d) => doctorCard(d, { admin: true }))}</div>` : empty(t('doctors.none'))}`);

    const again = () => navigate('/doctors');
    on(el, 'click', '[data-add]', async () => { if (await doctorForm({ ...BLANK })) again(); });
    on(el, 'click', '[data-edit]', async (_, b) => { if (await doctorForm(list.find((x) => x.id === b.dataset.edit))) again(); });
    on(el, 'click', '[data-toggle]', async (_, b) => {
      const d = list.find((x) => x.id === b.dataset.toggle);
      try { await api.saveDoctor({ ...d, published: !d.published }); toast(d.published ? t('doctors.hidden') : t('doctors.shown')); again(); } catch (err) { toast(errorText(err), 'warn'); }
    });
    on(el, 'click', '[data-del]', async (_, b) => {
      const d = list.find((x) => x.id === b.dataset.del);
      if (!await confirmBox(t('doctors.deleteConfirm', { name: d.name }), { danger: true, okText: t('schemes.delete') })) return;
      try { await api.deleteDoctor(d.id); toast(t('doctors.deleted')); again(); } catch (err) { toast(errorText(err), 'warn'); }
    });
  },
};

function doctorForm(d) {
  const isNew = !d.id;
  return modal(html`<form novalidate>
    <div class="modal-head"><h2>${isNew ? t('doctors.add') : t('doctors.edit')}</h2></div>
    <div class="modal-body stack scheme-form">
      <div class="form-grid">
        <label class="field"><span>${t('doctors.name')} *</span><input name="name" type="text" value="${d.name}" required maxlength="80" placeholder="${t('doctors.namePh')}"></label>
        <label class="field"><span>${t('doctors.qualification')}</span><input name="qualification" type="text" value="${d.qualification}" maxlength="80" placeholder="B.V.Sc. & A.H."></label>
      </div>
      <div class="form-grid">
        <label class="field"><span>${t('doctors.kind')}</span><select name="kind">${KINDS.map((k) => html`<option value="${k}" ${d.kind === k ? 'selected' : ''}>${t('doctors.kind.' + k)}</option>`)}</select></label>
        <label class="field"><span>${t('farmers.mobile')}</span><input name="mobile" type="tel" inputmode="tel" maxlength="10" value="${d.mobile}"></label>
      </div>
      <div class="form-grid">
        <label class="field"><span>${t('doctors.place')}</span><input name="place" type="text" value="${d.place}" maxlength="120" placeholder="${t('doctors.placePh')}"></label>
        <label class="field"><span>${t('doctors.areas')}</span><input name="areas" type="text" value="${d.areas}" maxlength="160" placeholder="${t('doctors.areasPh')}"></label>
      </div>
      <div class="form-grid">
        <label class="field"><span>${t('doctors.timings')}</span><input name="timings" type="text" value="${d.timings}" maxlength="120" placeholder="${t('doctors.timingsPh')}"></label>
        <label class="field"><span>${t('doctors.services')}</span><input name="services" type="text" value="${d.services}" maxlength="200" placeholder="${t('doctors.servicesPh')}"></label>
      </div>
      <div class="form-grid">
        <label class="check publish-check"><input type="checkbox" name="emergency" ${d.emergency ? 'checked' : ''}> ${t('doctors.emergency')}</label>
        <label class="check publish-check"><input type="checkbox" name="published" ${d.published ? 'checked' : ''}> ${t('doctors.publish')}</label>
      </div>
      <span class="err" role="alert"></span>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary">${t('common.save')}</button></div>
  </form>`, (dlg, close) => {
    const f = dlg.querySelector('form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = (n) => f.elements[n].value.trim();
      try {
        await api.saveDoctor({ id: d.id, name: v('name'), qualification: v('qualification'), kind: f.kind.value, mobile: v('mobile').replace(/\D/g, ''),
          place: v('place'), areas: v('areas'), timings: v('timings'), services: v('services'), emergency: f.emergency.checked, published: f.published.checked });
        toast(t('common.saved')); close(true);
      } catch (err) { dlg.querySelector('.err').textContent = errorText(err); }
    });
    setTimeout(() => f.name.focus(), 50);
  });
}
