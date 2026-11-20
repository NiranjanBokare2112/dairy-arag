// Gentle motion (D-143): things fade / rise into view the first time they appear.
// Only opacity and transform (smooth on cheap phones); nothing moves when the phone asks for reduced motion.
// Markup stays the same — targets are picked by selector, so pages need no changes.

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// D-146: the entrance (headline, sidebar, cards, count-up) plays once per browser tab. After that a refresh shows the page
// straight away — replaying it on every reload looked like flicker. Moving between pages keeps the gentle reveal.
const SEEN_KEY = 'motion.seen';
let seen = false;
try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: play as usual */ }
if (seen && typeof document !== 'undefined') document.documentElement.classList.add('no-intro');
let quietFirst = seen; // skip the reveal of the first page drawn after a refresh

// What rises into view on scroll. Items in the same grid get a small stagger (--rv-i).
const TARGETS = [
  // public website + farmer page
  '.sec-head', '.svc', '.steps li', '.sch', '.contact-item', '.vision-card', '.join-card', '.sample-msg', '.hero-sim',
  // app pages: cards and tiles on first view
  '.page .card', '.page .stat',
];
const IMAGES = ['.vision-photo', '.join-art', '.vision-logo', '.sample-msg .phone'];

let io = null;
const observer = () => (io ||= new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) {
    const el = e.target; el.classList.add('rv-in'); io.unobserve(el);
    const v = el.querySelector('.stat-value'); if (v) countUp(v);
    // once shown, drop every motion class so the card is drawn as a normal (sharp) element again — a lingering
    // will-change / transform layer makes Chrome draw its text slightly blurred
    const done = () => { el.classList.remove('rv', 'rv-up', 'rv-img', 'rv-in'); el.style.removeProperty('--rv-i'); };
    const end = (ev) => { if (ev.target === el && ev.propertyName === 'transform') { el.removeEventListener('transitionend', end); done(); } };
    el.addEventListener('transitionend', end); setTimeout(done, 1600);
  }
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }));

/** Mark the elements under `root` to reveal as they scroll into view. Safe to call on every first render of a page. */
export function reveal(root) {
  if (REDUCED || !root || typeof IntersectionObserver !== 'function') return;
  if (quietFirst) { quietFirst = false; return; }
  const mark = (el, cls) => {
    if (el.classList.contains('rv') || el.dataset.rvDone) return;
    el.dataset.rvDone = '1';
    const sibs = el.parentElement ? [...el.parentElement.children].filter((x) => x.matches(TARGETS.join(','))) : [];
    el.style.setProperty('--rv-i', Math.min(sibs.indexOf(el), 6));
    el.classList.add('rv', cls);
    observer().observe(el);
  };
  root.querySelectorAll(TARGETS.join(',')).forEach((el) => mark(el, 'rv-up'));
  root.querySelectorAll(IMAGES.join(',')).forEach((el) => mark(el, 'rv-img'));
}

/** Slide the sidebar items in once per visit (not on every page change). */
let sideDone = false;
export function sidenavIntro(nav) {
  if (REDUCED || sideDone || seen || !nav) return;
  sideDone = true;
  [...nav.children].forEach((a, i) => a.style.setProperty('--sn-i', i));
  nav.classList.add('sn-intro');
  setTimeout(() => nav.classList.remove('sn-intro'), 1400);
}

/** D-144: a number in a tile counts up once when it first shows (₹ 34,756.13 · 138.90 ली. · 12). Ends on the exact original text. */
function countUp(el) {
  const text = el.textContent; const m = text.match(/^(\D*?)(-?[\d,]+(?:\.\d+)?)(\D*)$/);
  if (!m || el.dataset.counted) return;
  el.dataset.counted = '1';
  const [, pre, num, post] = m; const target = Number(num.replace(/,/g, '')); if (!Number.isFinite(target) || target === 0) return;
  const dec = (num.split('.')[1] || '').length, commas = num.includes(',');
  const show = (x) => (commas ? x.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : x.toFixed(dec));
  const t0 = performance.now(), dur = 800;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = k < 1 ? pre + show(target * e) + post : text;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
