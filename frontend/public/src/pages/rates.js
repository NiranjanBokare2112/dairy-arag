// Rate charts: current chart per milk type, history, CSV export, rate checker.
// Two tabs (D-80): शेतकरी दरपत्रक (what we pay farmers) and डेअरी दरपत्रक (what the dairy pays us; gives the profit).
import { api } from '../api/index.js';
import { html, mount, $, on, download } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { empty, seg, bindSeg, toast, errorText, confirmBox } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { chartFor, chartToCsv, adjustChart, lookupRate } from '../lib/rates.js';
import { todayIST } from '../lib/dates.js';
import { parseTenths } from '../lib/qty.js';
import { toPaise } from '../lib/money.js';
import { navigate } from '../core/router.js';
import { dateField, bindDateFields } from '../core/datepicker.js';

export default {
  title: 'nav.rates',
  roles: ['owner'],
  async render(el, { center, query }) {
    const side = query.side === 'dairy' ? 'dairy' : 'farmer';
    const sq = side === 'dairy' ? '&side=dairy' : '';
    const charts = await api.charts({ side });
    const today = todayIST();
    const openFrom = side === 'dairy' ? '2000-01-01' : await api.firstOpenDate(); // the dairy chart never changes farmers' bills
    const current = { cow: chartFor(charts, 'cow', today), buffalo: chartFor(charts, 'buffalo', today) };
    mount(el, html`
      <div class="page-head"><h1>${t('nav.rates')}</h1>
        <div class="row"><a class="btn btn-primary" href="#/rates/new?type=cow${sq}">${icon('plus')} ${t('rates.newCow')}</a>
        <a class="btn btn-primary" href="#/rates/new?type=buffalo${sq}">${icon('plus')} ${t('rates.newBuffalo')}</a></div></div>
      <nav class="tabs">${['farmer', 'dairy'].map((k) => html`<a href="#/rates${k === 'dairy' ? '?side=dairy' : ''}" class="${k === side ? 'on' : ''}">${t('rates.side.' + k)}</a>`)}</nav>
      <div class="note" style="margin-bottom:16px"><div class="row-between"><span>${t('rates.sideNote.' + side)} ${t('rates.ruleNow', { rule: t('rates.rule.' + center.rateRule) })}</span><a class="btn btn-sm btn-ghost" href="#/settings">${t('nav.settings')} →</a></div></div>
      <form class="card stack change-rate" data-change novalidate style="margin-bottom:16px">
        <div><h2 style="margin:0">${t('rates.change.title')}</h2><p class="muted" style="margin:4px 0 0">${t(side === 'dairy' ? 'rates.change.subDairy' : 'rates.change.sub')}</p></div>
        <div class="change-grid">
          <div class="field"><span>${t('common.milk')}</span>${seg('milk', [['cow', t('milk.cow')], ['buffalo', t('milk.buffalo')], ['both', t('rates.change.both')]], 'both')}</div>
          <div class="field"><span>${t('rates.change.kind')}</span>${seg('dir', [['up', t('rates.change.up')], ['down', t('rates.change.down')]], 'up')}</div>
          <label class="field"><span>${t('rates.change.amount')}</span><input name="amount" inputmode="decimal" placeholder="1.00" style="max-width:160px"></label>
        </div>
        <div class="change-grid">
          <div class="field"><span>${t('rates.change.validity')}</span>${seg('validity', [['from', t('rates.change.fromDate')], ['day', t('rates.change.dayOnly')]], 'from')}</div>
          <div class="field"><span>${t('common.date')}</span>${dateField({ name: 'date', value: today, min: openFrom, max: '' })}</div>
        </div>
        ${side === 'farmer' ? html`<p class="small muted" style="margin:0">${t('rates.change.lockedNote', { date: fmt.date(openFrom) })}</p>` : ''}
        <div data-sample class="change-sample"></div>
        <label class="check" data-old-wrap><input type="checkbox" name="applyOld" checked> ${t('rates.change.applyOld')}</label>
        <div data-preview></div>
        <span class="err" role="alert"></span>
        <div><button class="btn btn-green btn-xl">${icon('check')} ${t('rates.change.save')}</button></div>
      </form>
      <div class="grid-2">
        ${['cow', 'buffalo'].map((m) => html`<section class="card">
          <div class="card-head"><h2>${fmt.milk(m)}</h2>${current[m] ? (current[m].effectiveTo ? html`<span class="tag tag-warn">${t('rates.onlyDay', { date: fmt.date(current[m].effectiveTo) })}</span>` : html`<span class="tag tag-green">${t('rates.inForceFrom', { date: fmt.date(current[m].effectiveFrom) })}</span>`) : html`<span class="tag tag-danger">${t('rates.noChart')}</span>`}</div>
          ${current[m] ? html`<p class="muted">${t('rates.range', { f1: fmt.tenths(current[m].fats[0]), f2: fmt.tenths(current[m].fats.at(-1)), s1: fmt.tenths(current[m].snfs[0]), s2: fmt.tenths(current[m].snfs.at(-1)) })}</p>
            <div class="row"><a class="btn btn-ghost" href="#/rates/${current[m].id}">${t('rates.view')}</a>${side === 'dairy' ? html`<span class="small muted">${t('rates.dairyVsFarmer', { d: fmt.rs(lookupRate(current[m], SAMPLE[m][0], SAMPLE[m][1], center.rateRule).ratePaise || 0), fat: fmt.tenths(SAMPLE[m][0]), snf: fmt.tenths(SAMPLE[m][1]) })}</span>` : ''}<button class="btn btn-ghost" data-csv="${current[m].id}">${icon('download', 18)} ${t('rates.export')}</button></div>` : ''}
        </section>`)}
      </div>
      <section class="card" style="margin-top:16px">
        <h2>${t('rates.checker')}</h2>
        <form class="row" id="check" style="align-items:end">
          ${seg('milk', [['cow', t('milk.cow')], ['buffalo', t('milk.buffalo')]], 'cow')}
          <label class="field" style="width:110px"><span>${t('common.fat')}</span><input name="fat" inputmode="decimal"></label>
          <label class="field" style="width:110px"><span>${t('common.snf')}</span><input name="snf" inputmode="decimal"></label>
          <div class="price" style="flex:1;min-width:200px"><div><small>${t('collection.rate')}</small><b id="chk">—</b></div></div>
        </form>
      </section>
      <section class="card" style="margin-top:16px">
        <h2>${t('rates.history')}</h2>
        ${charts.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>${t('common.milk')}</th><th>${t('rates.effectiveFrom')}</th><th>${t('rates.size')}</th><th>${t('rates.note')}</th><th>${t('rates.uploaded')}</th><th></th></tr></thead>
        <tbody>${charts.map((c) => html`<tr><td>${fmt.milk(c.milkType)}</td><td class="nowrap">${fmt.date(c.effectiveFrom)}${c.effectiveTo ? (c.effectiveTo === c.effectiveFrom ? html` <span class="tag tag-warn">${t('rates.oneDay')}</span>` : ` – ${fmt.date(c.effectiveTo)}`) : ''}
          ${current[c.milkType]?.id === c.id ? html`<span class="tag tag-green">${t('rates.current')}</span>` : c.effectiveFrom > today ? html`<span class="tag">${t('rates.upcoming')}</span>` : ''}</td>
          <td>${c.fats.length} × ${c.snfs.length}</td><td>${c.note}</td><td>${fmt.dateTime(c.createdAt)}</td>
          <td class="nowrap"><a class="btn btn-sm btn-ghost" href="#/rates/${c.id}">${t('rates.view')}</a> <button class="btn btn-sm btn-ghost" data-csv="${c.id}">CSV</button></td></tr>`)}</tbody></table></div>` : empty(t('rates.noChart'))}
      </section>`);
    bindSeg(el);
    on(el, 'click', '[data-csv]', (_, b) => {
      const c = charts.find((x) => x.id === b.dataset.csv);
      download(`rate-${c.milkType}-${c.effectiveFrom}.csv`, chartToCsv(c));
    });
    bindDateFields(el);
    bindChangeRate(el, { today, openFrom, rule: center.rateRule, side });
    $('#check', el).addEventListener('input', async () => {
      const f = $('#check', el);
      const q = await api.quote({ milkType: f.milk.value, date: today, litresX100: 100, fatX10: parseTenths(f.fat.value), snfX10: parseTenths(f.snf.value), side });
      $('#chk', el).textContent = q.ok ? fmt.rs(q.ratePaise) : (f.fat.value && f.snf.value ? (q.errors.rate ? t('err.rate-' + q.errors.rate) : t('collection.checkValues')) : '—');
    });
  },
};

// ---------- quick price change (owner) ----------
// Every rate of the chart in force on the chosen date is raised/lowered by the same ₹ per litre.
// "From this date onwards" = open-ended; "This day only" = effectiveTo = that date (previous rate returns next day).
// If the date is today or earlier, entries already recorded can be re-priced (finalized bills are never touched).
const SAMPLE = { cow: [40, 85], buffalo: [65, 90] }; // typical Fat/SNF for the example line

function bindChangeRate(el, { today, openFrom, rule, side }) {
  const form = el.querySelector('[data-change]');
  let seq = 0;

  async function plan() {
    const f = form;
    const milks = f.milk.value === 'both' ? ['cow', 'buffalo'] : [f.milk.value];
    const amt = toPaise(f.amount.value);
    const date = f.date.value;
    const effectiveTo = f.validity.value === 'day' ? date : null;
    if (!date || date < openFrom) return { error: date ? 'cycle-locked' : 'invalid' };
    if (!amt || amt <= 0) return { error: 'needAmount' };
    const delta = f.dir.value === 'down' ? -amt : amt;
    const items = [];
    for (const m of milks) {
      const base = await api.chartOn(m, date, side);
      if (!base) return { error: 'rate-no-chart' };
      const grid = adjustChart(base, delta);
      if (!grid.ok) return { error: grid.error };
      const [fx, sx] = SAMPLE[m];
      const a = lookupRate(base, fx, sx, rule); const b = lookupRate({ ...base, ...grid }, fx, sx, rule);
      items.push({ milkType: m, base, grid, effectiveFrom: date, effectiveTo, sample: a.ok && b.ok ? { fx, sx, old: a.ratePaise, now: b.ratePaise } : null });
    }
    return { items, delta, date, effectiveTo, past: date <= today };
  }

  async function refresh() {
    const my = ++seq;
    const p = await plan();
    if (my !== seq) return;
    const sampleEl = form.querySelector('[data-sample]'); const prevEl = form.querySelector('[data-preview]');
    form.querySelector('.err').textContent = '';
    form.querySelector('[data-old-wrap]').hidden = !(p.items && p.past) || side === 'dairy'; // the dairy chart never re-prices farmers' milk
    if (p.error) {
      mount(sampleEl, ''); mount(prevEl, '');
      if (p.error !== 'needAmount') form.querySelector('.err').textContent = t('err.' + p.error);
      return;
    }
    mount(sampleEl, html`${p.items.map((it) => it.sample ? html`<div>${t('rates.change.sample', { milk: fmt.milk(it.milkType), fat: fmt.tenths(it.sample.fx), snf: fmt.tenths(it.sample.sx) })}
      <b>${fmt.rs(it.sample.old)}</b> → <b class="${p.delta > 0 ? 'up' : 'down'}">${fmt.rs(it.sample.now)}</b></div>` : '')}`);
    const notes = [];
    if (!p.past) notes.push(t('rates.change.future', { date: fmt.date(p.date) }));
    if (p.effectiveTo) notes.push(t('rates.change.dayNote'));
    let impact = '';
    if (p.past && form.applyOld.checked && side === 'farmer') {
      let changed = 0, before = 0, after = 0, skipped = 0;
      for (const it of p.items) {
        const r = await api.previewRateChange({ milkType: it.milkType, effectiveFrom: it.effectiveFrom, effectiveTo: it.effectiveTo, ...it.grid });
        changed += r.changed; before += r.beforePaise; after += r.afterPaise; skipped += r.skipped;
      }
      if (my !== seq) return;
      impact = changed ? html`<div class="note">${t('rates.change.preview', { changed, before: fmt.rs(before), after: fmt.rs(after), diff: fmt.rs(after - before) })}
        ${skipped ? html`<br><span class="small">${t('rates.change.skipped', { n: skipped })}</span>` : ''}</div>` : html`<div class="note">${t('rates.change.noEntries')}</div>`;
    }
    mount(prevEl, html`${notes.map((n) => html`<p class="small muted" style="margin:0 0 6px">${n}</p>`)}${impact}`);
  }

  bindSeg(form);
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = await plan();
    if (p.error) { form.querySelector('.err').textContent = p.error === 'needAmount' ? t('rates.change.needAmount') : t('err.' + p.error); return; }
    const sign = p.delta > 0 ? '+' : '−';
    const what = `${p.items.map((i) => fmt.milk(i.milkType)).join(', ')}: ${sign}${fmt.rs(Math.abs(p.delta))} / ${t('unit.l')} · ${p.effectiveTo ? t('rates.change.onlyOn', { date: fmt.date(p.date) }) : t('rates.change.fromOn', { date: fmt.date(p.date) })}`;
    if (!await confirmBox(t('rates.change.confirm', { what }), { okText: t('rates.change.save') })) return;
    const reprice = p.past && form.applyOld.checked && side === 'farmer';
    try {
      let n = 0;
      for (const it of p.items) {
        const r = await api.saveChart({ side, milkType: it.milkType, effectiveFrom: it.effectiveFrom, effectiveTo: it.effectiveTo, ...it.grid,
          note: `${sign}${fmt.rsPlain(Math.abs(p.delta))}/${t('unit.l')}${it.effectiveTo ? ' · ' + t('rates.oneDay') : ''}`, reprice });
        n += r.repriced?.changed || 0;
      }
      toast(side === 'dairy' ? t('rates.saved') : t('rates.change.saved', { n }));
      navigate('/rates' + (side === 'dairy' ? '?side=dairy' : ''));
    } catch (err) { form.querySelector('.err').textContent = errorText(err); }
  });
  refresh();
}

