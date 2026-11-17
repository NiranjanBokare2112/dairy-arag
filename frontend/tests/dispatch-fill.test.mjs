// D-139: a saved dairy dispatch can be corrected (same date + shift + milk); without `replace` it is still a duplicate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');

test('dispatch: duplicate refused, correction with replace updates the same entry', async () => {
  await api.login('u-owner', '1234');
  const [d] = await api.dispatches({});
  assert.ok(d, 'demo data has dispatches');
  const base = { date: d.date, shift: d.shift, milkType: d.milkType, litresX100: d.litresX100, fatX10: d.fatX10, snfX10: d.snfX10, ratePaise: d.ratePaise, amountPaise: d.amountPaise };
  await assert.rejects(api.addDispatch(base), (e) => e.code === 'duplicate');
  const fixed = await api.addDispatch({ ...base, litresX100: d.litresX100 + 100, amountPaise: d.amountPaise + d.ratePaise, replace: true });
  assert.equal(fixed.id, d.id); assert.equal(fixed.litresX100, d.litresX100 + 100);
  const all = (await api.dispatches({ from: d.date, to: d.date })).filter((x) => x.shift === d.shift && x.milkType === d.milkType);
  assert.equal(all.length, 1, 'still one entry for that shift');
});
