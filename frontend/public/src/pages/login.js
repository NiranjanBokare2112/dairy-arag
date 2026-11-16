// Login. Two modes (switch at the top; #/login?as=farmer opens the farmer mode directly):
//  • कर्मचारी (staff — owner, operators, Bokare support; D-137): 4-digit PIN → OTP on that person's WhatsApp (6 digits,
//    5 minutes) → in. No list of staff names; the PIN says who it is, the OTP proves it is their phone.
//    Test mode sends nothing and shows the OTP on screen.
//  • शेतकरी (farmer): type the farmer code (code only — D-47) → the farmer's own read-only page #/my.
// Each step writes into one real <input>, so keyboard typing and the big keypad always agree.
import { redirect } from '../core/backnav.js';
import { api } from '../api/index.js';
import { html, mount, on, $ } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { brandLogo, toast, errorText } from '../core/ui.js';
import { navigate } from '../core/router.js';

const startPage = (role) => (role === 'owner' ? '/dashboard' : role === 'support' ? '/support' : '/collection');

export default {
  title: 'login.title',
  layout: 'bare',
  async render(el, { query = {} } = {}) {
    const farmerMode = query.as === 'farmer';
    const center = await api.center();
    // Desktop: focus the box at once. Touch phones: don't, or the system keyboard would cover the keypad.
    const finePointer = window.matchMedia?.('(pointer: fine)').matches;
    let step = 'pin'; let pin = ''; let sent = null; let timer = 0;

    const keypad = (okLabel) => html`<div class="keypad" aria-hidden="true">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => html`<button type="button" tabindex="-1" data-k="${n}">${n}</button>`)}
        <button type="button" tabindex="-1" data-k="del" aria-label="${t('login.del')}">⌫</button>
        <button type="button" tabindex="-1" data-k="0">0</button>
        <button type="submit" tabindex="-1" class="k-ok">${okLabel}</button>
      </div>`;

    const staffPart = () => (step === 'pin' ? html`
          <label class="pin-label" for="pin">${t('login.enterPin')}</label>
          <input id="pin" class="pin-input" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4"
            autocomplete="current-password" enterkeyhint="send" aria-describedby="pin-help" ${finePointer ? 'autofocus' : ''}>
          <div id="pin-help" class="small muted">${t('login.pinHint')}</div>
          ${keypad(t('login.sendOtp'))}
          <p class="small muted" style="margin-top:14px">${t('login.staffDemo')}</p>` : html`
          <p class="otp-sent">${t('login.otpSentName', { n: sent.name, m: sent.sentTo })}</p>
          ${sent.testOtp ? html`<p class="note note-warn otp-test" role="status">${t('login.testOtp', { o: sent.testOtp })}</p>` : ''}
          <label class="pin-label" for="pin">${t('login.enterOtp')}</label>
          <input id="pin" class="pin-input" name="otp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
            autocomplete="one-time-code" enterkeyhint="go" aria-describedby="pin-help" ${finePointer ? 'autofocus' : ''}>
          <div id="pin-help" class="small muted">${t('login.otpHint', { n: sent.validFor })}</div>
          ${keypad(t('login.go'))}
          <div class="otp-links"><button type="button" class="link-btn" data-change>${t('login.changePin')}</button>
            <button type="button" class="link-btn" data-resend disabled>${t('login.resendIn', { s: sent.resendIn })}</button></div>`);

    const draw = () => {
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
          <div id="pin-help" class="small muted">${t('login.farmerHint')}</div>
          ${keypad(t('login.farmerGo'))}
          <p class="small muted" style="margin-top:14px">${t('login.farmerDemo')}</p>` : staffPart()}
          <a class="link-btn" href="#/welcome">← ${t('login.backToSite')}</a>
        </form>
      </div>`);
      if (step === 'otp' && !farmerMode) countdown(sent.resendIn);
    };

    const countdown = (secs) => {
      clearInterval(timer); let left = secs;
      const b = () => $('[data-resend]', el);
      timer = setInterval(() => {
        if (!el.isConnected || !b()) return clearInterval(timer);
        left -= 1;
        if (left <= 0) { clearInterval(timer); b().disabled = false; b().textContent = t('login.resend'); }
        else b().textContent = t('login.resendIn', { s: left });
      }, 1000);
    };

    let busy = false;
    const shake = () => { const form = $('form', el); form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); };
    const fail = (err) => { const box = $('#pin', el); if (box) box.value = ''; shake(); toast(errorText(err), 'err'); if (finePointer) box?.focus(); };

    const sendOtp = async () => {
      const p = step === 'pin' ? $('#pin', el).value : pin;
      if (busy) return;
      if (!/^\d{4}$/.test(p)) { toast(t('err.invalid-pin'), 'warn'); return; }
      busy = true;
      try { sent = await api.requestStaffOtp({ pin: p }); pin = p; step = 'otp'; draw(); }
      catch (err) { if (step === 'pin') fail(err); else toast(errorText(err), err.code === 'otp-wait' ? 'warn' : 'err'); }
      finally { busy = false; }
    };
    const verify = async () => {
      const otp = $('#pin', el).value;
      if (busy) return;
      if (otp.length !== 6) { toast(t('login.otpShort'), 'warn'); return; }
      busy = true;
      try { const u = await api.verifyStaffOtp({ ref: sent.ref, otp }); clearInterval(timer); pin = ''; redirect(startPage(u.role)); } // no Back step (D-63)
      catch (err) { fail(err); if (err.code === 'otp-locked' || err.code === 'otp-expired') { const r = $('[data-resend]', el); if (r) { r.disabled = false; r.textContent = t('login.resend'); } } }
      finally { busy = false; }
    };
    // farmer: code only, no auto-submit (codes differ in length) — "पहा" / Enter
    const submitCode = async () => {
      const code = $('#pin', el).value;
      if (busy || !code) { if (!code) toast(t('login.codeEmpty'), 'warn'); return; }
      busy = true;
      try { await api.farmerLogin(code); redirect('/my'); } catch (err) { fail(err); } finally { busy = false; }
    };
    const submit = () => (farmerMode ? submitCode() : step === 'pin' ? sendOtp() : verify());
    const afterChange = () => {
      const box = $('#pin', el);
      box.value = box.value.replace(/\D/g, '').slice(0, farmerMode ? 5 : step === 'pin' ? 4 : 6); // digits only
      if (!farmerMode && step === 'pin' && box.value.length === 4) sendOtp(); // PIN complete → OTP on WhatsApp
      if (!farmerMode && step === 'otp' && box.value.length === 6) verify(); // OTP complete → in
    };

    draw();
    on(el, 'submit', 'form', (e) => { e.preventDefault(); submit(); });
    on(el, 'input', '#pin', afterChange);
    // Keypad buttons must not steal focus from the box (so keyboard typing keeps working after a tap).
    on(el, 'mousedown', '.keypad button', (e) => e.preventDefault());
    on(el, 'click', '[data-k]', (_, b) => {
      const box = $('#pin', el); const k = b.dataset.k;
      box.value = k === 'del' ? box.value.slice(0, -1) : (box.value + k);
      afterChange();
    });
    on(el, 'click', '[data-change]', () => { clearInterval(timer); step = 'pin'; pin = ''; sent = null; draw(); });
    on(el, 'click', '[data-resend]', (_, b) => { if (!b.disabled) sendOtp(); });
    if (query.as === 'support') navigate('/login'); // Bokare support logs in with its PIN + WhatsApp OTP like the staff (D-137)
  },
};
