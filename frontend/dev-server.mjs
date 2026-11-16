// Zero-dependency static server for development and LAN testing.
//   npm run dev            → http://localhost:5173 and http://<this-pc-ip>:5173 (phones on the same Wi-Fi)
// The production backend will serve these same files; this script is only for UI work.
//
// Shared test mode (D-67): until the real server API exists, the browser mock keeps its data here too, so a phone,
// a tablet and the PC see the same entries. GET /__dev/db?since=N returns the data when it changed after version N
// (204 if not); PUT /__dev/db?base=N saves it only if nobody saved after N (409 + the newer data otherwise).
// Kept in frontend/.dev-shared-db.json (not committed). Testing only: never used by the real app.
import { createServer } from 'node:http';
import { readFile, stat, writeFile, rename } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize, dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.csv': 'text/csv',
};

const SHARED_FILE = join(dirname(fileURLToPath(import.meta.url)), PORT === 5173 ? '.dev-shared-db.json' : `.dev-shared-db-${PORT}.json`);
let shared = { version: 0, db: null };
try { shared = JSON.parse(await readFile(SHARED_FILE, 'utf8')); } catch { /* first run */ }
let writing = Promise.resolve();
const persist = () => { const text = JSON.stringify(shared); writing = writing.then(() => writeFile(SHARED_FILE + '.tmp', text)).then(() => rename(SHARED_FILE + '.tmp', SHARED_FILE)).catch((e) => console.error('shared db save failed', e.message)); };
const sendJson = (req, res, status, obj) => {
  const body = Buffer.from(JSON.stringify(obj));
  const gz = /gzip/.test(req.headers['accept-encoding'] || '') && body.length > 1024;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(gz ? gzipSync(body) : body);
};
async function sharedDb(req, res, url) {
  if (req.method === 'GET') {
    if (!shared.db) { sendJson(req, res, 200, { version: 0, db: null }); return; }
    if (Number(url.searchParams.get('since')) === shared.version) { res.writeHead(204, { 'Cache-Control': 'no-store' }).end(); return; }
    sendJson(req, res, 200, shared); return;
  }
  if (req.method === 'PUT') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const base = Number(url.searchParams.get('base'));
    if (base !== shared.version) { sendJson(req, res, 409, shared); return; }
    shared = { version: shared.version + 1, db: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    persist(); sendJson(req, res, 200, { version: shared.version }); return;
  }
  res.writeHead(405).end();
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__dev/db') { await sharedDb(req, res, url); return; }
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Arag Dudh UI → http://localhost:${PORT}`);
  for (const ip of ips) console.log(`          LAN → http://${ip}:${PORT}`);
  console.log(`Shared test data (all devices): ${shared.db ? 'version ' + shared.version : 'empty, the first browser to open the app fills it'}`);
});
