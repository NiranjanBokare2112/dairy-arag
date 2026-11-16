// Login. Two modes (switch at the top; #/login?as=farmer opens the farmer mode directly):
//  • कर्मचारी (staff): pick a user, then type the PIN on the keyboard or tap the big keypad; logs in on
//    Enter / "चला", or automatically once the PIN reaches that user's PIN length.
//  • शेतकरी (farmer): type the farmer code (code only — D-47) → the farmer's own read-only page #/my.
// Both modes write into one real <input>, so keyboard typing and the keypad always agree.
import { redirect } from '../core/backnav.js';
import { api } from '../api/index.js';
import { html, mount, on, $ } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { brandLogo, toast, errorText } from '../core/ui.js';
import { navigate } from '../core/router.js';

export default {
  title: 'login.title',
  layout: 'bare',
  async render(el, { query = {} } = {}) {
    const farmerMode = query.as === 'farmer';
    const users = await api.users({ support: query.as === 'support' }); // D-109: Bokare support logs in at #/login?as=support
    const center = await api.center();
    let picked = users.find((u) => u.role === 'operator')?.id || users[0]?.id;
    // Desktop: focus the PIN box at once. Touch phones: don't, or the system keyboard would cover the keypad.
    const finePointer = window.matchMedia?.('(pointer: fine)').matches;

    mount(el, html`
      <div class="login">
        <form class="login-card" novalidate autocomplete="on">
          ${brandLogo(150, { name: center.name, tagline: t('brand.tagline') })}
          <h1>${center.name}</h1>
          <div class="tagline">${t('brand.tagline')}</div>
          <nav class="login-mode" aria-label="${t('login.modeLabel')}">
            <a href="#/login" class="${farmerMode ? '' : 'on'}" ${farmerMode ? '' : html`aria-current="page"`}>${t('login.staff')}</a>
            <a href="#/login?as=farmer" class="${farmerMode ? 'on' : ''}" ${farmerMode ? html`aria-current="page"` : ''}>${t('login.farmer')}</a>
          </nav>
          ${farmerMode ? html`
          <label class="pin-label" for="pin">${t('login.farmerCode')}</label>
          <input id="pin" class="pin-input code-input" name="code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5"
            autocomplete="off" enterkeyhint="go" aria-describedby="pin-help" ${finePointer ? 'autofocus' : ''}>
          <div id="pin-help" class="small muted">${t('login.farmerHint')}</div>` : html`
          <div class="user-pick" role="radiogroup" aria-label="${t('login.who')}">
            ${users.map((u) => html`<button type="button" role="radio" aria-checked="${String(u.id === picked)}" class="${u.id === picked ? 'on' : ''}" data-user="${u.id}">${u.name}<small>${t('role.' + u.role)}</small></button>`)}
          </div>
          <input type="text" name="username" autocomplete="username" value="${picked}" hidden>
          <label class="pin-label" for="pin">${t('login.enterPin')}</label>
          <input id="pin" class="pin-input" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6"
            autocomplete="current-password" enterkeyhint="go" aria-describedby="pin-help" ${finePointer ? 'autofocus' : ''}>
          <div id="pin-help" class="small muted">${t('login.typeOrTap')}</div>`}
          <div class="keypad" aria-hidden="true">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => html`<button type="button" tabindex="-1" data-k="${n}">${n}</button>`)}
            <button type="button" tabindex="-1" data-k="del" aria-label="${t('login.del')}">⌫</button>
            <button type="button" tabindex="-1" data-k="0">0</button>
            <button type="submit" tabindex="-1" class="k-ok">${farmerMode ? t('login.farmerGo') : t('login.go')}</button>
          </div>
          <p class="small muted" style="margin-top:14px">${farmerMode ? t('login.farmerDemo') : t('login.demoHint')}</p>
          <a class="link-btn" href="#/welcome">← ${t('login.backToSite')}</a>
        </form>
      </div>`);

    const form = $('form', el);
    const pinEl = $('#pin', el);
    const userOf = () => users.find((u) => u.id === picked);
    let busy = false;

    const submit = async () => {
      if (farmerMode) return submitCode();
      const pin = pinEl.value;
      if (busy || pin.length < 4) { if (pin.length < 4) toast(t('login.tooShort'), 'warn'); return; }
      busy = true;
      try {
        const u = await api.login(picked, pin);
        redirect(u.role === 'owner' ? '/dashboard' : '/collection'); // login leaves no Back step (D-63)
      } catch (err) {
        pinEl.value = '';
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
        toast(errorText(err), 'err');
        if (finePointer) pinEl.focus();
      } finally { busy = false; }
    };
    // farmer: code only, no auto-submit (codes differ in length) — "पहा" / Enter
    const submitCode = async () => {
      const code = pinEl.value;
      if (busy || !code) { if (!code) toast(t('login.codeEmpty'), 'warn'); return; }
      busy = true;
      try { await api.farmerLogin(code); redirect('/my'); }
      catch (err) {
        pinEl.value = '';
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
        toast(errorText(err), 'err');
        if (finePointer) pinEl.focus();
      } finally { busy = false; }
    };
    const afterChange = () => {
      pinEl.value = pinEl.value.replace(/\D/g, '').slice(0, farmerMode ? 5 : 6); // digits only
      if (farmerMode) return;
      const len = userOf()?.pinLength;
      if (len && pinEl.value.length === len) submit();
    };

    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    pinEl.addEventListener('input', afterChange);
    // Keypad buttons must not steal focus from the PIN box (so keyboard typing keeps working after a tap).
    on(el, 'mousedown', '.keypad button', (e) => e.preventDefault());
    on(el, 'click', '[data-k]', (_, b) => {
      const k = b.dataset.k;
      pinEl.value = k === 'del' ? pinEl.value.slice(0, -1) : (pinEl.value + k);
      afterChange();
    });
    on(el, 'click', '[data-user]', (_, b) => {
      picked = b.dataset.user;
      el.querySelectorAll('[data-user]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
      form.username.value = picked;
      pinEl.value = '';
      if (finePointer) pinEl.focus();
    });
  },
};
