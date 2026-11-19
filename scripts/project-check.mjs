#!/usr/bin/env node
/**
 * Project check — makes sure this folder holds the client it says it holds (project.json), so Arag's
 * app never goes to Mallewadi's repo / Vercel site or the other way round. Same file in every client folder.
 *
 *   node scripts/project-check.mjs                     before a push or a deploy (also /push and VS Code task)
 *   node scripts/project-check.mjs --remote-url <url>  from the git pre-push hook (.githooks/pre-push)
 *   node scripts/project-check.mjs --deploy            Vercel build step (vercel.json): fails the deploy on a mix-up
 *
 * Checks: GitHub repo · app name in texts, manifest and demo data · service-worker version prefix ·
 * no words of the other client in what gets published (frontend/public). Exit code 1 = stop.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const deploy = process.argv.includes('--deploy');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const ok = [], bad = [];
const check = (pass, good, wrong) => (pass ? ok : bad).push(pass ? good : wrong);

if (!existsSync(join(ROOT, 'project.json'))) { console.error('✗ project.json is missing — this folder does not say which client it is.'); process.exit(1); }
const P = JSON.parse(read('project.json'));
const norm = (u) => String(u || '').toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');

// 1. The GitHub repo this push / deploy goes to (each repo is connected to its own Vercel site)
let target = arg('--remote-url');
if (!target && deploy && process.env.VERCEL_GIT_REPO_SLUG) target = `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`;
if (!target && !deploy) { try { target = execSync('git remote get-url origin', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* no git */ } }
if (target) check(norm(target).endsWith(norm(P.repo)), `repo: ${P.repo}`, `repo: this is the ${P.id} folder, but it would go to "${target}" — ${P.id} belongs only in ${P.repo}`);
else ok.push('repo: not known here (skipped)');

// 2. The app's name everywhere it is published
const brand = (read('frontend/public/src/i18n/mr.js').match(/'brand\.name':\s*'([^']*)'/) || [])[1];
check(brand === P.name, 'name in texts (mr.js)', `name in mr.js is "${brand}", expected "${P.name}"`);
const man = JSON.parse(read('frontend/public/manifest.webmanifest'));
check(man.name === P.name, 'name in manifest', `manifest name is "${man.name}", expected "${P.name}"`);
if (existsSync(join(ROOT, 'frontend/public/demo/demo-data.json'))) {
  const d = JSON.parse(read('frontend/public/demo/demo-data.json')); const c = (d.db || d).center || {};
  check(c.name === P.name, 'demo data belongs to this client', `demo data is for "${c.name}", expected "${P.name}" — rebuild it in this folder`);
}

// 3. Service-worker version (phones cache per prefix)
const ver = (read('frontend/public/sw.js').match(/const VERSION = '([^']+)'/) || [])[1] || '';
check(ver.startsWith(P.swPrefix), `app version ${ver}`, `sw.js VERSION "${ver}" should start with "${P.swPrefix}"`);

// 4. No words of the other client in anything that gets published
const allow = new Set((P.allowOtherClientWordsIn || []).map((f) => f.replace(/\\/g, '/')));
const words = (P.otherClientWords || []).map((w) => w.toLowerCase());
const hits = [];
const walk = (dir) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n); const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!/\.(js|mjs|css|html|json|svg|webmanifest|txt|md)$/i.test(n)) continue;
    const rel = relative(ROOT, p).replace(/\\/g, '/');
    if (allow.has(rel)) continue;
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      const l = line.toLowerCase(); const w = words.find((x) => l.includes(x));
      if (w) hits.push(`${rel}:${i + 1} "${w}"`);
    });
  }
};
walk(join(ROOT, 'frontend/public'));
check(!hits.length, 'no other client’s name or data in frontend/public',
  `the other client’s words are in ${P.id}'s published files:\n    ${hits.slice(0, 15).join('\n    ')}${hits.length > 15 ? `\n    … ${hits.length - 15} more` : ''}`);

console.log(`Project check — ${P.id} (${P.name})`);
ok.forEach((m) => console.log('  ✓ ' + m));
bad.forEach((m) => console.log('  ✗ ' + m));
if (bad.length) {
  console.log(`\nStopped: ${deploy ? 'the deploy' : arg('--remote-url') ? 'the push' : 'this folder'} does not match project.json (${P.id}). Nothing was ${deploy ? 'deployed' : 'pushed'}. See docs/two-projects.md.`);
  process.exit(1);
}
