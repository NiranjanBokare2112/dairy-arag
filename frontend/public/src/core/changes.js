// How a requested change to a farmer's details is shown (D-108): "मोबाईल: 98XXXXXX01 → 97XXXXXX22".
import { html } from './dom.js';
import { t } from './i18n.js';
import * as fmt from './format.js';

const LABEL = {
  name: 'common.name', nameEn: 'farmers.nameEn', village: 'farmers.village', mobile: 'farmers.mobile', hasWhatsapp: 'farmers.hasWhatsapp', consent: 'farmers.consent',
  milkTypes: 'common.milk', upiId: 'farmers.upi', bankName: 'farmers.bankName', bankAccount: 'farmers.bankAccount', bankIfsc: 'cr.ifsc',
  active: 'farmers.active', payPref: 'po.when',
};
const prefText = (p) => (!p?.kind ? '—' : p.kind === 'day' ? t('po.pref.dayN', { n: p.day }) : t('po.pref.' + p.kind));

export const fieldLabel = (k) => t(LABEL[k] || k);
export function fieldValue(k, v) {
  if (k === 'payPref') return prefText(v);
  if (typeof v === 'boolean') return v ? t('common.yes') : t('cr.no');
  if (k === 'milkTypes') return (v || []).map((m) => fmt.milk(m)).join(', ') || '—';
  return v === '' || v === null || v === undefined ? '—' : String(v);
}
/** Table rows: field · before → after (before omitted when not known, e.g. on the farmer's own page). */
export function changeRows(fields, { before = true } = {}) {
  return Object.entries(fields).map(([k, x]) => html`<tr><th scope="row">${fieldLabel(k)}</th>
    ${before ? html`<td class="cr-before">${fieldValue(k, x.before)}</td><td class="cr-arrow" aria-hidden="true">→</td>` : ''}<td class="cr-after"><b>${fieldValue(k, x.after)}</b></td></tr>`);
}
export const byLine = (r) => (r.requestedByKind === 'farmer' ? t('cr.byFarmer') : t('cr.byOperator', { n: r.byName || '' }));
