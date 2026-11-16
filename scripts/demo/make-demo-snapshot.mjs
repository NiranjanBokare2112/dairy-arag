//   node scripts/demo/make-demo-snapshot.mjs 2026-11-23     (end date of the test data)
// Builds frontend/public/demo/demo-data.json: the demo data for the Vercel link (D-135), fictional, made by the app's own rules.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = pathToFileURL(join(ROOT, 'frontend/public/src/')).href;
const { api } = await import(SRC + 'api/mock.js');
const until = process.argv[2] || '2026-11-23';
await api.login('u-owner', '1234');
console.log('demoFill', await api.demoFill({ until }));
await api.logout();
const key = [...store.keys()].find((k) => k.startsWith('arag.db'));
const db = JSON.parse(store.get(key));
db.sessions = (db.sessions || []).map((s) => ({ ...s, logoutAt: s.logoutAt || s.lastSeenAt })); // nobody logged in
(await import('node:fs')).writeFileSync(join(ROOT, 'frontend/public/demo/demo-data.json'), JSON.stringify(db));
const last = (a) => (a || []).reduce((m, x) => (x.date > m ? x.date : m), '');
console.log('key', key, '| milk to', last(db.collections), '| expenses', db.expenses.length, '| payouts', (db.payouts || []).length, '| tickets', (db.tickets || []).length, '| bills', db.bills.length);
