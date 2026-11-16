// D-72: broadcast notice — owner and operator; WhatsApp to consented farmers; SMS only when allowed, never as fallback otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');
const { afterFailure } = await import('../public/src/lib/outbox.js');

test('operator broadcasts a notice; counts, SMS rule and no SMS fallback', async () => {
  await api.login('u-op1', '1111');
  const p = await api.broadcast({ text: 'उद्या संकलन ८ वाजता', preview: true });
  assert.ok(p.whatsapp > 0);
  assert.equal(p.sms, 0);
  const withSms = await api.broadcast({ text: 'उद्या संकलन ८ वाजता', sms: true, preview: true });
  assert.ok(withSms.sms >= 0 && withSms.whatsapp === p.whatsapp);
  await assert.rejects(api.broadcast({ text: '' }), { code: 'notice-empty' });
  await assert.rejects(api.broadcast({ text: 'x'.repeat(141), sms: true }), { code: 'notice-sms-too-long' });
  const rec = await api.broadcast({ text: 'उद्या संकलन ८ वाजता' });
  const out = (await api.outbox()).filter((m) => m.broadcastId === rec.id);
  assert.equal(out.length, p.whatsapp);
  assert.ok(out.every((m) => m.kind === 'notice' && m.channel === 'whatsapp' && m.noSms));
  // a WhatsApp notice that keeps failing is retried, never moved to SMS
  let m = out[0]; for (let i = 0; i < 6; i++) m = afterFailure(m, { nowMs: 0, error: 'x' });
  assert.equal(m.channel, 'whatsapp');
  const codes = await api.broadcast({ text: 'नमस्कार', audience: 'codes', codes: [101, 99999], preview: true });
  assert.deepEqual(codes.unknown, [99999]);
  await api.logout();
});
