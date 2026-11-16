// Milk collection entry (A3): farmer code → litres, Fat, SNF → rate & amount auto-filled.
// Keyboard flow for speed: Enter moves to the next box; Enter on SNF saves.
import { keepInUrl } from '../core/backnav.js';
import { api } from '../api/index.js';
import { html, mount, on, $, $$ } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { seg, bindSeg, toast, errorText, modal, empty } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { parseLitres, parseTenths } from '../lib/qty.js';
import { todayIST, currentShift } from '../lib/dates.js';
import { uuid } from '../lib/uuid.js';
import { saveCollection, pendingCount, flush } from '../core/sync.js';
import { dateField, bindDateFields } from '../core/datepicker.js';

export default {
  title: 'nav.collection',
  roles: ['owner', 'operator'],
  async render(el, ctx) {
    const state = { date: ctx.query.date || todayIST(), shift: ctx.query.shift || currentShift(), farmer: null, milkType: null, entryId: uuid(), quote: null, rows: [], other: null };
    const farmers = await api.farmers();
    const byCode = new Map(farmers.map((f) => [String(f.code), f]));
    const fname = new Map(farmers.map((f) => [f.id, f]));

    mount(el, html`
      <div class="page-head">
        <h1>${t('nav.collection')}</h1>
        <div class="row">
          <div class="dp-inline">${dateField({ name: 'date', value: state.date, disabled: ctx.user.role !== 'owner' })}</div>
          <div class="seg-lg" data-shift>${seg('shift', [['morning', t('shift.morning')], ['evening', t('shift.evening')]], state.shift)}</div>
        </div>
      </div>
      <div id="pending"></div>
      <div class="entry">
        <form class="card entry-form stack" autocomplete="off" novalidate>
          <label class="field big"><span>${t('collection.farmerCode')}</span>
            <input name="code" inputmode="numeric" pattern="[0-9]*" enterkeyhint="next" autofocus aria-describedby="farmer-out"></label>
          <div id="farmer-out" class="farmer-found idle" aria-live="polite">${t('collection.typeCode')}</div>
          <div id="milk-pick"></div>
          <div class="entry-row">
            <label class="field big"><span>${t('collection.litres')}</span><input name="litres" inputmode="decimal" enterkeyhint="next" placeholder="0.00"></label>
            <label class="field big"><span>${t('common.fat')}</span><input name="fat" inputmode="decimal" enterkeyhint="next" placeholder="0.0"></label>
            <label class="field big"><span>${t('common.snf')}</span><input name="snf" inputmode="decimal" enterkeyhint="done" placeholder="0.0"></label>
          </div>
          <span class="err" id="entry-err" role="alert"></span>
          <div class="price">
            <div><small>${t('collection.rate')}</small><b id="q-rate">—</b></div>
            <div class="amt"><small>${t('collection.amount')}</small><b id="q-amt">—</b></div>
          </div>
          <button class="btn btn-green btn-xl btn-block" type="submit" id="save" disabled>${icon('check', 26)} ${t('collection.save')}</button>
          <p class="small muted" style="margin:0">${t('collection.keyboardHint')}</p>
        </form>
        <section class="card">
          <div class="card-head"><h2 id="list-title"></h2><div id="totals" class="row small"></div></div>
          <div id="list"></div>
        </section>
      </div>`);
    bindSeg(el);
    // Calendar: green dot on days that already have milk entries.
    bindDateFields(el, { marked: (from, to) => api.entryDates(from, to) });
    const form = $('form', el);
    const F = (n) => form.elements[n];

    const showPending = () => {
      const n = pendingCount();
      mount($('#pending', el), n ? html`<div class="note note-warn row-between" style="margin-bottom:12px"><span>${t('collection.pending', { n })}</span><button class="btn btn-sm btn-ghost" data-flush>${t('collection.sendNow')}</button></div>` : '');
    };

    async function drawList() {
      const rows = await api.collections({ date: state.date, shift: state.shift });
      state.rows = rows;
      const corr = await api.corrections({ status: 'pending' }).catch(() => []);
      const pendingIds = new Set(corr.map((c) => c.entryId));
      $('#list-title', el).textContent = t('collection.listTitle', { date: fmt.date(state.date), shift: fmt.shift(state.shift) });
      const tot = (m) => rows.filter((r) => r.milkType === m).reduce((a, r) => ({ l: a.l + r.litresX100, a: a.a + r.amountPaise }), { l: 0, a: 0 });
      const c = tot('cow'); const b = tot('buffalo');
      mount($('#totals', el), html`<span class="tag tag-cow">${t('milk.cow')} ${fmt.litres(c.l)} ${t('unit.l')}</span><span class="tag tag-buf">${t('milk.buffalo')} ${fmt.litres(b.l)} ${t('unit.l')}</span><b>${fmt.rs(c.a + b.a)}</b>`);
      mount($('#list', el), rows.length ? html`<div class="table-wrap"><table class="tbl">
        <thead><tr><th>${t('common.code')}</th><th>${t('common.name')}</th><th>${t('common.milk')}</th><th class="num">${t('unit.l')}</th><th class="num">${t('common.fat')}</th><th class="num">${t('common.snf')}</th><th class="num">${t('common.rate')}</th><th class="num">${t('common.amount')}</th><th></th></tr></thead>
        <tbody>${rows.map((r) => html`<tr>
          <td><b>${fname.get(r.farmerId)?.code}</b></td><td>${fname.get(r.farmerId)?.name}${r.correctedAt ? html` <span class="tag tag-warn">${t('collection.corrected')}</span>` : ''}</td>
          <td><span class="tag ${r.milkType === 'cow' ? 'tag-cow' : 'tag-buf'}">${fmt.milk(r.milkType)}</span></td><td class="num">${fmt.litres(r.litresX100)}</td><td class="num">${fmt.tenths(r.fatX10)}</td><td class="num">${fmt.tenths(r.snfX10)}</td>
          <td class="num">${fmt.rsPlain(r.ratePaise)}</td><td class="num"><b>${fmt.rsPlain(r.amountPaise)}</b></td>
          <td class="nowrap"><a class="btn btn-sm btn-ghost" href="#/receipt/${r.id}" title="${t('collection.receipt')}">${icon('print', 18)}<span class="sr-only">${t('collection.receipt')}</span></a>
            ${pendingIds.has(r.id) ? html`<span class="tag tag-warn">${t('collection.awaiting')}</span>` : html`<button class="btn btn-sm btn-ghost" data-fix="${r.id}">${t('collection.fix')}</button>`}</td>
        </tr>`)}</tbody></table></div>` : empty(t('collection.none')));
    }

    function setFarmer() {
      const code = F('code').value.trim();
      const f = byCode.get(code) || null;
      state.farmer = f;
      const out = $('#farmer-out', el);
      if (!code) { out.className = 'farmer-found idle'; out.textContent = t('collection.typeCode'); }
      else if (!f) { out.className = 'farmer-found missing'; out.textContent = t('collection.noFarmer', { code }); }
      else { out.className = 'farmer-found'; out.textContent = `${f.name} · ${f.village}`; }
      if (f && code !== state.other?.code) state.other = null; // a new code hides the "other milk too?" offer
      drawMilkPick();
      requote();
      if (f && f.milkTypes.length > 1) refreshFarmerRows(f); // another device may have saved this farmer's milk meanwhile
    }
    async function refreshFarmerRows(f) {
      const mine = await api.collections({ date: state.date, shift: state.shift, farmerId: f.id }).catch(() => null);
      if (!mine || state.farmer !== f) return;
      const key = (rows) => rows.filter((r) => r.farmerId === f.id).map((r) => r.id).sort().join();
      if (key(mine) === key(state.rows)) return;
      state.rows = [...state.rows.filter((r) => r.farmerId !== f.id), ...mine];
      drawMilkPick(); requote();
    }

    // Cow / buffalo (D-70). One milk type: shown, nothing to choose. Both: two big buttons with what is already
    // collected this shift. If one type is already in, the other is picked for you; if none, the operator must pick.
    function drawMilkPick() {
      const f = state.farmer; const box = $('#milk-pick', el);
      if (!f) { state.milkType = null; mount(box, state.other ? otherOffer() : ''); paintSave(); return; }
      if (f.milkTypes.length === 1) {
        state.milkType = f.milkTypes[0];
        mount(box, html`<div class="milk-only ${state.milkType}">${t('collection.onlyMilk', { m: fmt.milk(state.milkType) })}</div>`);
        paintSave(); return;
      }
      const done = new Map(state.rows.filter((r) => r.farmerId === f.id).map((r) => [r.milkType, r]));
      // the operator's own pick for this farmer stays; otherwise: the one type still missing, or nothing (must pick)
      if (state.pick !== f.id || !f.milkTypes.includes(state.milkType)) {
        const left = f.milkTypes.filter((m) => !done.has(m));
        state.milkType = done.size && left.length === 1 ? left[0] : null;
      }
      const note = done.size === 2 ? html`<p class="milk-note warn">${t('collection.bothDone')}</p>`
        : done.size === 1 && state.milkType ? html`<p class="milk-note">${t('collection.otherNext', { done: fmt.milk([...done.keys()][0]), l: fmt.litres([...done.values()][0].litresX100), next: fmt.milk(state.milkType) })}</p>`
        : !state.milkType ? html`<p class="milk-note ask">${t('collection.whichMilk')}</p>` : '';
      mount(box, html`<div class="milk-choose" role="radiogroup" aria-label="${t('common.milk')}">
        ${f.milkTypes.map((m) => html`<label class="milk-btn ${m} ${state.milkType === m ? 'on' : ''} ${done.has(m) ? 'done' : ''}">
          <input type="radio" name="milk" value="${m}" ${state.milkType === m ? 'checked' : ''}>
          <b>${fmt.milk(m)}</b><span>${done.has(m) ? t('collection.milkDone', { l: fmt.litres(done.get(m).litresX100) }) : t('collection.milkLeft')}</span></label>`)}
      </div>${note}`);
      paintSave();
    }
    const otherOffer = () => html`<div class="milk-other"><span>${t('collection.alsoOther', { name: state.other.name, m: fmt.milk(state.other.milkType) })}</span>
      <button type="button" class="btn btn-sm btn-primary" data-other>${t('collection.addOther', { m: fmt.milk(state.other.milkType) })}</button></div>`;
    /** The save button names the milk, so the operator sees what is being saved. */
    function paintSave() {
      const b = $('#save', el);
      mount(b, html`${icon('check', 26)} ${state.farmer && state.milkType ? t('collection.saveMilk', { m: fmt.milk(state.milkType) }) : t('collection.save')}`);
      b.classList.toggle('btn-buffalo', state.milkType === 'buffalo' && !!state.farmer);
    }

    let quoteSeq = 0;
    async function requote() {
      const seq = ++quoteSeq;
      const litresX100 = parseLitres(F('litres').value); const fatX10 = parseTenths(F('fat').value); const snfX10 = parseTenths(F('snf').value);
      const err = $('#entry-err', el);
      ['litres', 'fat', 'snf'].forEach((n) => F(n).classList.remove('invalid'));
      state.quote = null; $('#save', el).disabled = true;
      $('#q-rate', el).textContent = '—'; $('#q-amt', el).textContent = '—'; err.textContent = '';
      if (!state.farmer || !state.milkType || !F('litres').value || !F('fat').value || !F('snf').value) return;
      const q = await api.quote({ milkType: state.milkType, date: state.date, litresX100, fatX10, snfX10 });
      if (seq !== quoteSeq) return;
      if (!q.ok) {
        for (const k of ['litres', 'fat', 'snf']) if (q.errors[k]) F(k).classList.add('invalid');
        err.textContent = q.errors.rate ? t('err.rate-' + q.errors.rate) : t('collection.checkValues');
        return;
      }
      state.quote = { ...q, litresX100, fatX10, snfX10 };
      $('#q-rate', el).textContent = fmt.rs(q.ratePaise);
      $('#q-amt', el).textContent = fmt.rs(q.amountPaise);
      $('#save', el).disabled = false;
    }

    async function save() {
      if (!state.quote || !state.farmer || !state.milkType) return;
      const q = state.quote;
      const entry = { id: state.entryId, farmerId: state.farmer.id, date: state.date, shift: state.shift, milkType: state.milkType,
        litresX100: q.litresX100, fatX10: q.fatX10, snfX10: q.snfX10 };
      $('#save', el).disabled = true;
      try {
        const r = await saveCollection(entry);
        if (!r.queued) api.runOutbox().catch(() => {}); // D-73: the farmer's WhatsApp goes now (waits in the outbox if offline)
        toast(r.queued ? t('collection.queued') : t('collection.saved', { name: state.farmer.name, amt: fmt.rs(r.saved.amountPaise) }), r.queued ? 'warn' : 'ok');
        // a farmer with both milks: offer the other one with one tap (no retyping the code)
        const f = state.farmer; const saved = state.milkType;
        const other = f.milkTypes.find((m) => m !== saved && !state.rows.some((r) => r.farmerId === f.id && r.milkType === m));
        state.entryId = uuid(); state.farmer = null; state.pick = null; form.reset();
        state.other = !r.queued && other ? { code: String(f.code), name: f.name, milkType: other } : null;
        await drawList(); setFarmer(); F('code').focus();
        showPending();
      } catch (err) {
        if (err.code === 'duplicate') {
          const d = err.detail;
          $('#entry-err', el).textContent = t('collection.duplicate', { l: fmt.litres(d.litresX100), fat: fmt.tenths(d.fatX10), snf: fmt.tenths(d.snfX10) });
        } else $('#entry-err', el).textContent = errorText(err);
        $('#save', el).disabled = false;
      }
    }

    // events
    form.addEventListener('input', (e) => { if (e.target.name === 'code') setFarmer(); else requote(); });
    form.addEventListener('change', (e) => {
      if (e.target.name !== 'milk') return;
      state.milkType = e.target.value; state.pick = state.farmer?.id; drawMilkPick(); requote();
      F('litres').focus();
    });
    on(el, 'click', '[data-other]', () => {
      const o = state.other; if (!o) return;
      F('code').value = o.code; setFarmer(); state.milkType = o.milkType; state.pick = state.farmer?.id; drawMilkPick(); requote(); F('litres').focus();
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      e.preventDefault();
      // both-milk farmer with nothing picked yet: Enter on the code goes to the cow / buffalo buttons
      if (e.target.name === 'code' && state.farmer && !state.milkType) { $('.milk-btn input', el)?.focus(); return; }
      if (e.target.name === 'milk') { e.target.checked = true; e.target.dispatchEvent(new Event('change', { bubbles: true })); return; }
      const order = ['code', 'litres', 'fat', 'snf'];
      const i = order.indexOf(e.target.name);
      if (i >= 0 && i < order.length - 1) F(order[i + 1]).focus(); else save();
    });
    // date and shift live in the address (D-63): a receipt or Back returns to the same day and shift
    $('[name=date]', el).addEventListener('change', async (e) => { state.date = e.target.value; keepInUrl({ date: state.date }); await drawList(); drawMilkPick(); requote(); });
    $('[data-shift]', el).addEventListener('change', async (e) => { state.shift = e.target.value; keepInUrl({ shift: state.shift }); await drawList(); drawMilkPick(); requote(); });
    on(el, 'click', '[data-flush]', async () => { const r = await flush(); toast(t('collection.flushed', { n: r.sent })); showPending(); drawList(); });
    on(el, 'click', '[data-fix]', async (_, b) => {
      const entry = await api.collection(b.dataset.fix);
      const done = await correctionDialog(entry, fname.get(entry.farmerId), ctx.user.role === 'owner');
      if (done) { toast(ctx.user.role === 'owner' ? t('collection.fixApplied') : t('collection.fixRequested')); drawList(); }
    });

    showPending();
    drawList();
    paintSave();
  },
};

function correctionDialog(entry, farmer, isOwner) {
  return modal(html`
    <form>
      <div class="modal-head"><h2>${t('collection.fixTitle')}</h2><p class="muted" style="margin:4px 0 0">${farmer.code} · ${farmer.name} · ${fmt.date(entry.date)} ${fmt.shift(entry.shift)}</p></div>
      <div class="modal-body stack">
        ${isOwner ? '' : html`<div class="note">${t('collection.needsApproval')}</div>`}
        <div class="entry-row">
          <label class="field"><span>${t('collection.litres')}</span><input name="litres" inputmode="decimal" value="${fmt.litres(entry.litresX100)}"></label>
          <label class="field"><span>${t('common.fat')}</span><input name="fat" inputmode="decimal" value="${fmt.tenths(entry.fatX10)}"></label>
          <label class="field"><span>${t('common.snf')}</span><input name="snf" inputmode="decimal" value="${fmt.tenths(entry.snfX10)}"></label>
        </div>
        <label class="check"><input type="checkbox" name="void"> ${t('collection.voidEntry')}</label>
        <label class="field"><span>${t('collection.reason')}</span><input name="reason" type="text" required></label>
        <span class="err" role="alert"></span>
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary">${isOwner ? t('collection.applyFix') : t('collection.sendForApproval')}</button></div>
    </form>`, (d, close) => {
    const f = d.querySelector('form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.requestCorrection(entry.id, { litresX100: parseLitres(f.litres.value), fatX10: parseTenths(f.fat.value), snfX10: parseTenths(f.snf.value), voidEntry: f.void.checked, reason: f.reason.value.trim() });
        close(true);
      } catch (err) { d.querySelector('.err').textContent = errorText(err); }
    });
  });
}
