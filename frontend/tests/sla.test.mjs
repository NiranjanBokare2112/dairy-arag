// D-138: help-ticket service levels — reply / solve clocks, pause while waiting for the reporter, ticket pictures + contact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { slaOf, slaNext, pausedMs } = await import('../public/src/lib/sla.js');
const { api } = await import('../public/src/api/mock.js');
const H = 3600000; const T0 = Date.parse('2026-11-17T10:00:00+05:30');
const at = (h) => new Date(T0 + h * H).toISOString();
const tk = (priority, messages, status = 'open') => ({ priority, status, createdAt: at(0), updatedAt: at(0), messages: [{ by: { kind: 'operator' }, text: 'x', at: at(0) }, ...messages] });

test('urgent: reply due in 2 h, solve in 24 h; running clocks', () => {
  const s = slaOf(tk('urgent', []), T0 + 1 * H);
  assert.equal(s.reply.state, 'ok'); assert.equal(s.reply.leftMs, 1 * H); assert.equal(s.reply.due, T0 + 2 * H);
  assert.equal(slaOf(tk('urgent', []), T0 + 1.6 * H).reply.state, 'soon');
  assert.equal(slaOf(tk('urgent', []), T0 + 3 * H).reply.state, 'breached');
  assert.equal(slaOf(tk('urgent', []), T0 + 3 * H).resolve.state, 'ok');
});
test('normal: first written support reply stops the reply clock; solved in time', () => {
  const t1 = tk('normal', [{ by: { kind: 'support' }, text: 'पाहतो', at: at(5) }, { by: { kind: 'support' }, status: 'resolved', at: at(30) }], 'resolved');
  const s = slaOf(t1, T0 + 100 * H);
  assert.equal(s.reply.state, 'met'); assert.equal(s.resolve.state, 'met');
  const late = tk('normal', [{ by: { kind: 'support' }, text: 'उशीर', at: at(9) }]);
  assert.equal(slaOf(late, T0 + 10 * H).reply.state, 'late');
  assert.equal(slaNext(late, T0 + 10 * H).kind, 'resolve');
});
test('waiting for the reporter pauses the clock', () => {
  const t1 = tk('urgent', [{ by: { kind: 'support' }, status: 'waiting', at: at(1) }, { by: { kind: 'operator' }, status: 'open', at: at(11) }]);
  assert.equal(pausedMs(t1, T0, T0 + 12 * H), 10 * H);
  const s = slaOf(t1, T0 + 12 * H); // 12 h passed, 10 h paused → 2 h used of 2 h
  assert.equal(s.reply.leftMs, 0); assert.equal(s.reply.due, T0 + 12 * H);
});
test('tickets carry screenshots and who raised it (with mobile) for support', async () => {
  await api.login('u-op1', '1111');
  const px = 'data:image/jpeg;base64,' + 'A'.repeat(200);
  const t1 = await api.createTicket({ category: 'app', subject: 'प्रिंटर', text: 'प्रिंटर चालू होत नाही', images: [px, px, px, px] });
  assert.equal(t1.messages[0].images.length, 3, 'at most 3 pictures');
  assert.equal(t1.who.mobile, '9876501111'); assert.equal(t1.who.kind, 'operator');
  await api.logout(); await api.login('u-support', '9999');
  const seen = await api.ticket(t1.id);
  assert.equal(seen.who.name, 'ऑपरेटर १'); assert.ok(seen.who.center);
  const r = await api.replyTicket(t1.id, '', [px]);
  assert.equal(r.messages.at(-1).images.length, 1, 'a reply can be only a picture');
});
