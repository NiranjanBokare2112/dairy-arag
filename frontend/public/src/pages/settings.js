// Center settings (owner): bill cycle, rate rule, messaging, bill digits, PINs, backup, demo reset.
import { api } from '../api/index.js';
import { html, mount, on, $, formData, download } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { toast, errorText, confirmBox } from '../core/ui.js';
import { RULES } from '../lib/rates.js';
import { todayIST } from '../lib/dates.js';
import { navigate } from '../core/router.js';
import { dateField, bindDateFields } from '../core/datepicker.js';
import { DASH_SECTIONS, dashLayout, layoutToSave } from '../core/dashlayout.js';

export default {
  title: 'nav.settings',
  roles: ['owner'],
  async render(el) {
    const [c, users] = await Promise.all([api.center(), api.users()]);
    mount(el, html`
      <div class="page-head"><h1>${t('nav.settings')}</h1></div>
      <form class="card stack" data-center novalidate>
        <h2>${t('settings.center')}</h2>
        <div class="form-grid">
          <label class="field"><span>${t('settings.name')}</span><input type="text" name="name" value="${c.name}"></label>
          <label class="field"><span>${t('settings.address')}</span><input type="text" name="address" value="${c.address}"></label>
          <label class="field"><span>${t('farmers.mobile')}</span><input type="tel" name="mobile" value="${c.mobile}"></label>
          <label class="field"><span>${t('dispatch.dairy')}</span><input type="text" name="dairyName" value="${c.dairyName}" placeholder="${t('settings.dairyUndecided')}"></label>
        </div>
        <h2>${t('settings.billing')}</h2>
        <div class="form-grid">
          <label class="field"><span>${t('settings.cycleDays')}</span><select name="cycleDays"><option value="10" data-sub="${t('settings.days10Sub')}" ${c.cycleDays === 10 ? 'selected' : ''}>${t('settings.days10Short')}</option><option value="7" data-sub="${t('settings.days7Sub')}" ${c.cycleDays === 7 ? 'selected' : ''}>${t('settings.days7Short')}</option></select></label>
          <div class="field"><span>${t('settings.anchor')}</span>${dateField({ name: 'cycleAnchor', value: c.cycleAnchor, max: '' })}<span class="hint">${t('settings.anchorHint')}</span></div>
          <label class="field"><span>${t('settings.rateRule')}</span><select name="rateRule">${RULES.map((r) => html`<option value="${r}" data-sub="${t('rates.ruleSub.' + r)}" ${r === c.rateRule ? 'selected' : ''}>${t('rates.rule.' + r)}</option>`)}</select><span class="hint">${t('settings.rateRuleHint')}</span></label>
        </div>
        <label class="check"><input type="checkbox" name="marathiDigitsOnBill" ${c.marathiDigitsOnBill ? 'checked' : ''}> ${t('settings.mrDigits')}</label>
        <h2>${t('settings.messaging')}</h2>
        <div class="form-grid">
          <label class="field"><span>${t('settings.smsCap')}</span><input inputmode="numeric" name="smsCap" value="${c.smsCap}"><span class="hint">${t('settings.smsCapHint')}</span></label>
          <label class="field"><span>${t('settings.publicUrl')}</span><input type="text" name="publicBaseUrl" value="${c.publicBaseUrl}" placeholder="${location.origin}"><span class="hint">${t('settings.publicUrlHint')}</span></label>
        </div>
        <div class="note">${t('settings.secretsNote')}</div>
        <span class="err" role="alert"></span>
        <div class="actions"><button class="btn btn-primary btn-xl">${t('common.save')}</button></div>
      </form>
      <form class="card stack" data-site novalidate style="margin-top:16px">
        <div class="card-head"><h2>${t('settings.website')}</h2><a class="btn btn-sm btn-ghost" href="#/welcome">${t('settings.viewSite')} →</a></div>
        <p class="muted" style="margin:0">${t('settings.websiteNote')}</p>
        <div class="row" style="align-items:center;gap:16px">
          <div class="owner-photo-preview">${c.ownerPhoto ? html`<img src="${c.ownerPhoto}" alt="">` : html`<img src="./assets/img/cow-calf.png" alt="" class="logo-fallback">`}</div>
          <div class="stack" style="flex:1;min-width:220px">
            <label class="btn btn-ghost" style="align-self:flex-start">${t('settings.ownerPhoto')}<input type="file" accept="image/*" hidden data-photo></label>
            ${c.ownerPhoto ? html`<button type="button" class="link-btn" data-rm-photo style="align-self:flex-start">${t('settings.removePhoto')}</button>` : ''}
          </div>
        </div>
        <div class="form-grid">
          <label class="field"><span>${t('settings.ownerTitle')}</span><input type="text" name="ownerTitle" value="${c.ownerTitle || ''}"></label>
          <label class="field"><span>${t('settings.morningTime')}</span><span class="time-pair"><input type="time" name="morningFrom" value="${c.morningFrom}"><input type="time" name="morningTo" value="${c.morningTo}"></span></label>
          <label class="field"><span>${t('settings.eveningTime')}</span><span class="time-pair"><input type="time" name="eveningFrom" value="${c.eveningFrom}"><input type="time" name="eveningTo" value="${c.eveningTo}"></span></label>
        </div>
        <label class="field"><span>${t('settings.ownerMessage')}</span><textarea name="ownerMessage" rows="5" placeholder="${t('site.vision.default')}">${c.ownerMessage || ''}</textarea></label>
        <span class="err" role="alert"></span>
        <div class="actions"><button class="btn btn-primary">${t('common.save')}</button></div>
      </form>
      <section class="card stack" id="dashboard" style="margin-top:16px" data-dash>
        <div class="card-head"><h2>${t('settings.dash.title')}</h2><a class="btn btn-sm btn-ghost" href="#/dashboard">${t('nav.dashboard')} →</a></div>
        <p class="muted" style="margin:0">${t('settings.dash.sub')}</p>
        <ol class="dash-layout" data-dash-list></ol>
        <div class="row"><button type="button" class="btn btn-primary" data-dash-save>${t('common.save')}</button>
          <button type="button" class="btn btn-ghost" data-dash-reset>${t('settings.dash.reset')}</button></div>
      </section>
      <div class="grid-2" style="margin-top:16px">
        <section class="card stack"><h2>${t('settings.users')}</h2>
          <p class="muted" style="margin:0">${t('settings.usersMoved')}</p>
          <div><a class="btn btn-ghost" href="#/staff">${t('nav.staff')} →</a></div>
        </section>
        <section class="card stack"><h2>${t('settings.backup')}</h2>
          <p class="muted">${t('settings.backupNote')}</p>
          <div class="row"><button class="btn btn-ghost" data-backup>${t('settings.downloadBackup')}</button>
            <button class="btn btn-danger" data-reset>${t('settings.resetDemo')}</button></div>
        </section>
      </div>`);

    bindDateFields(el);
    // ---- dashboard layout (D-85): sections on / off and their order; cards inside a section on / off
    let { order, off } = dashLayout(c.dashboard);
    const drawDash = () => mount(el.querySelector('[data-dash-list]'), html`${order.map((id, i) => { const sec = DASH_SECTIONS.find((s) => s.id === id); return html`<li class="dl-item ${off.has(id) ? 'off' : ''}">
        <div class="dl-row"><label class="check"><input type="checkbox" data-dl="${id}" ${off.has(id) ? '' : 'checked'}> <b>${t('settings.dash.s.' + id)}</b></label>
          <span class="dl-move"><button type="button" class="btn btn-sm btn-ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="${t('settings.dash.up')}">↑</button><button type="button" class="btn btn-sm btn-ghost" data-down="${i}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="${t('settings.dash.down')}">↓</button></span></div>
        ${sec.items ? html`<div class="dl-sub">${sec.items.map(([sid]) => html`<label class="check"><input type="checkbox" data-dl="${sid}" ${off.has(sid) ? '' : 'checked'} ${off.has(id) ? 'disabled' : ''}> ${t('settings.dash.i.' + sid)}</label>`)}</div>` : ''}
        <p class="small muted dl-note">${t('settings.dash.n.' + id)}</p></li>`; })}`);
    drawDash();
    on(el, 'change', '[data-dl]', (_, cb) => { if (cb.checked) off.delete(cb.dataset.dl); else off.add(cb.dataset.dl); drawDash(); });
    on(el, 'click', '[data-up],[data-down]', (_, b) => { const i = Number(b.dataset.up ?? b.dataset.down); const j = b.dataset.up != null ? i - 1 : i + 1;
      [order[i], order[j]] = [order[j], order[i]]; drawDash(); el.querySelector(`[data-${b.dataset.up != null ? 'up' : 'down'}="${j}"]`)?.focus(); });
    on(el, 'click', '[data-dash-reset]', () => { ({ order, off } = dashLayout(null)); drawDash(); });
    on(el, 'click', '[data-dash-save]', async () => {
      try { await api.saveCenter({ dashboard: layoutToSave(order, off) }); toast(t('settings.dash.saved')); } catch (err) { toast(errorText(err), 'err'); }
    });
    on(el, 'submit', '[data-center]', async (e, f) => {
      e.preventDefault();
      try { await api.saveCenter(formData(f)); window.dispatchEvent(new Event('arag:center-changed')); toast(t('common.saved')); } catch (err) { $('.err', f).textContent = errorText(err); }
    });
    on(el, 'submit', '[data-site]', async (e, f) => {
      e.preventDefault();
      try { await api.saveCenter(formData(f)); toast(t('common.saved')); } catch (err) { $('.err', f).textContent = errorText(err); }
    });
    // Owner photo: shrink to 360 px JPEG in the browser, store as a data URL in center settings.
    el.querySelector('[data-photo]')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        await api.saveCenter({ ownerPhoto: await shrinkImage(file, 360) });
        toast(t('common.saved')); navigate('/settings');
      } catch (err) { toast(errorText(err), 'err'); }
    });
    on(el, 'click', '[data-rm-photo]', async () => { await api.saveCenter({ ownerPhoto: '' }); navigate('/settings'); });
    on(el, 'click', '[data-backup]', async () => download(`arag-backup-${todayIST()}.json`, await api.exportBackup(), 'application/json'));
    on(el, 'click', '[data-reset]', async () => {
      if (!await confirmBox(t('settings.resetConfirm'), { danger: true, okText: t('settings.resetDemo') })) return;
      await api.resetDemo(); await api.logout(); navigate('/login'); location.reload();
    });
  },
};

/** Resize an image file to a square-cropped JPEG data URL (keeps the stored settings small). */
function shrinkImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const cv = Object.assign(document.createElement('canvas'), { width: size, height: size });
      cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(Object.assign(new Error('invalid'), { code: 'invalid' }));
    img.src = URL.createObjectURL(file);
  });
}
