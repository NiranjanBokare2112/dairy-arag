// Outbox rules (A8). Pure functions shared by the UI and the future backend worker.
// Statuses: queued → sent | failed ; 'deferred' when the SMS daily cap is reached.
import { addDays } from './dates.js';

export const MAX_ATTEMPTS = 6;
export const WHATSAPP_ATTEMPTS_BEFORE_SMS = 3;

/** Channel for a farmer, or null when we must not message them (A8.7: active + consent + mobile). */
export function chooseChannel(farmer) {
  if (!farmer || !farmer.active || !farmer.consent || !farmer.mobile) return null;
  return farmer.hasWhatsapp ? 'whatsapp' : 'sms';
}

/** Exponential backoff after the n-th failure: 1, 2, 4, 8, 16, 32 … capped at 60 minutes. */
export const backoffMs = (attempts) => Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60000;

/** SMS daily counter. counter = { date, sent }; a counter from an earlier day counts as 0. */
export function smsAllowance(counter, today, cap) {
  const sent = counter && counter.date === today ? counter.sent : 0;
  return { sent, remaining: Math.max(0, cap - sent) };
}

/** Messages due now, honouring the SMS cap (A8.4). Oldest first. Returns { send, defer }. */
export function selectDue(messages, { nowMs, today, smsCounter, smsCap }) {
  let { remaining } = smsAllowance(smsCounter, today, smsCap);
  const send = []; const defer = [];
  const due = messages
    .filter((m) => (m.status === 'queued' || m.status === 'deferred') && (m.nextAttemptAt ?? 0) <= nowMs)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  for (const m of due) {
    if (m.channel === 'sms') {
      if (remaining > 0) { remaining--; send.push(m); } else defer.push(m);
    } else send.push(m);
  }
  return { send, defer };
}

/** Next state after a failed attempt. WhatsApp falls back to SMS after N failures (A8.3). */
export function afterFailure(msg, { nowMs, error }) {
  const attempts = (msg.attempts || 0) + 1;
  const next = { ...msg, attempts, lastError: String(error || 'error') };
  if (msg.channel === 'whatsapp' && !msg.noSms && attempts >= WHATSAPP_ATTEMPTS_BEFORE_SMS) { // noSms: broadcast notice the owner did not allow on SMS (D-72)
    return { ...next, channel: 'sms', attempts: 0, status: 'queued', nextAttemptAt: nowMs, fellBack: true };
  }
  if (attempts >= MAX_ATTEMPTS) return { ...next, status: 'failed' };
  return { ...next, status: 'queued', nextAttemptAt: nowMs + backoffMs(attempts) };
}

/** Epoch ms of 00:00 IST on a date. */
export const istMidnightMs = (iso) => Date.parse(iso + 'T00:00:00+05:30');

/** A deferred SMS waits until the next IST day starts. */
export const deferToNextDay = (msg, today) => ({ ...msg, status: 'deferred', nextAttemptAt: istMidnightMs(addDays(today, 1)) });
