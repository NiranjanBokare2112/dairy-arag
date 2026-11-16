// Audit log viewer (B2.4): who, when, what, before/after — with filters by person and type.
// #/audit?user=u-op1&type=login
import { api } from '../api/index.js';
import { rangeOf, filterCard, bindRangeBar, inRange } from '../core/rangebar.js';
import { todayIST } from '../lib/dates.js';
import { html, mount, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { empty } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { navigate } from '../core/router.js';

// Filter groups → audit actions
const TYPES = {
  login: ['login', 'logout', 'login-failed', 'farmer-login-failed'],
  entries: ['create', 'request', 'correct', 'approve', 'reject', 'reprice'],
  money: ['generate', 'finalize'],
  settings: ['update', 'change-pin'],
};
const TONE = { 'login-failed': 'tag-danger', 'farmer-login-failed': 'tag-danger', login: 'tag-green', logout: 'tag-grey', correct: 'tag-warn', reprice: 'tag-warn', reject: 'tag-danger', finalize: 'tag' };

/** One-line readable summary of a change (falls back to compact JSON). */
function summary(a) {
  const x = a.after || {};
  if (a.entity === 'collection' && x.litresX100 != null) return `${fmt.litres(x.litresX100)} ${t('unit.l')} · ${t('common.fat')} ${fmt.tenths(x.fatX10)} · ${t('common.snf')} ${fmt.tenths(x.snfX10)} · ${fmt.rs(x.amountPaise)}`;
  if (a.action === 'reprice') return `${fmt.rs(a.before?.amountPaise || 0)} → ${fmt.rs(x.amountPaise || 0)}`;
  if (a.entity === 'payment') return `${x.mode === 'upi' ? 'UPI' : t('payments.cash')} ${fmt.rs(x.amountPaise || 0)}`;
  if (a.entity === 'advance') return `${fmt.rs(x.amountPaise || 0)} · ${t('ledger.installment')} ${fmt.rs(x.installmentPaise || 0)}`;
  if (a.entity === 'feed-move') return `${x.qty} × ${fmt.rs(x.pricePaise || 0)}`;
  if (a.entity === 'rate-chart') return `${fmt.milk(x.milkType)} · ${fmt.date(x.effectiveFrom)}${x.effectiveTo ? ' – ' + fmt.date(x.effectiveTo) : ''}`;
  if (a.entity === 'user' && x.name) return `${x.name}${x.active === false ? ' · ' + t('staff.disabled') : ''}${x.pinChanged ? ' · ' + t('audit.pinChanged') : ''}`;
  if (x.count != null) return t('audit.count', { n: x.count });
  if (a.action === 'farmer-login-failed') return t('audit.farmerCodeTried', { code: x.code || '—' });
  if (x.ua) return '';
  const s = a.after ? JSON.stringify(a.after) : '';
  return s.length > 120 ? s.slice(0, 120) + '…' : s;
}

export default {
  title: 'nav.audit',
  roles: ['owner'],
  async render(el, { query }) {
    const type = TYPES[query.type] ? query.type : '';
    const today = todayIST();
    const range = rangeOf(query, today, '7'); // D-55
    const [allRows, people] = await Promise.all([api.audit({ userId: query.user || undefined, actions: TYPES[type], limit: 5000 }), api.staff()]);
    const rows = allRows.filter((a) => inRange(range, todayIST(new Date(a.at))));
    const uname = (id) => people.find((u) => u.id === id)?.name || id || '—';
    // farmer logins have no staff user: show the farmer (code + name), or the code that was tried
    const who = (a) => (a.userId ? uname(a.userId) : a.entity === 'farmer' ? `${t('audit.farmer')} ${a.after?.code ?? ''} ${a.after?.name ?? ''}`.trim() : '—');
    const label = (k, prefix) => { const s = t(prefix + k); return s === prefix + k ? k : s; };
    const go = (patch) => {
      const q = new URLSearchParams({ ...(query.user ? { user: query.user } : {}), ...(type ? { type } : {}), ...(query.range ? { range: query.range } : {}), ...(query.from ? { from: query.from, to: query.to } : {}), ...patch });
      for (const [k, v] of [...q]) if (!v) q.delete(k);
      navigate('/audit' + (q.toString() ? '?' + q : ''));
    };

    mount(el, html`<div class="page-head"><h1>${t('nav.audit')}</h1><a class="btn btn-ghost" href="#/staff">${t('nav.staff')} →</a></div>
      ${filterCard('/audit', query, range, { count: rows.length, unit: t('ledger.entries') }, { extra: html`<div class="filters">
        <label class="field"><span>${t('staff.person')}</span><select data-f="user"><option value="">${t('staff.everyone')}</option>${people.map((p) => html`<option value="${p.id}" data-sub="${t('role.' + p.role)}" ${p.id === query.user ? 'selected' : ''}>${p.name}</option>`)}</select></label>
        <label class="field"><span>${t('audit.type')}</span><select data-f="type"><option value="">${t('common.all')}</option>${Object.keys(TYPES).map((k) => html`<option value="${k}" ${k === type ? 'selected' : ''}>${t('audit.type.' + k)}</option>`)}</select></label>
      </div>` })}
      ${rows.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>${t('audit.when')}</th><th>${t('audit.who')}</th><th>${t('audit.action')}</th><th>${t('audit.what')}</th><th>${t('audit.details')}</th></tr></thead>
      <tbody>${rows.map((a) => html`<tr><td class="date-cell">${fmt.dateTime(a.at)}</td><td><b>${who(a)}</b></td>
        <td><span class="tag ${TONE[a.action] || 'tag-grey'}">${label(a.action, 'audit.a.')}</span></td><td>${label(a.entity, 'audit.e.')}</td>
        <td class="small cell-long">${summary(a)}</td></tr>`)}</tbody></table></div>
      <p class="small muted">${t('audit.shown', { n: rows.length })}</p>` : empty(t('audit.none'))}`);

    on(el, 'change', '[data-f]', (_, s) => go({ [s.dataset.f]: s.value }));
    bindRangeBar(el, '/audit', query, range, today);
  },
};
