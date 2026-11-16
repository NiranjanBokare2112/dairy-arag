// Staff: login sessions, logout, failed PIN logging + lockout, add/disable operators, device labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceLabel } from '../public/src/lib/device.js';

test('device label from user agent', () => {
  assert.deepEqual(deviceLabel('Mozilla/5.0 (Linux; Android 12; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'), { os: 'android', browser: 'Chrome', mobile: true });
  assert.deepEqual(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Edg/124.0'), { os: 'windows', browser: 'Edge', mobile: false });
  assert.equal(deviceLabel('').os, 'other');
});

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { api } = await import('../public/src/api/mock.js');

test('login opens a session, logout closes it, owner sees both in history', async () => {
  await api.login('u-op1', '1111');
  await api.logout();
  await api.login('u-owner', '1234');
  const { sessions } = await api.loginHistory({ userId: 'u-op1' });
  const latest = sessions[0];
  assert.ok(latest.loginAt && latest.logoutAt, 'operator session has login and logout time');
  const staff = await api.staff();
  const op = staff.find((s) => s.id === 'u-op1');
  assert.equal(op.lastLoginAt, latest.loginAt);
  assert.equal(op.online, false);
  assert.equal(staff.find((s) => s.id === 'u-owner').online, true);
  assert.ok(!('pin' in op), 'PIN is never returned');
  assert.ok((await api.audit({ userId: 'u-op1', actions: ['login', 'logout'] })).length >= 2);
});

test('wrong PINs are logged; 5 within 10 minutes lock the account', async () => {
  for (let i = 0; i < 5; i++) await assert.rejects(api.login('u-op1', '0000'), (e) => e.code === 'bad-pin');
  await assert.rejects(api.login('u-op1', '1111'), (e) => e.code === 'too-many-attempts');
  await api.login('u-owner', '1234');
  const { failed } = await api.loginHistory({ userId: 'u-op1' });
  assert.ok(failed.length >= 5);
  assert.equal((await api.staff()).find((s) => s.id === 'u-op1').failed >= 5, true);
});

test('owner adds an operator, who can log in; disabling blocks login and hides from the login list', async () => {
  await api.login('u-owner', '1234');
  await assert.rejects(api.saveUser({ name: 'नवीन', pin: '12' }), (e) => e.code === 'invalid-pin');
  const op = await api.saveUser({ name: 'सचिन', mobile: '9876543210', pin: '4321' });
  assert.equal(op.role, 'operator');
  await api.login(op.id, '4321');
  assert.equal((await api.me()).id, op.id);
  await assert.rejects(api.saveUser({ id: op.id, name: 'x' }), (e) => e.code === 'forbidden'); // operators cannot manage staff
  await api.logout();
  await api.login('u-owner', '1234');
  await api.saveUser({ id: op.id, name: 'सचिन', active: false });
  await assert.rejects(api.login(op.id, '4321'), (e) => e.code === 'bad-pin');
  assert.ok(!(await api.users()).some((u) => u.id === op.id));
  await assert.rejects(api.saveUser({ id: 'u-owner', name: 'मालक', active: false }), (e) => e.code === 'cannot-disable-owner');
});

test('staff log in with a 4-digit PIN + OTP on WhatsApp (D-137)', async () => {
  // PINs: 4 digits, unique; a WhatsApp number is required
  await api.login('u-owner', '1234');
  await assert.rejects(api.saveUser({ name: 'नवीन', pin: '55555', mobile: '9876500111' }), (e) => e.code === 'invalid-pin');
  await assert.rejects(api.saveUser({ name: 'नवीन', pin: '1111', mobile: '9876500111' }), (e) => e.code === 'pin-taken');
  await assert.rejects(api.saveUser({ name: 'नवीन', pin: '5555' }), (e) => e.code === 'mobile-required');
  await api.saveUser({ name: 'नवीन ऑपरेटर', pin: '4545', mobile: '9876500111' });
  await api.logout();
  // wrong PIN, then the operator: PIN → OTP (shown in test mode) → in
  await assert.rejects(api.requestStaffOtp({ pin: '0007' }), (e) => e.code === 'bad-pin');
  await assert.rejects(api.requestStaffOtp({ pin: '12' }), (e) => e.code === 'invalid-pin');
  const s = await api.requestStaffOtp({ pin: '4545' });
  assert.equal(s.sentTo, 'XXXXXX0111'); assert.equal(s.channel, 'whatsapp'); assert.equal(s.testOtp.length, 6); assert.ok(s.name);
  await assert.rejects(api.requestStaffOtp({ pin: '4545' }), (e) => e.code === 'otp-wait'); // resend only after 30 s
  await assert.rejects(api.verifyStaffOtp({ ref: s.ref, otp: s.testOtp === '000000' ? '111111' : '000000' }), (e) => e.code === 'otp-wrong');
  const u = await api.verifyStaffOtp({ ref: s.ref, otp: s.testOtp });
  assert.equal(u.role, 'operator'); assert.equal(u.pin, undefined);
  await assert.rejects(api.verifyStaffOtp({ ref: s.ref, otp: s.testOtp }), (e) => e.code === 'otp-expired'); // used once only
  await api.logout();
  // owner: 5 wrong OTPs cancel it
  const o = await api.requestStaffOtp({ pin: '1234' });
  const wrong = o.testOtp === '222222' ? '333333' : '222222';
  for (let i = 0; i < 4; i++) await assert.rejects(api.verifyStaffOtp({ ref: o.ref, otp: wrong }), (e) => e.code === 'otp-wrong');
  await assert.rejects(api.verifyStaffOtp({ ref: o.ref, otp: wrong }), (e) => e.code === 'otp-locked');
  await assert.rejects(api.verifyStaffOtp({ ref: o.ref, otp: o.testOtp }), (e) => e.code === 'otp-expired');
});
