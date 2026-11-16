// 58 mm feed slip for one cattle-feed credit sale (D-64, D-65). The farmer hands it to the outside feed vendor and
// collects the feed; the center pays the vendor at month end. So the slip shows no prices, only item and quantity. Opens right after "विक्री जतन करा"
// so the operator can print it; also reachable from the print button on each row of अलीकडील विक्री (reprint).
import { api } from '../api/index.js';
import { html, mount } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import * as fmt from '../core/format.js';

const time = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));

export default {
  title: 'feedReceipt.title',
  layout: 'bare',
  roles: ['owner', 'operator'],
  async render(el, { params, query, center }) {
    const m = await api.feedMove(params.id);
    if (!m || m.type !== 'sale') throw Object.assign(new Error('not-found'), { code: 'not-found' });
    const [f, items] = await Promise.all([api.farmer(m.farmerId), api.feedItems()]);
    const item = items.find((i) => i.id === m.itemId);
    const isNew = query.new === '1';
    mount(el, html`
      <div class="doc-bar"><a class="btn btn-ghost" data-back href="#/ledger?tab=sale">${isNew ? t('feedReceipt.next') : html`${icon('back')} ${t('common.back')}`}</a>
        <button class="btn btn-primary" data-print autofocus>${icon('print')} ${t('common.print')}</button></div>
      ${isNew ? html`<p class="doc-note" role="status">${icon('check', 18)} ${t('feedReceipt.saved')}</p>` : ''}
      <div class="doc-stage" style="min-height:auto">
        <div class="receipt">
          <h3>${center.name}</h3>
          <div class="c">${t('brand.tagline')}</div>
          <div class="c">${t('common.mobileShort')} ${center.mobile}</div>
          <div class="hr"></div>
          <div class="c"><b>${t('feedReceipt.title')}</b></div>
          <div class="l"><span>${fmt.date(m.date)}</span><span>${m.createdAt ? time(m.createdAt) : ''}</span></div>
          <div class="l"><span>${t('common.code')} ${f.code}</span><span>${t('feedReceipt.no')} ${m.id.slice(0, 6).toUpperCase()}</span></div>
          <div><b>${f.name}</b></div>
          <div class="hr"></div>
          <div class="l"><span>${t('ledger.item')}</span><span>${t('ledger.qty')}</span></div>
          <div class="l big"><span>${item?.name || ''}</span><span>${m.qty} ${item?.unit || ''}</span></div>
          <div class="hr"></div>
          <div class="sign"><span>${t('feedReceipt.sign')}</span></div>
          <div class="hr"></div>
          <div class="c">${t('receipt.thanks')}</div>
        </div>
      </div>`);
    el.querySelector('[data-print]').addEventListener('click', () => window.print());
    el.querySelector('[data-print]').focus();
  },
};
