// Marathi first (mr default), English secondary. All UI text comes from ../i18n/*.js.
import mr from '../i18n/mr.js';
import en from '../i18n/en.js';

const DICTS = { mr, en };
const KEY = 'arag.lang';
let lang = 'mr';
try { lang = localStorage.getItem(KEY) || 'mr'; } catch { /* private mode */ }
if (!DICTS[lang]) lang = 'mr';

export const getLang = () => lang;
export function setLang(l) {
  if (!DICTS[l]) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  document.documentElement.lang = l;
}

/** t('collection.saved', { name }) — falls back to Marathi, then to the key itself. */
export function t(key, vars) {
  let s = DICTS[lang][key] ?? mr[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}
