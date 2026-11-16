// Help-ticket service levels (D-138). Pure functions; times are epoch milliseconds or ISO strings.
//
// Bokare support promises, from the moment a ticket is raised:
//   urgent  — first reply within 2 hours,  solved within 24 hours
//   normal  — first reply within 8 hours,  solved within 72 hours
// The clock is paused while the ticket waits for the reporter (status 'waiting') and stops when it is resolved /
// closed. "First reply" = the first written answer from Bokare support.
export const SLA = Object.freeze({
  urgent: { replyH: 2, resolveH: 24 },
  normal: { replyH: 8, resolveH: 72 },
});
const H = 3600000;
const ms = (x) => (typeof x === 'number' ? x : Date.parse(x));

/** Milliseconds the ticket spent in 'waiting' between `from` and `to` (from its status messages). */
export function pausedMs(tk, from, to) {
  let total = 0; let since = null;
  for (const m of tk.messages || []) {
    if (!m.status) continue;
    const at = ms(m.at);
    if (m.status === 'waiting' && since == null) since = at;
    else if (m.status !== 'waiting' && since != null) { total += overlap(since, at, from, to); since = null; }
  }
  if (since != null) total += overlap(since, to, from, to);
  return total;
}
const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/** When it was solved: the last resolved / closed status while the ticket is still in that state (else null). */
function doneAt(tk) {
  if (!['resolved', 'closed'].includes(tk.status)) return null;
  const last = [...(tk.messages || [])].reverse().find((m) => ['resolved', 'closed'].includes(m.status));
  return last ? ms(last.at) : ms(tk.updatedAt);
}

/**
 * One clock: { due, at, state, leftMs } — state 'met' (done in time), 'late' (done after the due time),
 * 'ok' (running, more than a quarter left), 'soon' (running, less than a quarter left), 'breached' (running, past due).
 */
function clock(tk, hours, at, now) {
  const start = ms(tk.createdAt); const budget = hours * H;
  const end = at ?? now;
  const used = end - start - pausedMs(tk, start, end);
  const due = start + budget + pausedMs(tk, start, end); // shown due time moves with the pauses
  if (at != null) return { due, at, state: used <= budget ? 'met' : 'late', leftMs: budget - used };
  const left = budget - used;
  return { due, at: null, state: left < 0 ? 'breached' : left < budget / 4 ? 'soon' : 'ok', leftMs: left };
}

/** Both clocks of a ticket at `now`: { reply, resolve, target } */
export function slaOf(tk, now = Date.now()) {
  const target = SLA[tk.priority] || SLA.normal;
  const firstReply = (tk.messages || []).find((m) => m.by?.kind === 'support' && m.text);
  const done = doneAt(tk);
  return {
    target,
    reply: clock(tk, target.replyH, firstReply ? ms(firstReply.at) : done, now),
    resolve: clock(tk, target.resolveH, done, now),
  };
}

/** The clock that matters now (reply until answered, then resolve) — for sorting and the list badge. */
export function slaNext(tk, now = Date.now()) {
  const s = slaOf(tk, now);
  return s.reply.at == null ? { kind: 'reply', ...s.reply } : { kind: 'resolve', ...s.resolve };
}
