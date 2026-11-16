// New rate chart: import CSV (Excel → Save as CSV), or generate a grid and edit cells.
// Existing charts are view-only; a change is always saved as a new chart with a new effective date.
import { doneGoBack } from '../core/backnav.js';
import { api } from '../api/index.js';
import { html, mount, $, on, download } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { toast, errorText, confirmBox } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { parseChartCsv, chartToCsv, generateChart } from '../lib/rates.js';
import { toPaise, formatRupees } from '../lib/money.js';
import { parseTenths } from '../lib/qty.js';
import { todayIST, addDays } from '../lib/dates.js';
import { navigate } from '../core/router.js';
import { dateField, bindDateFields } from '../core/datepicker.js';

export default {
  title: 'nav.rates',
  roles: ['owner'],
  async render(el, { params, query }) {
    const existing = params.id ? await api.chart(params.id) : null;
    const milkType = existing?.milkType || (query.type === 'buffalo' ? 'buffalo' : 'cow');
    const side = existing?.side || (query.side === 'dairy' ? 'dairy' : 'farmer'); // D-80
    const list = side === 'dairy' ? '/rates?side=dairy' : '/rates';
    // Start from the latest chart of this type and side (a new dairy chart starts from the farmer chart if it has none).
    const base = existing || (await api.charts({ side })).find((c) => c.milkType === milkType) || (side === 'dairy' ? (await api.charts()).find((c) => c.milkType === milkType) : null) || null;
    let grid = base ? { fats: base.fats, snfs: base.snfs, rates: base.rates.map((r) => r.slice()) } : null;
    const ro = !!existing;
    const openFrom = side === 'dairy' ? '2000-01-01' : await api.firstOpenDate();

    const drawGrid = () => mount($('#grid', el), grid ? html`
      <div class="rate-grid-wrap"><table class="rate-grid">
        <thead><tr><th class="corner">${t('common.fat')} \\ ${t('common.snf')}</th>${grid.snfs.map((s) => html`<th>${fmt.tenths(s)}</th>`)}</tr></thead>
        <tbody>${grid.fats.map((f, i) => html`<tr><th>${fmt.tenths(f)}</th>${grid.rates[i].map((r, j) => ro
          ? html`<td><span>${r == null ? '' : formatRupees(r)}</span></td>`
          : html`<td><input data-i="${i}" data-j="${j}" inputmode="decimal" value="${r == null ? '' : formatRupees(r).replace(/,/g, '')}" aria-label="${t('common.fat')} ${fmt.tenths(f)} ${t('common.snf')} ${fmt.tenths(grid.snfs[j])}"></td>`)}</tr>`)}</tbody>
      </table></div><p class="small muted">${t('rates.gridSize', { r: grid.fats.length, c: grid.snfs.length })}</p>` : html`<div class="empty">${t('rates.noGridYet')}</div>`);

    mount(el, html`
      <div class="page-head"><div><span class="tag ${side === 'dairy' ? 'tag-green' : ''}">${t('rates.side.' + side)}</span>
        <h1 style="margin:4px 0 0">${ro ? t('rates.viewTitle', { milk: fmt.milk(milkType) }) : t('rates.newTitle', { milk: fmt.milk(milkType) })}</h1></div>
        <a class="btn btn-ghost" data-back href="#${list}">${icon('back')} ${t('common.back')}</a></div>
      ${ro ? html`<div class="note" style="margin-bottom:16px">${t('rates.readonlyNote', { date: fmt.date(existing.effectiveFrom) })}
        <div class="row" style="margin-top:8px"><a class="btn btn-sm btn-primary" href="#/rates/new?type=${milkType}${side === 'dairy' ? '&side=dairy' : ''}">${t('rates.newFromThis')}</a><button class="btn btn-sm btn-ghost" data-export>CSV</button></div></div>` : html`
      <div class="grid-2" style="margin-bottom:16px">
        <section class="card"><h2>${t('rates.importTitle')}</h2>
          <p class="muted small">${t('rates.importHelp')}</p>
          <label class="btn btn-ghost">${icon('upload', 18)} ${t('rates.chooseFile')}<input type="file" accept=".csv,text/csv,.txt" hidden data-file></label>
          <button class="link-btn" data-template>${t('rates.template')}</button>
        </section>
        <section class="card"><h2>${t('rates.generateTitle')}</h2>
          <form class="form-grid" data-gen style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))">
            <label class="field"><span>${t('rates.fatFrom')}</span><input name="fatFrom" inputmode="decimal" value="${milkType === 'cow' ? '3.0' : '5.0'}"></label>
            <label class="field"><span>${t('rates.fatTo')}</span><input name="fatTo" inputmode="decimal" value="${milkType === 'cow' ? '6.0' : '10.0'}"></label>
            <label class="field"><span>${t('rates.snfFrom')}</span><input name="snfFrom" inputmode="decimal" value="${milkType === 'cow' ? '7.5' : '8.0'}"></label>
            <label class="field"><span>${t('rates.snfTo')}</span><input name="snfTo" inputmode="decimal" value="${milkType === 'cow' ? '9.5' : '10.0'}"></label>
            <label class="field"><span>${t('rates.baseRate')}</span><input name="base" inputmode="decimal" value="${milkType === 'cow' ? '25.00' : '40.00'}"></label>
            <label class="field"><span>${t('rates.fatStep')}</span><input name="fstep" inputmode="decimal" value="${milkType === 'cow' ? '0.50' : '0.60'}"></label>
            <label class="field"><span>${t('rates.snfStep')}</span><input name="sstep" inputmode="decimal" value="0.30"></label>
            <div style="align-self:end"><button class="btn btn-ghost btn-block">${t('rates.generate')}</button></div>
          </form></section>
      </div>`}
      <section class="card">
        ${ro ? '' : html`<form class="stack" data-save style="margin-bottom:14px">
          <div class="row" style="align-items:end">
            <div class="field" style="min-width:240px"><span>${t('rates.effectiveFrom')} *</span>${dateField({ name: 'effectiveFrom', value: todayIST(), min: openFrom, max: '' })}</div>
            <label class="field" style="width:240px"><span>${t('rates.change.validity')}</span><select name="validity"><option value="from" data-sub="${t('rates.change.fromDateSub')}">${t('rates.change.fromDate')}</option><option value="day" data-sub="${t('rates.change.dayOnlySub')}">${t('rates.change.dayOnly')}</option></select></label>
            <label class="field" style="flex:1;min-width:200px"><span>${t('rates.note')}</span><input type="text" name="note" placeholder="${t('rates.notePh')}"></label>
          </div>
          ${side === 'farmer' ? html`<label class="check"><input type="checkbox" name="applyOld" checked> ${t('rates.change.applyOld')}</label>` : html`<p class="small muted" style="margin:0">${t('rates.dairyNoReprice')}</p>`}
          <div><button class="btn btn-green btn-xl">${t('rates.saveChart')}</button></div></form><span class="err" role="alert"></span>`}
        <div id="grid"></div>
      </section>`);
    drawGrid();
    bindDateFields(el);

    const err = (m) => { const e = $('.err', el); if (e) e.textContent = m; else toast(m, 'err'); };
    on(el, 'click', '[data-export]', () => download(`rate-${side}-${milkType}-${existing.effectiveFrom}.csv`, chartToCsv(existing)));
    on(el, 'click', '[data-template]', () => download(`rate-${milkType}-template.csv`, chartToCsv(grid || generateChart({ fatFrom: 30, fatTo: 32, snfFrom: 80, snfTo: 82, basePaise: 3000, fatStepPaise: 50, snfStepPaise: 30 }))));
    el.querySelector('[data-file]')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const r = parseChartCsv(await file.text());
      if (!r.ok) { err(t('rates.csvError', { line: r.line || '-', error: t('rates.csv.' + r.error) })); return; }
      grid = r; drawGrid(); toast(t('rates.imported'));
    });
    el.querySelector('[data-gen]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const v = { fatFrom: parseTenths(f.fatFrom.value), fatTo: parseTenths(f.fatTo.value), snfFrom: parseTenths(f.snfFrom.value), snfTo: parseTenths(f.snfTo.value),
        basePaise: toPaise(f.base.value), fatStepPaise: toPaise(f.fstep.value), snfStepPaise: toPaise(f.sstep.value) };
      if (Object.values(v).some((x) => x == null) || v.fatFrom > v.fatTo || v.snfFrom > v.snfTo || (v.fatTo - v.fatFrom + 1) * (v.snfTo - v.snfFrom + 1) > 5000) { toast(t('collection.checkValues'), 'err'); return; }
      grid = generateChart(v); drawGrid();
    });
    on(el, 'change', '.rate-grid input', (_, inp) => {
      const p = inp.value === '' ? null : toPaise(inp.value);
      inp.classList.toggle('invalid', inp.value !== '' && p == null);
      if (inp.value === '' || p != null) grid.rates[+inp.dataset.i][+inp.dataset.j] = p;
    });
    el.querySelector('[data-save]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!grid) { err(t('rates.noGridYet')); return; }
      if (el.querySelector('.rate-grid input.invalid')) { err(t('collection.checkValues')); return; }
      const f = e.target;
      const effectiveFrom = f.effectiveFrom.value;
      const effectiveTo = f.validity.value === 'day' ? effectiveFrom : null;
      const reprice = side === 'farmer' && f.applyOld?.checked && effectiveFrom <= todayIST();
      try {
        if (reprice) { // show what happens to milk already recorded before saving
          const r = await api.previewRateChange({ milkType, effectiveFrom, effectiveTo, ...grid });
          if (r.changed && !await confirmBox(t('rates.change.preview', { changed: r.changed, before: fmt.rs(r.beforePaise), after: fmt.rs(r.afterPaise), diff: fmt.rs(r.afterPaise - r.beforePaise) }), { okText: t('rates.saveChart') })) return;
        }
        const saved = await api.saveChart({ side, milkType, effectiveFrom, effectiveTo, note: f.note.value, ...grid, reprice });
        toast(reprice ? t('rates.change.saved', { n: saved.repriced?.changed || 0 }) : t('rates.saved')); doneGoBack(list);
      } catch (ex) { err(errorText(ex)); }
    });
  },
};
