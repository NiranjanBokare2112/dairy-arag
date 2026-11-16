// Farmer's own page (#/my) after logging in with the farmer code (D-47). Read-only.
// Always "now": today's milk, money (this bill period, unpaid bills, advance, feed), profile.
// Date filter like the dashboard (D-48): आज / ७ / १५ / ३० दिवस / सुरुवातीपासून / निवडक तारखा — kept in the URL
// (#/my?range=30, ?range=all, ?from=…&to=…); summary, chart, entries and bills follow it.
// Entries show date, shift, (milk type), litres, Fat, SNF — no rate or amount (owner request).
// Entries are grouped by BILL PERIOD (D-49): a header row per period (dates, litres, its bill and status) and two
// alternating colours; each bill card below has its period's colour, so entries and bills are visibly linked.
import { api } from '../api/index.js';
import { html, mount, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { stat, empty, waTag, toast, errorText, modal } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { openRangePicker } from '../core/datepicker.js';
import { dailyChart, bindDailyChart } from '../core/dailychart.js';
import * as fmt from '../core/format.js';
import { navigate } from '../core/router.js';
import { farmerTop, unseenCount } from './myshell.js'; // D-91: doctors and schemes are their own tabs
import { prefText } from './payouts.js'; // D-107
import { changeRows } from '../core/changes.js'; // D-108
import { todayIST } from '../lib/dates.js';
import { customRange, presetRange } from '../lib/ranges.js';
import { cycleFor, cycleKey } from '../lib/cycles.js';

const CHIPS = ['today', '7', '15', '30', 'all'];

const statusOf = (b) => {
  if (b.status !== 'final') return ['tag-grey', t('my.bill.draft')];
  if (b.payablePaise === 0) return ['tag-grey', t('my.bill.nothingDue')];
  if (b.paidPaise >= b.payablePaise) return ['tag-green', t('my.bill.paid', { d: b.lastPayment ? fmt.date(b.lastPayment.date) : '' })];
  if (b.paidPaise > 0) return ['tag-warn', t('my.bill.part', { v: fmt.rs(b.payablePaise - b.paidPaise) })];
  return ['tag-danger', t('my.bill.unpaid')];
};

/** URL query → what to ask for. Default: last 30 days. */
function rangeOf(query, today) {
  if (query.from || query.to) { const r = customRange(query.from, query.to, today); if (r) return { ...r, preset: 'custom' }; }
  if (query.range === 'all') return { all: true, preset: 'all' };
  const preset = CHIPS.includes(query.range) ? query.range : '30';
  return { ...presetRange(preset, today), preset };
}

export default {
  title: 'my.title',
  layout: 'bare',
  roles: ['farmer'],
  async render(el, { query = {} } = {}) {
    const today = todayIST();
    const want = rangeOf(query, today);
    const [d, schemes, po, myReqs] = await Promise.all([api.myDetails(want), api.schemes().catch(() => []), api.myPayouts().catch(() => null), api.myChangeRequests().catch(() => [])]); // po: D-107, myReqs: D-108
    const { farmer: f, center: c, balances: bal, summary: s, range } = d;
    const sumL = (rows) => rows.reduce((x, e) => x + e.litresX100, 0);
    const sumA = (rows) => rows.reduce((x, e) => x + e.amountPaise, 0);
    const owed = bal.advanceOutstandingPaise + bal.feedUnbilledPaise;
    const both = f.milkTypes.length > 1; // milk column only for farmers who pour cow and buffalo
    const milkTags = f.milkTypes.map((m) => html`<span class="tag ${m === 'cow' ? 'tag-cow' : 'tag-buf'}">${fmt.milk(m)}</span>`);
    const periodText = range.from === range.to ? fmt.date(range.from) : `${fmt.date(range.from)} – ${fmt.date(range.to)}`;
    const chip = (p) => html`<a class="chip-btn ${want.preset === p ? 'on' : ''}" href="#/my?range=${p}" ${want.preset === p ? html`aria-current="true"` : ''}>${t(p === 'all' ? 'my.range.all' : 'dash.range.' + p)}</a>`;
    const entryRow = (e) => html`<tr><td class="nowrap">${e.date === today ? t('dp.today') : fmt.date(e.date)}</td><td>${fmt.shift(e.shift)}</td>
      ${both ? html`<td><span class="tag ${e.milkType === 'cow' ? 'tag-cow' : 'tag-buf'}">${fmt.milk(e.milkType)}</span></td>` : ''}<td class="num"><b>${fmt.litres(e.litresX100)}</b></td>
      <td class="num">${fmt.tenths(e.fatX10)}</td><td class="num">${fmt.tenths(e.snfX10)}</td></tr>`;
    // --- bill-period groups (newest first, like the entries) and their colours ---
    const keyOf = (date) => cycleKey(cycleFor(date, c.cycleDays, c.cycleAnchor));
    const billOf = new Map(d.bills.map((b) => [`${b.start}_${b.end}`, b]));
    const groups = [];
    for (const e of d.entries) {
      const k = keyOf(e.date);
      let g = groups[groups.length - 1];
      if (!g || g.key !== k) { const [start, end] = k.split('_'); g = { key: k, start, end, rows: [] }; groups.push(g); }
      g.rows.push(e);
    }
    // colour by the period itself (alternating over every period on the page), so entries and bill cards always match
    const keys = [...new Set([...groups.map((g) => g.key), ...d.bills.map((b) => `${b.start}_${b.end}`)])].sort().reverse();
    const band = (k) => (keys.indexOf(k) % 2 ? 'band-b' : 'band-a');
    const curKey = keyOf(today);
    const cols = both ? 6 : 5;
    const groupHead = (g) => {
      const b = billOf.get(g.key);
      const [tone, label] = b ? statusOf(b) : ['', ''];
      return html`<tr class="grp"><th colspan="${cols}" scope="rowgroup">
        <span class="grp-dates">${fmt.date(g.start).slice(0, 5)} – ${fmt.date(g.end)}</span>
        ${g.key === curKey ? html`<span class="tag">${t('my.grp.current')}</span>` : ''}
        <span class="grp-sum">${t('my.grp.sum', { l: fmt.litres(g.rows.reduce((x, e) => x + e.litresX100, 0)), n: g.rows.length })}${g.start < range.from ? html` <i>(${t('my.grp.partial')})</i>` : ''}</span>
        ${b ? html`<span class="grp-bill">${t('my.grp.bill', { v: fmt.rs(b.payablePaise) })} <span class="tag ${tone}">${label}</span>
            ${b.token ? html`<a href="#/b/${b.token}">${t('my.viewBill')} →</a>` : ''}</span>`
          : html`<span class="grp-bill muted">${g.key === curKey ? t('my.grp.billLater') : t('my.grp.notYet')}</span>`}
      </th></tr>`;
    };
    // one card per bill period in the dates (newest first): the bill with its full breakdown, or the period so far
    const seeEntries = (k) => { const i = groups.findIndex((g) => g.key === k); return i < 0 ? '' : html`<button type="button" class="btn btn-ghost btn-sm" data-see-grp="${i}">${t('my.bl.seeEntries')} ↑</button>`; };
    const line = (label, v, cls = '') => html`<div class="bl ${cls}"><span>${label}</span><b>${v}</b></div>`;
    const periodCard = (k) => {
      const b = billOf.get(k); const g = groups.find((x) => x.key === k); const [start, end] = k.split('_');
      const head = (tag) => html`<div class="my-bill-top"><b>${fmt.date(start).slice(0, 5)} – ${fmt.date(end)}</b>${tag}</div>`;
      if (!b) {
        const cur = k === curKey;
        // the card is about the WHOLE period: for the current one use the period totals, not just the chosen dates
        const whole = cur && d.openCycle;
        const l = whole ? d.openCycle.litresX100 : g ? g.rows.reduce((x, e) => x + e.litresX100, 0) : 0;
        const a = whole ? d.openCycle.amountPaise : g ? g.rows.reduce((x, e) => x + e.amountPaise, 0) : 0;
        const n = whole ? d.openCycle.entries : g ? g.rows.length : 0;
        return html`<article class="my-bill ${band(k)}">${head(html`<span class="tag ${cur ? '' : 'tag-grey'}">${cur ? t('my.grp.current') : t('my.grp.notYet')}</span>`)}
          <div class="bl-list">${line(t('my.bl.milk'), t('my.grp.sum', { l: fmt.litres(l), n }))}
            ${line(cur ? t('my.bl.soFar') : t('my.bl.milkAmount'), fmt.rs(a))}</div>
          <p class="small muted" style="margin:0">${cur ? t('my.bl.curNote') : t('my.bl.pendingNote')}</p>${seeEntries(k)}</article>`;
      }
      const [tone, label] = statusOf(b); const due = b.payablePaise - b.paidPaise;
      return html`<article class="my-bill ${band(k)}">${head(html`<span class="tag ${tone}">${label}</span>`)}
        <div class="small muted">${fmt.litres(b.litresX100)} ${t('unit.l')} · ${t('common.fat')} ${fmt.hundredths(b.avgFatX100)} · ${t('common.snf')} ${fmt.hundredths(b.avgSnfX100)}</div>
        <div class="bl-list">
          ${line(t('my.bl.milkAmount'), fmt.rs(b.grossPaise))}
          ${b.feedPaise ? line(t('my.bl.feed'), '− ' + fmt.rs(b.feedPaise), 'minus') : ''}
          ${b.advancePaise ? line(t('my.bl.advance'), '− ' + fmt.rs(b.advancePaise), 'minus') : ''}
          ${b.previousDuesPaise ? line(t('my.bl.prevDues'), '− ' + fmt.rs(b.previousDuesPaise), 'minus') : ''}
          ${line(t('my.bl.payable'), fmt.rs(b.payablePaise), 'total')}
          ${b.paidPaise ? line(t('my.bl.paid', { d: b.lastPayment ? fmt.date(b.lastPayment.date) : '', m: b.lastPayment ? (b.lastPayment.mode === 'upi' ? 'UPI' : t('payments.cash')) : '' }), fmt.rs(b.paidPaise), 'paid') : ''}
          ${due > 0 && b.status === 'final' ? line(t('my.bl.due'), fmt.rs(due), 'due') : ''}
          ${b.carryForwardDuesPaise ? line(t('my.bl.carry'), fmt.rs(b.carryForwardDuesPaise), 'due') : ''}
        </div>
        <div class="row">${b.token ? html`<a class="btn btn-ghost btn-sm" href="#/b/${b.token}">${t('my.viewBill')} →</a>` : ''}${seeEntries(k)}</div>
      </article>`;
    };
    // D-104: the entries table shows ONE bill period at a time (newest first); ‹ नवीन · [period ▾] · जुना › switches
    const groupBody = (g, i) => html`<tbody class="${band(g.key)}" data-grp="${i}" ${i ? 'hidden' : ''}>${groupHead(g)}${g.rows.map(entryRow)}</tbody>`;
    const grpLabel = (g) => { const b = billOf.get(g.key); const st = g.key === curKey ? t('my.grp.current') : b ? statusOf(b)[1] : t('my.grp.notYet');
      return `${fmt.date(g.start).slice(0, 5)} – ${fmt.date(g.end)} · ${st}`; };
    const grpPager = groups.length > 1 ? html`<div class="grp-pager" data-grp-pager>
      <button type="button" class="btn btn-ghost btn-sm" data-grp-go="-1" disabled>‹ ${t('my.grp.newer')}</button>
      <label class="grp-pick"><span class="sr-only">${t('my.grp.pick')}</span><select data-grp-pick aria-label="${t('my.grp.pick')}">
        ${groups.map((g, i) => html`<option value="${i}">${grpLabel(g)}</option>`)}</select></label>
      <button type="button" class="btn btn-ghost btn-sm" data-grp-go="1">${t('my.grp.older')} ›</button>
      <span class="grp-count small muted" aria-live="polite">${t('my.grp.of', { i: 1, n: groups.length })}</span>
    </div>` : '';

    mount(el, html`
      <div class="my">
        ${farmerTop(c, 'home', { newSchemes: unseenCount(schemes) })}

        <section class="my-hello card">
          <div class="avatar big" aria-hidden="true">${f.name.trim().charAt(0)}</div>
          <div class="my-who">
            <h1>${t('my.hello', { name: f.name })}</h1>
            <div class="row small muted">${t('common.code')} <b>${f.code}</b> · ${f.village} ${milkTags}</div>
          </div>
        </section>

        <div class="my-cols"><div class="my-main">
        <section class="card my-o1">
          <h2>${t('my.today')} <span class="muted small">${fmt.date(today)}</span></h2>
          ${d.today.length ? html`<div class="my-today">${d.today.map((e) => html`<div class="my-pour">
              <div class="my-pour-top"><b>${fmt.shift(e.shift)}</b> <span class="tag ${e.milkType === 'cow' ? 'tag-cow' : 'tag-buf'}">${fmt.milk(e.milkType)}</span></div>
              <div class="my-pour-l">${fmt.litres(e.litresX100)} <small>${t('unit.l')}</small></div>
              <div class="small muted">${t('common.fat')} ${fmt.tenths(e.fatX10)} · ${t('common.snf')} ${fmt.tenths(e.snfX10)} · ${fmt.rs(e.ratePaise)}/${t('unit.l')}</div>
              <div class="my-pour-a">${fmt.rs(e.amountPaise)}</div></div>`)}
            </div>
            <p class="my-total">${t('my.todayTotal', { l: fmt.litres(sumL(d.today)), a: fmt.rs(sumA(d.today)) })}</p>`
          : empty(t('my.noMilkToday'))}
        </section>
        <section class="card my-o4 dash-filter my-filter" aria-label="${t('dash.filter')}">
          <h2>${t('my.history')}</h2>
          <div class="chips" role="group" aria-label="${t('dash.filter')}">
            ${CHIPS.map(chip)}
            <button type="button" class="chip-btn ${want.preset === 'custom' ? 'on' : ''}" data-custom aria-haspopup="dialog" aria-expanded="false">${t('dash.range.custom')}</button>
          </div>
          <p class="dash-period"><b>${periodText}</b> <span class="muted">· ${t('dash.days', { n: range.days })}${range.all ? ' · ' + t('my.sinceFirst') : ''}</span></p>
        </section>
        <section class="card my-o5">
          <h2>${t('my.summary')}</h2>
          <div class="stats">
            ${stat(t('my.total'), `${fmt.litres(s.litresX100)} ${t('unit.l')}`, t('my.milkDays', { n: s.milkDays, d: range.days }), 'blue')}
            ${stat(t('my.perDay'), `${fmt.litres(s.avgPerDayX100)} ${t('unit.l')}`, t('my.entriesN', { n: s.entries }))}
            ${stat(t('my.fatSnf'), `${fmt.hundredths(s.avgFatX100)} / ${fmt.hundredths(s.avgSnfX100)}`, t('my.weighted'))}
            ${stat(t('my.earned'), fmt.rs(s.amountPaise), s.litresX100 ? t('my.avgRate', { v: fmt.rs(s.avgRatePaise) }) : '')}
          </div>
          ${range.days > 1 ? html`<div style="margin-top:14px">${dailyChart(d.trend, { today })}</div>` : ''}
        </section>
        <section class="card my-o6">
          <h2 id="my-entries">${t('my.entries')} <span class="muted small">(${d.entries.length})</span></h2>
          ${d.entries.length ? html`${grpPager}
            <div class="table-wrap"><table class="tbl my-entries" data-entries>
            <thead><tr><th>${t('common.date')}</th><th>${t('my.shift')}</th>${both ? html`<th>${t('common.milk')}</th>` : ''}<th class="num">${t('unit.l')}</th>
              <th class="num">${t('common.fat')}</th><th class="num">${t('common.snf')}</th></tr></thead>
            ${groups.map(groupBody)}</table></div>`
          : empty(t('my.noEntriesRange'))}
        </section>
        </div><aside class="my-side">
        <section class="card my-o2">
          <h2>${t('my.money')}</h2>
          <div class="stats">
            ${d.openCycle ? stat(t('my.thisPeriod', { a: fmt.date(d.openCycle.start).slice(0, 5), b: fmt.date(d.openCycle.end).slice(0, 5) }), fmt.rs(d.openCycle.amountPaise),
              t('my.thisPeriodSub', { l: fmt.litres(d.openCycle.litresX100) }), 'blue') : ''}
            ${stat(t('my.unpaid'), fmt.rs(bal.unpaidPaise), bal.unpaidPaise ? t('my.unpaidSub') : t('my.allPaid'), bal.unpaidPaise ? 'warn' : 'good')}
            ${stat(t('my.advance'), fmt.rs(bal.advanceOutstandingPaise), bal.advanceInstallmentPaise ? t('my.advanceSub', { v: fmt.rs(bal.advanceInstallmentPaise) }) : '')}
            ${stat(t('my.feed'), fmt.rs(bal.feedUnbilledPaise), t('my.feedSub'))}
          </div>
          ${owed ? html`<p class="small muted" style="margin:10px 0 0">${t('my.owedNote', { v: fmt.rs(owed) })}</p>` : ''}
        </section>
        ${po ? html`<section class="card my-o3 my-po" id="my-upi">
          <h2>${icon('wallet', 22)} ${t('my.po.title')}</h2>
          <div class="my-po-grid">
            <div class="my-po-upi"><small>${t('my.po.upi')}</small><b>${po.upiMasked || '—'}</b>
              <span class="tag ${po.verified ? 'tag-green' : 'tag-grey'}">${po.verified ? t('my.po.verified') : t('my.po.notVerified')}</span></div>
            <form class="my-po-pref" data-po-pref>
              <span class="my-po-q">${t('my.po.when')}</span>
              ${po.canChoose ? html`<div class="my-po-kinds" role="radiogroup">${['daily', 'bill', 'day', 'month-end'].map((k) => html`<label class="my-po-kind ${po.pref.kind === k ? 'on' : ''}">
                  <input type="radio" name="kind" value="${k}" ${po.pref.kind === k ? 'checked' : ''}><span>${t('po.pref.' + k)}</span></label>`)}</div>
                <label class="field my-po-day" data-po-day ${po.pref.kind === 'day' ? '' : 'hidden'}><span>${t('po.dayOfMonth')}</span>
                  <select name="day">${Array.from({ length: 28 }, (_, i) => i + 1).map((n) => html`<option value="${n}" ${po.pref.day === n ? 'selected' : ''}>${t('po.dayN', { n })}</option>`)}</select></label>
                <button class="btn btn-primary btn-sm" data-po-save hidden>${t('my.po.save')}</button>`
              : html`<b>${prefText(po.pref)}</b><p class="small muted" style="margin:4px 0 0">${t('my.po.ownerSets')}</p>`}
            </form>
          </div>
          ${po.pendingPref ? html`<p class="note note-warn my-po-pending">${t('cr.myPendingPref', { p: prefText(po.pendingPref) })}</p>` : ''}
          <p class="my-po-next ${po.on ? '' : 'muted'}">${!po.on ? t('my.po.off') : po.pref.kind === 'bill' ? t('my.po.onBill') : po.pref.kind === 'approval' ? t('my.po.onApproval') : html`${icon('clock', 16)} ${t('my.po.next', { d: fmt.date(po.next) })} · <span class="small muted">${po.lagDays ? t('my.po.lag1') : t('my.po.lag0')}</span>`}</p>
          <h3 class="my-po-sub">${t('my.po.recent')}</h3>
          ${po.payouts.length ? html`<div class="my-po-list">${po.payouts.map((x) => html`<div class="my-po-row">
              <span class="nowrap">${fmt.date(x.date)}</span><b>${fmt.rs(x.creditPaise)}</b>
              <span class="tag ${x.status === 'success' ? 'tag-green' : x.status === 'failed' ? 'tag-danger' : 'tag-warn'}">${t('po.st.' + x.status)}</span>
              <span class="small muted">${x.ref ? 'UTR ' + x.ref : ''}</span></div>`)}</div>` : html`<p class="small muted" style="margin:0">${t('my.po.none')}</p>`}
        </section>` : ''}
        <section class="card my-o7">
          <h2>${t('my.bills')} <span class="muted small">(${t('my.periodsN', { n: keys.length })})</span></h2>
          ${keys.length ? html`<div class="my-bills">${keys.map(periodCard)}</div>` : empty(t('my.noBillsRange'))}
        </section>
        <section class="card my-o8 my-profile">
          <h2>${t('my.profile')}</h2>
          <dl>
            <dt>${t('farmers.mobile')}</dt><dd>${f.mobileMasked || '—'} ${f.hasWhatsapp ? waTag() : html`<span class="tag tag-grey">SMS</span>`}</dd>
            <dt>UPI</dt><dd>${f.upiMasked || '—'}</dd>
            ${f.aadhaarLast4 ? html`<dt>${t('farmers.aadhaar')}</dt><dd>XXXX XXXX ${f.aadhaarLast4}</dd>` : ''}
            <dt>${t('my.hours')}</dt><dd>${t('my.hoursVal', { a: c.morningFrom, b: c.morningTo, c: c.eveningFrom, d: c.eveningTo })}</dd>
          </dl>
          <button type="button" class="btn btn-ghost" data-ask-change>${icon('edit', 18)} ${t('cr.askBtn')}</button>
          <p class="small muted">${t('cr.askNote')} <a href="tel:${c.mobile}"><b>${c.mobile}</b></a></p>
          ${myReqs.length ? html`<h3 class="my-po-sub">${t('cr.myRequests')}</h3><div class="stack my-reqs">${myReqs.map((r) => html`<div class="cr-box">
            <div class="row"><span class="tag ${r.status === 'approved' ? 'tag-green' : r.status === 'rejected' ? 'tag-danger' : 'tag-warn'}">${t('cr.st.' + r.status)}</span>
              <span class="small muted">${fmt.dateTime(r.requestedAt)}</span></div>
            <table class="cr-tbl"><tbody>${changeRows(r.fields, { before: false })}</tbody></table></div>`)}</div>` : ''}
        </section>
        </aside></div>
      </div>`);

    bindDailyChart(el);
    // D-108: the farmer asks to change contact / bank details; the owner approves
    on(el, 'click', '[data-ask-change]', async () => {
      const done = await modal(html`<form novalidate>
        <div class="modal-head"><h2>${t('cr.askTitle')}</h2><p class="muted" style="margin:4px 0 0">${t('cr.askSub')}</p></div>
        <div class="modal-body stack">
          <div class="form-grid">
            <label class="field"><span>${t('farmers.mobile')}</span><input name="mobile" type="tel" inputmode="tel" maxlength="10" placeholder="${f.mobileMasked || ''}"></label>
            <label class="field"><span>${t('farmers.upi')}</span><input name="upiId" type="text" autocomplete="off" placeholder="${f.upiMasked || 'name@upi'}"></label>
          </div>
          <label class="check"><input type="checkbox" name="wa" ${f.hasWhatsapp ? 'checked' : ''}> ${t('farmers.hasWhatsapp')}</label>
          <div class="form-grid">
            <label class="field"><span>${t('farmers.bankName')}</span><input name="bankName" type="text"></label>
            <label class="field"><span>${t('farmers.bankAccount')}</span><input name="bankAccount" inputmode="numeric"></label>
            <label class="field"><span>IFSC</span><input name="bankIfsc" type="text" autocomplete="off"></label>
          </div>
          <label class="field"><span>${t('cr.why')}</span><input name="note" type="text" maxlength="300" placeholder="${t('cr.whyPh')}"></label>
          <span class="err" role="alert"></span>
        </div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary">${t('cr.sendForApproval')}</button></div>
      </form>`, (dlg, close) => {
        const fm = dlg.querySelector('form');
        fm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const v = (n) => fm.elements[n].value.trim();
          const fields = { mobile: v('mobile').replace(/\D/g, ''), upiId: v('upiId'), bankName: v('bankName'), bankAccount: v('bankAccount').replace(/\s/g, ''), bankIfsc: v('bankIfsc') };
          if (fm.wa.checked !== !!f.hasWhatsapp) fields.hasWhatsapp = fm.wa.checked;
          try { await api.requestMyChange({ fields, note: v('note') }); close(true); }
          catch (err) { dlg.querySelector('.err').textContent = errorText(err); }
        });
      });
      if (done) { toast(t('cr.sentFarmer')); navigate('/my?cr=' + Date.now()); }
    });
    // D-107: the farmer picks when they want their money
    const pf = el.querySelector('[data-po-pref]');
    if (pf && po?.canChoose) {
      const sync = () => {
        const kind = pf.querySelector('[name=kind]:checked')?.value;
        pf.querySelectorAll('.my-po-kind').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
        pf.querySelector('[data-po-day]').hidden = kind !== 'day';
        const changed = kind !== po.pref.kind || (kind === 'day' && Number(pf.day.value) !== po.pref.day);
        pf.querySelector('[data-po-save]').hidden = !changed;
      };
      pf.addEventListener('change', sync);
      pf.addEventListener('submit', async (e) => {
        e.preventDefault();
        const kind = pf.querySelector('[name=kind]:checked').value;
        try { await api.setMyPayPref(kind === 'day' ? { kind, day: Number(pf.day.value) } : { kind }); toast(t('cr.sentFarmer')); navigate('/my?po=' + Date.now()); }
        catch (err) { toast(errorText(err), 'warn'); }
      });
    }
    on(el, 'click', '[data-custom]', (_, b) => openRangePicker(b, {
      from: range.from, to: range.to, title: t('dash.range.custom'),
      onApply: (r) => { const x = customRange(r.from, r.to, today); if (x) navigate(`/my?from=${x.from}&to=${x.to}`); },
    }));
    const showGrp = (i) => {
      const n = groups.length; i = Math.max(0, Math.min(n - 1, i));
      el.querySelectorAll('[data-grp]').forEach((tb) => { tb.hidden = Number(tb.dataset.grp) !== i; });
      const pg = el.querySelector('[data-grp-pager]'); if (!pg) return;
      pg.querySelector('[data-grp-go="-1"]').disabled = i === 0;
      pg.querySelector('[data-grp-go="1"]').disabled = i === n - 1;
      const sel = pg.querySelector('[data-grp-pick]'); sel.value = String(i); sel.dispatchEvent(new Event('change')); // not bubbling: updates the styled dropdown only
      pg.querySelector('.grp-count').textContent = t('my.grp.of', { i: i + 1, n });
    };
    const curGrp = () => Number(el.querySelector('[data-grp-pick]')?.value || 0);
    on(el, 'click', '[data-grp-go]', (_, b) => showGrp(curGrp() + Number(b.dataset.grpGo)));
    on(el, 'change', '[data-grp-pick]', (_, sel) => showGrp(Number(sel.value)));
    on(el, 'click', '[data-see-grp]', (_, b) => { showGrp(Number(b.dataset.seeGrp)); el.querySelector('#my-entries')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  },
};
