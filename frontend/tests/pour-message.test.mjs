// D-73: a WhatsApp/SMS message per milk entry, queued as soon as it is saved; corrections send the new figures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const { uuid } = await import('../public/src/lib/uuid.js');
const { addDays, todayIST } = await import('../public/src/lib/dates.js');

test('saving a milk entry queues one message with its figures; a retry does not add another', async () => {
  await api.login('u-owner', '1234');
  const date = addDays(todayIST(), 1); // a day with no entries yet
  const f = (await api.farmers()).find((x) => x.consent && x.mobile && x.milkTypes.includes('cow'));
  const id = uuid();
  const entry = { id, farmerId: f.id, date, shift: 'morning', milkType: 'cow', litresX100: 650, fatX10: 41, snfX10: 85 };
  await api.addCollection(entry);
  await api.addCollection(entry); // idempotent retry
  const msgs = (await api.outbox({ farmerId: f.id })).filter((m) => m.entryId === id);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].kind, 'pour');
  assert.match(msgs[0].texts.whatsapp, /6\.50 ली/);
  assert.match(msgs[0].texts.whatsapp, /फॅट 4\.1/);
  assert.match(msgs[0].texts.sms, /गाय/);
  // owner correction (applies at once) -> a correction message with the new litres
  await api.requestCorrection(id, { litresX100: 700, fatX10: 41, snfX10: 85, reason: 'test' });
  const fix = (await api.outbox({ farmerId: f.id })).filter((m) => m.kind === 'pour-fix');
  assert.equal(fix.length, 1);
  assert.match(fix[0].texts.whatsapp, /दुरुस्ती/);
  assert.match(fix[0].texts.whatsapp, /7\.00 ली/);
  await api.logout();
});
