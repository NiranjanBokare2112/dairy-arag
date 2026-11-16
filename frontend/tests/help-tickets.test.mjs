// D-109: help / support tickets — anyone reports, Bokare support is told (email + WhatsApp), replies and status are tracked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');

test('a farmer reports; Bokare support answers; the farmer is told and closes it', async () => {
  await api.farmerLogin(103);
  await assert.rejects(api.createTicket({ category: 'milk', subject: '', text: 'काहीतरी' }), { code: 'ticket-subject-required' });
  const tk = await api.createTicket({ category: 'milk', subject: 'कालचे दूध दिसत नाही', text: 'संध्याकाळचे दूध नोंदीत नाही', priority: 'urgent' });
  assert.match(tk.no, /^T-\d{4}$/);
  assert.equal(tk.status, 'open');
  assert.deepEqual(tk.notify.map((n) => n.channel).sort(), ['email', 'whatsapp'], 'Bokare told by email + WhatsApp');
  await api.logout();

  // the support login is not on the centre's list
  assert.ok(!(await api.users()).some((u) => u.role === 'support'));
  assert.ok((await api.users({ support: true })).some((u) => u.role === 'support'));
  await api.login('u-support', '9999');
  const inbox = await api.tickets({});
  assert.ok(inbox.some((x) => x.id === tk.id));
  const before = (await api.outbox({})).filter((m) => m.kind === 'support').length;
  await api.replyTicket(tk.id, 'तपासले — नोंद आता दिसेल. कृपया पुन्हा पहा.');
  const after = await api.setTicketStatus(tk.id, 'resolved');
  assert.equal(after.status, 'resolved');
  assert.equal((await api.outbox({})).filter((m) => m.kind === 'support').length, before + 1, 'the farmer gets a WhatsApp / SMS');
  await api.logout();

  await api.farmerLogin(103);
  const mine = await api.tickets({});
  assert.equal(mine.find((x) => x.id === tk.id).unread, true, 'new reply shown');
  assert.equal((await api.ticket(tk.id)).messages.filter((m) => m.text).length, 2);
  assert.equal((await api.tickets({})).find((x) => x.id === tk.id).unread, false, 'read after opening');
  await assert.rejects(api.setTicketStatus(tk.id, 'in-progress'), { code: 'forbidden' });
  assert.equal((await api.setTicketStatus(tk.id, 'closed')).status, 'closed');
  await api.logout();
  // another farmer cannot see it
  await api.farmerLogin(104);
  await assert.rejects(api.ticket(tk.id), { code: 'not-found' });
  await api.logout();
});

test("operator's ticket: the owner sees it in the centre list; the operator's reply reopens a solved one", async () => {
  await api.login('u-op1', '1111');
  const tk = await api.createTicket({ category: 'app', subject: 'प्रिंटर जोडला जात नाही', text: 'ब्लूटूथ प्रिंटर दिसत नाही' });
  await api.logout();
  await api.login('u-owner', '1234');
  assert.ok(!(await api.tickets({})).some((x) => x.id === tk.id), 'not in the owner\'s own list');
  assert.ok((await api.tickets({ scope: 'center' })).some((x) => x.id === tk.id), 'in the centre list');
  await api.setTicketStatus(tk.id, 'resolved');
  await api.logout();
  await api.login('u-op1', '1111');
  const r = await api.replyTicket(tk.id, 'अजून चालत नाही');
  assert.equal(r.status, 'open'); assert.equal(r.notify.length, 4, 'Bokare told again');
  await api.logout();
});
