// Hash router: '#/farmers/42?tab=ledger' → route '/farmers/:id', params { id: '42' }, query { tab }.
const routes = [];

export function route(pattern, page) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ pattern, re, keys, page });
}

export function match(hash) {
  const [path, qs] = (hash.replace(/^#/, '') || '/').split('?');
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { ...r, path, params, query: Object.fromEntries(new URLSearchParams(qs || '')) };
    }
  }
  return null;
}

export const navigate = (to) => { if (location.hash === '#' + to) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = to; };
