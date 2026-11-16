// Cattle feed & advance ledger (A4): feed credit sale, advance (उचल), stock in, feed items.
import { api } from '../api/index.js';
import { html, mount, $, on } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { toast, errorText, empty, stat } from '../core/ui.js';
import * as fmt from '../core/format.js';
import { toPaise } from '../lib/money.js';
import { todayIST } from '../lib/dates.js';
import { navigate } from '../core/router.js';
import { dateField, bindDateFields } from '../core/datepicker.js';
import { rangeOf, filterCard, bindRangeBar, inRange, newestFirst } from '../core/rangebar.js';

const TABS = ['sale', 'advance', 'stock'];

export default {
  title: 'nav.ledger',
  roles: ['owner', 'operator'],
  async render(el, { query, user }) {
    const tab = TABS.includes(query.tab) ? query.tab : 'sale';
    const isOwner = user.role === 'owner';
    const [farmers, items] = await Promise.all([api.farmers(), api.feedItems()]);
    const byId = new Map(farmers.map((f) => [f.id, f]));
    const byCode = new Map(farmers.map((f) => [String(f.code), f]));
    const itemName = (id) => items.find((i) => i.id === id)?.name || '';
    // every list: date filter (D-55), newest first; sales default to the last 30 days, advances and stock to everything
    const today = todayIST();
    const range = rangeOf(query, today, tab === 'sale' ? '30' : 'all');
    let listCount = 0; // shown on the filter card (D-66)
    const bar = (rows, amountKey) => { listCount = rows.length;
      return rows.length ? html`<p class="small list-total"><b>${t('common.total')}: ${fmt.rs(rows.reduce((a, r) => a + r[amountKey], 0))}</b></p>` : ''; };

    const farmerPicker = html`<label class="field"><span>${t('collection.farmerCode')} *</span><input name="code" inputmode="numeric" required autofocus></label>
      <div class="farmer-found idle" data-farmer-out>${t('collection.typeCode')}</div>`;

    let body;
    if (tab === 'sale') {
      const moves = (await api.feedMoves()).filter((m) => m.type === 'sale' && inRange(range, m.date)).sort(newestFirst);
      body = html`<div class="grid-2">
        <form class="card stack" data-form="sale"><h2>${t('ledger.feedSale')}</h2>${farmerPicker}
          <label class="field"><span>${t('ledger.item')} *</span><select name="itemId">${items.filter((i) => i.active).map((i) => html`<option value="${i.id}" data-sub="${fmt.rs(i.pricePaise)} / ${i.unit} · ${t('ledger.inStock', { n: i.stock })}">${i.name}</option>`)}</select><span class="hint" data-item-info></span></label>
          <div class="form-grid"><label class="field"><span>${t('ledger.qty')} *</span><input name="qty" inputmode="numeric" value="1"></label>
          <div class="field"><span>${t('common.date')}</span>${dateField({ name: 'date', value: todayIST() })}</div></div>
          <div class="price"><div class="amt"><small>${t('common.amount')}</small><b data-total>—</b></div></div>
          <span class="err" role="alert"></span><button class="btn btn-green btn-xl btn-block">${t('ledger.saveSale')}</button></form>
        <section class="card"><h2>${t('ledger.recentSales')}</h2>${bar(moves, 'amountPaise')}${moves.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>${t('common.date')}</th><th>${t('common.name')}</th><th>${t('ledger.item')}</th><th class="num">${t('ledger.qty')}</th><th class="num">${t('common.amount')}</th><th><span class="sr-only">${t('feedReceipt.short')}</span></th></tr></thead>
          <tbody>${moves.map((m) => html`<tr><td>${fmt.date(m.date)}</td><td>${byId.get(m.farmerId)?.code} ${byId.get(m.farmerId)?.name}</td><td>${itemName(m.itemId)}</td><td class="num">${m.qty}</td><td class="num">${fmt.rsPlain(m.amountPaise)}</td>
            <td class="nowrap"><a class="btn btn-sm btn-ghost" href="#/feed-receipt/${m.id}" title="${t('feedReceipt.short')}">${icon('print', 18)}<span class="sr-only">${t('feedReceipt.short')}</span></a></td></tr>`)}</tbody></table></div>` : empty(t('ledger.none'))}</section></div>`;
    } else if (tab === 'advance') {
      const advs = (await api.advances()).filter((a) => inRange(range, a.date)).sort(newestFirst);
      body = html`<div class="grid-2">
        <form class="card stack" data-form="advance"><h2>${t('ledger.giveAdvance')}</h2>${farmerPicker}
          <div class="form-grid"><label class="field"><span>${t('ledger.advanceAmount')} *</span><input name="amount" inputmode="decimal"></label>
          <label class="field"><span>${t('ledger.installment')} *</span><input name="inst" inputmode="decimal"><span class="hint">${t('ledger.installmentHint')}</span></label>
          <div class="field"><span>${t('common.date')}</span>${dateField({ name: 'date', value: todayIST() })}</div>
          <label class="field"><span>${t('ledger.purpose')}</span><input type="text" name="note"></label></div>
          <div data-bal></div>
          <span class="err" role="alert"></span><button class="btn btn-green btn-xl btn-block">${t('ledger.saveAdvance')}</button></form>
        <section class="card"><h2>${t('ledger.advances')}</h2>${bar(advs, 'amountPaise')}${advs.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>${t('common.date')}</th><th>${t('common.name')}</th><th class="num">${t('ledger.advanceAmount')}</th><th class="num">${t('ledger.installment')}</th><th>${t('ledger.purpose')}</th></tr></thead>
          <tbody>${advs.map((a) => html`<tr class="clickable" data-farmer="${a.farmerId}"><td>${fmt.date(a.date)}</td><td>${byId.get(a.farmerId)?.code} ${byId.get(a.farmerId)?.name}</td><td class="num">${fmt.rsPlain(a.amountPaise)}</td><td class="num">${fmt.rsPlain(a.installmentPaise)}</td><td>${a.note}</td></tr>`)}</tbody></table></div>` : empty(t('ledger.none'))}</section></div>`;
    } else {
      const moves = (await api.feedMoves()).filter((m) => m.type === 'in' && inRange(range, m.date)).sort(newestFirst);
      body = html`<div class="stats" style="margin-bottom:16px">${items.map((i) => stat(i.name, `${i.stock} ${i.unit}`, `${t('ledger.salePrice')}: ${fmt.rs(i.pricePaise)}`, i.stock < 5 ? 'warn' : ''))}</div>
        <div class="grid-2">
        ${isOwner ? html`<form class="card stack" data-form="stock"><h2>${t('ledger.stockIn')}</h2>
          <label class="field"><span>${t('ledger.item')} *</span><select name="itemId">${items.map((i) => html`<option value="${i.id}" data-sub="${t('ledger.inStock', { n: i.stock })}">${i.name}</option>`)}</select></label>
          <div class="form-grid"><label class="field"><span>${t('ledger.qty')} *</span><input name="qty" inputmode="numeric"></label>
          <label class="field"><span>${t('ledger.costPrice')}</span><input name="price" inputmode="decimal"></label>
          <div class="field"><span>${t('common.date')}</span>${dateField({ name: 'date', value: todayIST() })}</div></div>
          <span class="err" role="alert"></span><button class="btn btn-primary btn-xl btn-block">${t('ledger.saveStock')}</button></form>
        <form class="card stack" data-form="item"><h2>${t('ledger.newItem')}</h2>
          <label class="field"><span>${t('ledger.itemName')} *</span><input type="text" name="name"></label>
          <div class="form-grid"><label class="field"><span>${t('ledger.unit')}</span><input type="text" name="unit" value="पोती"></label>
          <label class="field"><span>${t('ledger.salePrice')} *</span><input name="price" inputmode="decimal"></label></div>
          <span class="err" role="alert"></span><button class="btn btn-ghost btn-block">${t('common.save')}</button></form>` : ''}
        <section class="card"><h2>${t('ledger.stockHistory')}</h2>${bar(moves, 'amountPaise')}${moves.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>${t('common.date')}</th><th>${t('ledger.item')}</th><th class="num">${t('ledger.qty')}</th><th class="num">${t('common.amount')}</th></tr></thead>
          <tbody>${moves.map((m) => html`<tr><td>${fmt.date(m.date)}</td><td>${itemName(m.itemId)}</td><td class="num">${m.qty}</td><td class="num">${fmt.rsPlain(m.amountPaise)}</td></tr>`)}</tbody></table></div>` : empty(t('ledger.none'))}</section></div>`;
    }

    mount(el, html`<div class="page-head"><h1>${t('nav.ledger')}</h1></div>
      <nav class="tabs">${TABS.map((k) => html`<a href="#/ledger?tab=${k}" class="${k === tab ? 'on' : ''}">${t('ledger.tab.' + k)}</a>`)}</nav>
      ${filterCard('/ledger', { ...query, tab }, range, { count: listCount, unit: t('ledger.entries') })}${body}`);

    bindDateFields(el);
    bindRangeBar(el, '/ledger', { ...query, tab }, range, today);
    let farmer = null;
    on(el, 'input', '[name=code]', async (_, inp) => {
      farmer = byCode.get(inp.value.trim()) || null;
      const out = $('[data-farmer-out]', el);
      out.className = 'farmer-found' + (!inp.value ? ' idle' : farmer ? '' : ' missing');
      out.textContent = !inp.value ? t('collection.typeCode') : farmer ? `${farmer.name} · ${farmer.village}` : t('collection.noFarmer', { code: inp.value });
      const bal = $('[data-bal]', el);
      if (bal) mount(bal, farmer ? html`<div class="note">${t('ledger.currentAdvance', { amt: fmt.rs((await api.balances(farmer.id)).advanceOutstandingPaise) })}</div>` : '');
    });
    on(el, 'input', '[data-form=sale]', (_, f) => {
      const it = items.find((i) => i.id === f.itemId.value); const q = parseInt(f.qty.value, 10);
      $('[data-total]', el).textContent = it && q > 0 ? fmt.rs(it.pricePaise * q) : '—';
      const info = $('[data-item-info]', el); if (info && it) info.textContent = `${fmt.rs(it.pricePaise)} / ${it.unit} · ${t('ledger.inStock', { n: it.stock })}`;
    });
    el.querySelector('[data-form=sale]')?.dispatchEvent(new Event('input', { bubbles: true }));
    on(el, 'click', 'tr[data-farmer]', (_, tr) => navigate('/farmers/' + tr.dataset.farmer));
    on(el, 'submit', 'form[data-form]', async (e, f) => {
      e.preventDefault();
      const errEl = $('.err', f);
      try {
        const kind = f.dataset.form;
        if ((kind === 'sale' || kind === 'advance') && !farmer) throw { code: 'farmer-not-found' };
        if (kind === 'sale') {
          // D-64: straight to the printable receipt; its "पुढील विक्री" / Back returns to a fresh form
          const rec = await api.addFeedMove({ type: 'sale', itemId: f.itemId.value, qty: parseInt(f.qty.value, 10), farmerId: farmer.id, date: f.date.value });
          navigate('/feed-receipt/' + rec.id + '?new=1'); return;
        }
        if (kind === 'advance') await api.addAdvance({ farmerId: farmer.id, amountPaise: toPaise(f.amount.value), installmentPaise: toPaise(f.inst.value), date: f.date.value, note: f.note.value });
        if (kind === 'stock') await api.addFeedMove({ type: 'in', itemId: f.itemId.value, qty: parseInt(f.qty.value, 10), pricePaise: toPaise(f.price.value || '0') ?? 0, date: f.date.value });
        if (kind === 'item') await api.saveFeedItem({ name: f.name.value.trim(), unit: f.unit.value.trim(), pricePaise: toPaise(f.price.value) });
        toast(t('common.saved'));
        navigate('/ledger?tab=' + tab);
      } catch (err) { errEl.textContent = errorText(err); }
    });
  },
};
