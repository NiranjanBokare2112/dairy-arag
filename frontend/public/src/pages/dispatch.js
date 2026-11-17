// Dairy dispatch (A7.1): litres sent per shift & milk type, with Fat/SNF/rate and amount received.
import { api } from '../api/index.js';
import { html, mount, on, $ } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { toast, errorText, empty, seg, bindSeg } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { parseLitres, parseTenths } from '../lib/qty.js';
import { toPaise, amountFor } from '../lib/money.js';
import { todayIST, currentShift, addDays } from '../lib/dates.js';
import { navigate } from '../core/router.js';
import { dateField, bindDateFields } from '../core/datepicker.js';
import { rangeOf, filterCard, bindRangeBar } from '../core/rangebar.js';
import { pager, pgAttrs, bindPagers } from '../core/pager.js';

const PER_PAGE = 10; // पाठवणी नोंद: 10 rows a page, pager only when there are more (D-68)

export default {
  title: 'nav.dispatch',
  roles: ['owner', 'operator'],
  async render(el, { center, query = {} }) {
    const today = todayIST();
    const range = rangeOf(query, today, '7'); // list filter (D-55); the form's hint always looks at the form's own date
    const from = range.all ? undefined : range.from;
    const formFrom = from && from < addDays(today, -6) ? from : addDays(today, -6);
    const [rows, colls, sold] = await Promise.all([api.dispatches({ from, to: range.to }), api.collections({ from: range.all ? undefined : formFrom }), api.soldByShift({ from: range.all ? undefined : formFrom })]);
    const collected = (d, s, m) => colls.filter((c) => c.date === d && c.shift === s && c.milkType === m).reduce((a, c) => a + c.litresX100, 0);
    const soldAt = (d, s, m) => sold[`${d}|${s}|${m}`] || 0;

    mount(el, html`
      <div class="page-head"><h1>${t('nav.dispatch')}</h1></div>
      ${filterCard('/dispatch', query, range, { count: rows.length, unit: t('ledger.entries') })}
      <div class="grid-2 wide-right">
        <form class="card stack" novalidate><h2>${t('dispatch.new')}</h2>
          <div class="form-grid"><div class="field"><span>${t('common.date')}</span>${dateField({ name: 'date', value: today })}</div>
            <label class="field"><span>${t('dispatch.dairy')}</span><input type="text" name="dairyName" value="${center.dairyName || ''}"></label></div>
          <div class="row">${seg('shift', [['morning', t('shift.morning')], ['evening', t('shift.evening')]], currentShift())}${seg('milk', [['cow', t('milk.cow')], ['buffalo', t('milk.buffalo')]], 'cow')}</div>
          <div class="note" data-coll></div>
          <p class="small disp-fill" data-fill-note hidden></p>
          <div class="entry-row">
            <label class="field"><span>${t('collection.litres')} *</span><input name="litres" inputmode="decimal"></label>
            <label class="field"><span>${t('common.fat')}</span><input name="fat" inputmode="decimal"></label>
            <label class="field"><span>${t('common.snf')}</span><input name="snf" inputmode="decimal"></label></div>
          <div class="form-grid"><label class="field"><span>${t('dispatch.rate')} *</span><input name="rate" inputmode="decimal"><span class="hint" data-rate-hint></span></label>
            <label class="field"><span>${t('dispatch.received')}</span><input name="amount" inputmode="decimal"><span class="hint">${t('dispatch.receivedHint')}</span></label></div>
          <span class="err" role="alert"></span><button class="btn btn-primary btn-xl btn-block" data-save>${t('common.save')}</button></form>
        <section class="card"><h2>${t('dispatch.list')}</h2>
          ${rows.length ? html`<div class="table-wrap" data-pg-list="dispatch"><table class="tbl"><thead><tr><th>${t('common.date')}</th><th>${t('bill.shift')}</th><th class="num">${t('dispatch.collected')}</th><th class="num">${t('dispatch.soldHere')}</th><th class="num">${t('dispatch.sent')}</th><th class="num">${t('dispatch.shrink')}</th><th class="num">${t('common.amount')}</th></tr></thead>
          <tbody>${rows.map((d, i) => { const c = collected(d.date, d.shift, d.milkType); const sl = soldAt(d.date, d.shift, d.milkType); const diff = c - sl - d.litresX100; return html`<tr ${pgAttrs(i, PER_PAGE)}>
            <td>${fmt.date(d.date).slice(0, 5)}</td><td class="nowrap">${fmt.shift(d.shift)}<span class="sub"><span class="tag ${d.milkType === 'cow' ? 'tag-cow' : 'tag-buf'}">${fmt.milk(d.milkType)}</span></span></td><td class="num">${fmt.litres(c)}</td><td class="num">${sl ? fmt.litres(sl) : '—'}</td><td class="num">${fmt.litres(d.litresX100)}</td>
            <td class="num"><span class="${c && diff * 100 > c ? 'tag tag-danger' : ''}">${fmt.litres(diff)}</span></td><td class="num">${fmt.rsPlain(d.amountPaise)}</td></tr>`; })}</tbody></table></div>${pager('dispatch', rows.length, PER_PAGE)}
          <p class="small muted">${t('dispatch.shrinkNote2')}</p>` : empty(t('dispatch.none'))}
        </section></div>`);
    bindSeg(el);
    bindDateFields(el);
    bindPagers(el);
    bindRangeBar(el, '/dispatch', query, range, today);
    const form = $('form', el);
    const showColl = () => { $('[data-coll]', el).textContent = (() => { const a = [form.date.value, form.shift.value, form.milk.value]; const c = collected(...a); const sl = soldAt(...a); return sl ? t('dispatch.collectedHint2', { l: fmt.litres(c), s: fmt.litres(sl), r: fmt.litres(c - sl) }) : t('dispatch.collectedHint', { l: fmt.litres(c) }); })(); };
    form.addEventListener('change', showColl); showColl();
    // D-80: the dairy chart fills the rate from Fat / SNF (the owner can still type what the dairy actually paid)
    let autoRate = '';
    const fillRate = async () => {
      const fatX10 = parseTenths(form.fat.value); const snfX10 = parseTenths(form.snf.value);
      const hint = $('[data-rate-hint]', el);
      if (fatX10 == null || snfX10 == null || !form.fat.value || !form.snf.value) { hint.textContent = ''; return; }
      const q = await api.quote({ milkType: form.milk.value, date: form.date.value, litresX100: parseLitres(form.litres.value) || 100, fatX10, snfX10, side: 'dairy' });
      if (!q.ok) { hint.textContent = q.errors?.rate === 'no-chart' ? t('dispatch.noDairyChart') : ''; return; }
      const v = (q.ratePaise / 100).toFixed(2);
      if (!form.rate.value || form.rate.value === autoRate) { form.rate.value = v; autoRate = v; }
      hint.textContent = t('dispatch.chartRate', { r: fmt.rs(q.ratePaise) });
    };
    form.addEventListener('input', (e) => { if (['fat', 'snf', 'litres'].includes(e.target.name)) fillRate(); });

    // D-139: the form fills itself for the chosen date + shift + milk — a saved dispatch is shown for correction;
    // otherwise litres = collected − sold here, Fat/SNF = the litre-weighted average of what farmers poured in that
    // shift, rate = the dairy chart (else the last rate the dairy paid for that milk). Always to be checked against the slip.
    let existing = null;
    const fillForm = async () => {
      const d = form.date.value; const s = form.shift.value; const m = form.milk.value;
      const [disp, cl, sd, recent] = await Promise.all([api.dispatches({ from: d, to: d }), api.collections({ from: d, to: d }), api.soldByShift({ from: d, to: d }), api.dispatches({ to: d })]);
      existing = disp.find((x) => x.shift === s && x.milkType === m) || null;
      const note = $('[data-fill-note]', el); const btn = $('[data-save]', el);
      const tenth = (x) => (x == null ? '' : (x / 10).toFixed(1)); const rs = (p) => (p ? (p / 100).toFixed(2) : '');
      autoRate = '';
      if (existing) {
        form.litres.value = fmt.litres(existing.litresX100); form.fat.value = tenth(existing.fatX10); form.snf.value = tenth(existing.snfX10);
        form.rate.value = rs(existing.ratePaise); form.amount.value = rs(existing.amountPaise); if (existing.dairyName) form.dairyName.value = existing.dairyName;
        note.textContent = t('dispatch.alreadySaved'); note.className = 'small disp-fill saved'; note.hidden = false; btn.textContent = t('dispatch.saveChanges');
        $('[data-rate-hint]', el).textContent = '';
        return;
      }
      btn.textContent = t('common.save');
      const mine = cl.filter((c) => c.shift === s && c.milkType === m && !c.void);
      const litres = mine.reduce((a, c) => a + c.litresX100, 0); const sold = sd[`${d}|${s}|${m}`] || 0;
      const avg = (k) => (litres ? Math.round(mine.reduce((a, c) => a + c[k] * c.litresX100, 0) / litres) : null);
      form.litres.value = litres - sold > 0 ? fmt.litres(litres - sold) : '';
      form.fat.value = tenth(avg('fatX10')); form.snf.value = tenth(avg('snfX10')); form.amount.value = '';
      const last = recent.filter((x) => x.milkType === m && x.ratePaise).sort((a, b) => (a.date + a.shift < b.date + b.shift ? 1 : -1))[0];
      form.rate.value = last ? rs(last.ratePaise) : ''; autoRate = form.rate.value;
      await fillRate(); // the dairy chart's rate wins when there is one
      note.textContent = litres ? t('dispatch.autoFilled') : t('dispatch.noMilk'); note.className = 'small disp-fill'; note.hidden = false;
    };
    form.addEventListener('change', (e) => { if (['milk', 'date', 'shift'].includes(e.target.name)) fillForm(); });
    fillForm();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const litresX100 = parseLitres(form.litres.value); const ratePaise = toPaise(form.rate.value);
      try {
        if (litresX100 == null || ratePaise == null) throw { code: 'invalid' };
        await api.addDispatch({ date: form.date.value, shift: form.shift.value, milkType: form.milk.value, litresX100, fatX10: parseTenths(form.fat.value), snfX10: parseTenths(form.snf.value),
          ratePaise, amountPaise: form.amount.value ? toPaise(form.amount.value) : amountFor(litresX100, ratePaise), dairyName: form.dairyName.value, replace: !!existing });
        toast(t('common.saved')); navigate('/dispatch');
      } catch (err) { $('.err', form).textContent = errorText(err); }
    });
  },
};
