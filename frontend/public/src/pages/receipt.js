// 58 mm thermal receipt for one pour (A3.6). Prints via Android's print service / a
// Bluetooth printer app for now; direct Web Bluetooth (ESC/POS) can be added later.
import { api } from '../api/index.js';
import { html, mount } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import * as fmt from '../core/format.js';

export default {
  title: 'collection.receipt',
  layout: 'bare',
  roles: ['owner', 'operator'],
  async render(el, { params, center }) {
    const e = await api.collection(params.id);
    if (!e) throw Object.assign(new Error('not-found'), { code: 'not-found' });
    const f = await api.farmer(e.farmerId);
    mount(el, html`
      <div class="doc-bar"><a class="btn btn-ghost" data-back href="#/collection">${icon('back')} ${t('common.back')}</a>
        <button class="btn btn-primary" onclick="window.print()">${icon('print')} ${t('common.print')}</button></div>
      <div class="doc-stage" style="min-height:auto">
        <div class="receipt">
          <h3>${center.name}</h3>
          <div class="c">${t('brand.tagline')}</div>
          <div class="c">${t('common.mobileShort')} ${center.mobile}</div>
          <div class="hr"></div>
          <div class="l"><span>${fmt.date(e.date)}</span><span>${fmt.shift(e.shift)}</span></div>
          <div class="l"><span>${t('common.code')} ${f.code}</span><span>${fmt.milk(e.milkType)}</span></div>
          <div><b>${f.name}</b></div>
          <div class="hr"></div>
          <div class="l"><span>${t('collection.litres')}</span><span>${fmt.litres(e.litresX100)}</span></div>
          <div class="l"><span>${t('common.fat')}</span><span>${fmt.tenths(e.fatX10)}</span></div>
          <div class="l"><span>${t('common.snf')}</span><span>${fmt.tenths(e.snfX10)}</span></div>
          <div class="l"><span>${t('collection.rate')}</span><span>${fmt.rsPlain(e.ratePaise)}</span></div>
          <div class="hr"></div>
          <div class="l big"><span>${t('collection.amount')}</span><span>${fmt.rs(e.amountPaise)}</span></div>
          <div class="hr"></div>
          <div class="c">${t('receipt.thanks')}</div>
        </div>
      </div>`);
  },
};
