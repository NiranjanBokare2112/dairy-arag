// Font tester (D-133): try other Marathi fonts on the website (and the whole app) before choosing one.
// The chosen font is kept in this browser only. Mukta (self-hosted, works offline) stays the brand font until the
// owner decides otherwise (CLAUDE.md §7). Google fonts are loaded on demand, so testing them needs the internet;
// Sakal Bharati is served from the centre's computer; Mangal only shows on Windows PCs that have it installed.
const KEY = 'arag.fontTest';
const FALLBACK = "'Mukta', 'Nirmala UI', 'Noto Sans Devanagari', system-ui, sans-serif";

export const FONTS = [
  { id: 'mukta', label: 'Mukta (सध्याचा)', family: "'Mukta'" },
  { id: 'noto-sans', label: 'Noto Sans Devanagari', family: "'Noto Sans Devanagari'", g: 'Noto+Sans+Devanagari:wght@400;500;600;700;800' },
  { id: 'noto-serif', label: 'Noto Serif Devanagari', family: "'Noto Serif Devanagari'", g: 'Noto+Serif+Devanagari:wght@400;500;600;700;800' },
  { id: 'tiro', label: 'Tiro Devanagari Marathi', family: "'Tiro Devanagari Marathi'", g: 'Tiro+Devanagari+Marathi' },
  { id: 'mangal', label: 'Mangal (Windows)', family: "'Mangal'", local: true },
  // Sakal Bharati (C-DAC, SIL OFL 1.1): served from the centre's own computer, so no install is needed (2.5 MB, loaded only when picked)
  { id: 'sakal', label: 'Sakal Bharati', family: "'Sakal Bharati Web', 'SakalBharati'", css: './assets/fonts/sakal-bharati.css' },
];

export const savedFont = () => { try { return localStorage.getItem(KEY) || 'mukta'; } catch { return 'mukta'; } };

/** Use font `id` everywhere (sets the --font variable); loads a Google font the first time. */
export function applyFont(id) {
  const f = FONTS.find((x) => x.id === id) || FONTS[0];
  if ((f.g || f.css) && !document.querySelector(`link[data-font-link="${f.id}"]`)) {
    const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: f.css || `https://fonts.googleapis.com/css2?family=${f.g}&display=swap` });
    l.dataset.fontLink = f.id; document.head.append(l);
  }
  if (f.id === 'mukta') document.documentElement.style.removeProperty('--font');
  else document.documentElement.style.setProperty('--font', `${f.family}, ${FALLBACK}`);
  try { if (f.id === 'mukta') localStorage.removeItem(KEY); else localStorage.setItem(KEY, f.id); } catch { /* private mode: this visit only */ }
  return f;
}

/** Is a local (installed) font really there? Measured: text in the font vs. two plain fallbacks — same width = not installed. */
export async function fontAvailable(f) {
  try {
    const ctx = document.createElement('canvas').getContext('2d'); const sample = 'आरग दूध संकलन केंद्र abcXYZ 0123';
    return ['monospace', 'serif'].some((base) => {
      ctx.font = `40px ${base}`; const w0 = ctx.measureText(sample).width;
      ctx.font = `40px ${f.family}, ${base}`; return ctx.measureText(sample).width !== w0;
    });
  } catch { return true; }
}
