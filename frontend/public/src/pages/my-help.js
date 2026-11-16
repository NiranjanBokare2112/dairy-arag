// Farmer's "मदत" tab (#/my/help, #/my/help/:id — D-109): report an issue to the centre / Bokare and follow it.
import { api } from '../api/index.js';
import { html, mount } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { farmerTop, unseenCount } from './myshell.js';
import { ticketForm, bindTicketForm, ticketList, ticketView, bindTicketView } from './help.js';

export default {
  title: 'my.tab.help',
  layout: 'bare',
  roles: ['farmer'],
  async render(el, { params = {} } = {}) {
    const [c, schemes] = await Promise.all([api.center(), api.schemes().catch(() => [])]);
    const top = farmerTop(c, 'help', { newSchemes: unseenCount(schemes) });
    if (params.id) {
      const tk = await api.ticket(params.id);
      mount(el, html`<div class="my tk-page">${top}${ticketView(tk, '/my/help')}</div>`);
      return bindTicketView(el, tk, '/my/help/' + tk.id);
    }
    const list = await api.tickets({});
    mount(el, html`<div class="my">${top}
      <section class="my-intro"><h1>${icon('help', 26)} ${t('my.help.title')}</h1><p>${t('my.help.intro')} <a href="tel:+91${c.mobile}"><b>${c.mobile}</b></a></p></section>
      <div class="my-2col">${ticketForm({ open: !list.length || window.innerWidth >= 1100 })}
      <section class="card"><h2>${t('tk.mine')} <span class="muted small">(${list.length})</span></h2>${ticketList(list, '/my/help')}</section></div>
    </div>`);
    bindTicketForm(el, '/my/help');
  },
};
