// Public website of the center: owner's vision, facilities, how it works, contact.
// Login sits in the top-right corner. Owner-editable details (name, message, photo,
// collection timings) come from center settings; everything else from i18n.
import { api } from '../api/index.js';
import { FONTS, savedFont, applyFont, fontAvailable } from '../core/fonttest.js';
import { html, mount, $ } from '../core/dom.js';
import { t, getLang, setLang } from '../core/i18n.js';
import { icon, whatsappIcon } from '../core/icons.js';
import { brandLogo } from '../core/ui.js';
import { mountCollectionSim } from './collection-sim.js';
import { startPage } from './home.js';

const SERVICES = [
  ['collect', 'milk'], ['rate', 'grid'], ['whatsapp', 'chat'], ['bill', 'bill'],
  ['pay', 'wallet'], ['feed', 'sack'], ['advance', 'handshake'], ['receipt', 'receipt'],
  ['doctor', 'doctor'], // D-88: the doctors' details are only in the farmer login
];

// scheme cards (D-98): the first paragraph of the summary is on the card, the rest folds into the details
const leadOf = (text) => String(text || '').split('\n')[0];
const restOf = (text) => String(text || '').split('\n').slice(1).join('\n').trim();

export default {
  title: 'site.title',
  public: true,
  async render(el, { refresh }) {
    const [c, me, schemes] = await Promise.all([api.center(), api.me(), api.schemes().catch(() => [])]);
    const days = c.cycleDays || 10;
    const tel = `tel:+91${c.mobile}`;
    const wa = `https://wa.me/91${c.mobile}`;
    const map = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Arag, Miraj, Sangli, Maharashtra 416401');
    const ownerSign = t('site.vision.signDefault'); // D-116: the owner's name is no longer asked for or shown
    const morning = t('site.time.morning', { from: hm(c.morningFrom), to: hm(c.morningTo, 'am') });
    const evening = t('site.time.evening', { from: hm(c.eveningFrom), to: hm(c.eveningTo, 'pm') });
    const shortTimes = t('site.time.short', { m1: hm(c.morningFrom), m2: hm(c.morningTo), e1: hm(c.eveningFrom), e2: hm(c.eveningTo) });

    mount(el, html`
    <div class="site">
      <header class="site-head" id="site-head">
        <a class="site-brand" href="#/welcome">${brandLogo(66, { name: c.name, tagline: t('brand.tagline') })}<span><b>${c.name}</b><small>${t('brand.tagline')}</small></span></a>
        <nav class="site-nav" aria-label="${t('site.navLabel')}">
          <a href="#about" data-scroll>${t('site.nav.about')}</a><a href="#services" data-scroll>${t('site.nav.services')}</a>${schemes.length ? html`<a href="#schemes" data-scroll>${t('site.nav.schemes')}</a>` : ''}
          <a href="#how" data-scroll>${t('site.nav.how')}</a><a href="#contact" data-scroll>${t('site.nav.contact')}</a>
        </nav>
        <div class="site-actions">
          <button class="site-lang" data-lang-site aria-label="${t('site.switchLang')}">${getLang() === 'mr' ? 'EN' : 'मरा'}</button>
          ${me ? html`<a class="site-login" href="#${startPage(me.role)}">${icon('home', 20)}<span>${me.role === 'farmer' ? t('site.myDetails') : t('site.openApp')}</span></a>`
            : html`<a class="site-login site-farmer" href="#/login?as=farmer">${icon('users', 20)}<span>${t('site.farmerLogin')}</span></a>
              <a class="site-login" href="#/login" aria-label="${t('site.login')}">${icon('login', 20)}<span>${t('site.login')}</span></a>`}
        </div>
      </header>

      <section class="hero">
        <div class="hero-top">
          <h1>${t('site.hero.title').split(', ').map((w, i, a) => html`<span class="nb">${w}${i < a.length - 1 ? ',' : ''}</span> `)}</h1>
          <div class="hero-pic">
            <img src="./assets/img/farm-scene.jpg" srcset="./assets/img/farm-scene-800.jpg 800w, ./assets/img/farm-scene.jpg 1600w" sizes="(max-width: 900px) 100vw, 1100px"
              alt="${t('site.hero.imgAlt')}" width="1600" height="667" fetchpriority="high">
          </div>
        </div>
        <div class="hero-below">
          <p class="hero-sub">${t('site.hero.sub')}</p>
          <div class="hero-cta">
            <a class="sbtn sbtn-primary" href="${tel}">${icon('phone', 20)} ${t('site.hero.call')}</a>
            <a class="sbtn sbtn-green" href="${wa}" target="_blank" rel="noopener">${whatsappIcon(20)} ${t('site.hero.whatsapp')}</a>
          </div>
        </div>
        <div class="hero-sim" data-sim></div>
        <ul class="hl">
          <li>${icon('milk', 26)}<span>${t('site.hl.milk')}</span></li>
          <li>${icon('clock', 26)}<span>${t('site.hl.shifts')}<small>${shortTimes}</small></span></li>
          <li>${icon('bill', 26)}<span>${t('site.hl.bill', { n: days })}</span></li>
          <li>${icon('wallet', 26)}<span>${t('site.hl.pay')}</span></li>
        </ul>
      </section>

      <section class="sec vision" id="about">
        <div class="vision-card">
          ${c.ownerPhoto ? html`<div class="vision-photo"><img src="${c.ownerPhoto}" alt="${ownerSign}"></div>`
            : html`<div class="vision-photo vision-art"><img src="./assets/img/cow-calf.png" alt="${t('site.vision.imgAlt')}"></div>`}
          <div class="vision-body">
            <span class="kicker">${t('site.vision.kicker')}</span>
            <h2>${t('site.vision.title')}</h2>
            <blockquote>${c.ownerMessage || t('site.vision.default')}</blockquote>
            <div class="vision-sign"><b>${ownerSign}</b><span>${c.ownerTitle || t('site.vision.role')}</span></div>
          </div>
        </div>
        <div class="pillars">
          ${[['purity', 'drop'], ['transparency', 'grid'], ['trust', 'shield']].map(([k, ic]) => html`
            <div class="pillar pillar-${k}">${icon(ic, 30)}<h3>${t('site.pillar.' + k)}</h3><p>${t('site.pillar.' + k + '.text')}</p></div>`)}
        </div>
      </section>

      <section class="sec services" id="services">
        <div class="sec-head"><h2>${t('site.svc.title')}</h2><p>${t('site.svc.sub')}</p></div>
        <div class="svc-grid">
          ${SERVICES.map(([k, ic]) => html`<article class="svc">${icon(ic, 28)}<h3>${t('site.svc.' + k, { n: days })}</h3><p>${t('site.svc.' + k + '.text', { n: days })}</p></article>`)}
        </div>
      </section>

      ${schemes.length ? html`<section class="sec schemes" id="schemes">
        <div class="sec-head"><h2>${t('site.sch.title')}</h2><p>${t('site.sch.sub')}</p></div>
        <div class="sch-grid">
          ${schemes.map((s) => html`<article class="sch">
            <div class="sch-top">${icon('scheme', 26)}${s.lastDate ? html`<span class="sch-date">${t('site.sch.lastDate', { d: fmtDate(s.lastDate) })}</span>` : ''}</div>
            <h3>${s.title}</h3><p class="sch-sum">${leadOf(s.summary)}</p>
            ${restOf(s.summary) || s.benefit || s.eligibility || s.documents || s.howTo ? html`<details class="sch-more"><summary>${t('site.sch.details')}</summary>
              ${restOf(s.summary) ? html`<p class="sch-row">${restOf(s.summary)}</p>` : ''}
              ${s.benefit ? html`<p class="sch-row"><b>${t('site.sch.benefit')}:</b> ${s.benefit}</p>` : ''}
              ${s.eligibility ? html`<p class="sch-row"><b>${t('site.sch.who')}:</b> ${s.eligibility}</p>` : ''}
              ${s.documents ? html`<p class="sch-row"><b>${t('site.sch.docs')}:</b> ${s.documents}</p>` : ''}
              ${s.howTo ? html`<p class="sch-row"><b>${t('site.sch.how')}:</b> ${s.howTo}</p>` : ''}
            </details>` : ''}
            <div class="sch-foot">${s.link ? html`<a href="${s.link}" target="_blank" rel="noopener">${t('site.sch.more')} ↗</a>` : ''}
              <a href="${tel}">${icon('phone', 16)} ${t('site.sch.ask')}</a></div>
          </article>`)}
        </div>
      </section>` : ''}

      <section class="sec how" id="how">
        <div class="sec-head"><span class="kicker">${t('site.nav.how')}</span><h2>${t('site.how.title')}</h2></div>
        <ol class="steps">
          ${[1, 2, 3, 4].map((n) => html`<li><span class="step-n">${n}</span><h3>${t('site.how.' + n)}</h3><p>${t('site.how.' + n + '.text')}</p></li>`)}
        </ol>
        <div class="sample-msg" aria-label="${t('site.msg.label')}">
          <div class="phone">
            <div class="phone-top">${brandLogo(30, { name: c.name, tagline: t('brand.tagline') })}<b>${c.name}</b></div>
            <div class="bubble">${t('site.msg.sample')}</div>
          </div>
          <div class="sample-text"><h3>${t('site.msg.title')}</h3><p>${t('site.msg.text')}</p></div>
        </div>
      </section>

      <section class="sec join">
        <div class="join-card">
          <div class="join-art">${brandLogo(190, { name: c.name, tagline: t('brand.tagline') })}</div>
          <div><h2>${t('site.join.title')}</h2><p>${t('site.join.text')}</p>
            <div class="hero-cta"><a class="sbtn sbtn-white" href="${tel}">${icon('phone', 20)} ${c.mobile}</a>
            <a class="sbtn sbtn-outline" href="${wa}" target="_blank" rel="noopener">${whatsappIcon(20)} WhatsApp</a></div></div>
        </div>
      </section>

      <section class="sec contact" id="contact">
        <div class="sec-head"><span class="kicker">${t('site.nav.contact')}</span><h2>${t('site.contact.title')}</h2></div>
        <div class="contact-grid">
          <a class="contact-item" href="${map}" target="_blank" rel="noopener">${icon('pin', 26)}<div><small>${t('site.contact.address')}</small><b>${c.address}</b><span class="link">${t('site.contact.map')} →</span></div></a>
          <a class="contact-item" href="${tel}">${icon('phone', 26)}<div><small>${t('site.contact.phone')}</small><b>${c.mobile}</b><span class="link">${t('site.hero.call')} →</span></div></a>
          <div class="contact-item">${icon('clock', 26)}<div><small>${t('site.contact.timings')}</small><b>${morning}</b><b>${evening}</b></div></div>
        </div>
      </section>

      <footer class="site-foot">
        <div class="foot-brand">${brandLogo(52, { name: c.name, tagline: t('brand.tagline') })}<div><b>${c.name}</b><small>${t('brand.tagline')}</small></div></div>
        <div class="foot-meta"><span>© ${new Date().getFullYear()} ${c.name}</span><span>${t('site.footer.made')}</span></div>
      </footer>
      <div class="font-test" role="group" aria-label="${t('site.fontTest')}">
        <label><span>Aa ${t('site.fontTest')}</span>
          <select data-font-test>${FONTS.map((f) => html`<option value="${f.id}" ${f.id === savedFont() ? 'selected' : ''}>${f.label}</option>`)}</select></label>
        <small data-font-note hidden></small>
      </div>
    </div>`);

    // D-133: font tester — the page (and the app) switches to the chosen font at once
    const fontSel = $('[data-font-test]', el); const fontNote = $('[data-font-note]', el);
    const showFont = async (id) => { const f = applyFont(id); fontNote.hidden = true;
      if (f.local && !(await fontAvailable(f))) { fontNote.textContent = t('site.fontMissing'); fontNote.hidden = false; } };
    fontSel.addEventListener('change', () => showFont(fontSel.value));
    if (savedFont() !== 'mukta') showFont(savedFont());

    // Header gets a solid background once the page scrolls.
    mountCollectionSim($('[data-sim]', el)); // not awaited: the page shows at once, the animation loads in
    const head = $('#site-head', el);
    const onScroll = () => { if (!el.isConnected) { window.removeEventListener('scroll', onScroll); return; } head.classList.toggle('scrolled', window.scrollY > 10); };
    window.addEventListener('scroll', onScroll, { passive: true });
    // In-page links: the hash is used by the router, so scroll manually.
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-scroll]');
      if (a) { e.preventDefault(); el.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      if (e.target.closest('[data-lang-site]')) { setLang(getLang() === 'mr' ? 'en' : 'mr'); refresh(); }
    });
  },
};

const fmtDate = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** '18:00' → '6' ; '07:30' → '7:30' (12-hour clock, minutes only when not :00). `suffix` adds AM/PM in English. */
function hm(v, suffix) {
  if (!v) return '';
  const [h, m] = v.split(':').map(Number);
  const h12 = ((h + 11) % 12) + 1;
  const s = m ? `${h12}:${String(m).padStart(2, '0')}` : String(h12);
  return suffix ? s + t('site.time.' + suffix) : s;
}
