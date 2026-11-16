// Every key used in the UI exists in both languages, and mr/en have the same keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mr from '../public/src/i18n/mr.js';
import en from '../public/src/i18n/en.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../public/src');
const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : f.endsWith('.js') ? [join(d, f)] : []));

test('mr and en have identical keys', () => {
  assert.deepEqual(Object.keys(en).filter((k) => !(k in mr)), [], 'in en but not mr');
  assert.deepEqual(Object.keys(mr).filter((k) => !(k in en)), [], 'in mr but not en');
});

test('every static t("key") used in the source exists', () => {
  const missing = new Set();
  for (const f of files(SRC)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bt\(['`]([a-zA-Z0-9_.-]+)['`]/g)) {
      if (m[1].endsWith('.') || m[1].endsWith('-')) continue; // dynamic prefix like t('milk.' + x)
      if (!(m[1] in mr)) missing.add(m[1]);
    }
    for (const m of src.matchAll(/key: '([a-z.]+)'/g)) if (!(m[1] in mr)) missing.add(m[1]);
  }
  assert.deepEqual([...missing], []);
});

test('dynamic key families are complete', () => {
  const need = [
    ...['morning', 'evening'].map((x) => 'shift.' + x), ...['cow', 'buffalo'].map((x) => 'milk.' + x),
    ...['owner', 'operator'].map((x) => 'role.' + x), ...['sale', 'advance', 'stock'].map((x) => 'ledger.tab.' + x),
    ...['daily', 'bill'].map((x) => 'messages.kind.' + x), ...['queued', 'deferred', 'sent', 'failed'].map((x) => 'messages.status.' + x),
    ...['exact', 'nearest-lower', 'nearest'].map((x) => 'rates.rule.' + x), ...['approved', 'rejected'].map((x) => 'approvals.' + x),
    ...['too-short', 'bad-snf-header', 'not-ascending', 'bad-fat', 'bad-rate'].map((x) => 'rates.csv.' + x),
    ...['open', 'generated', 'finalized'].map((x) => 'billing.status.' + x),
  ];
  assert.deepEqual(need.filter((k) => !(k in mr)), []);
});

test('every ApiError code thrown by the mock API has a message', () => {
  const src = readFileSync(join(SRC, 'api/mock.js'), 'utf8');
  const codes = new Set([...src.matchAll(/ApiError\('([a-z-]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...codes].filter((c) => !(('err.' + c) in mr)), []);
});
