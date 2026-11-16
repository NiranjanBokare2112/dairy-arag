// SIMULATED payout gateway (D-107). No money moves. It behaves like a real provider (Cashfree Payouts / RazorpayX)
// so every screen can be built and tested; the real provider later replaces only these two functions.
//   verify(upiId)  — ₹1 "penny drop": does the UPI ID exist, and whose name does the bank have for it?
//   send(payout)   — pay an amount to a UPI ID; returns success with a bank reference (UTR) or a failure reason.
// Results are deterministic (a hash of the UPI ID), so tests and demos are repeatable.

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const UPI_RE = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/i;

// what a bank would return as the account holder's name for the demo farmers (English, upper case)
const BANK_NAMES = {
  'रामचंद्र पाटील': 'RAMCHANDRA PATIL', 'सुनीता जाधव': 'SUNITA JADHAV', 'विठ्ठल माने': 'VITTHAL MANE', 'शांताबाई कांबळे': 'SHANTABAI KAMBLE',
  'दत्तात्रय शिंदे': 'DATTATRAY SHINDE', 'मीरा पवार': 'MEERA PAWAR', 'गणपत चव्हाण': 'GANPAT CHAVAN', 'अनिता कुलकर्णी': 'ANITA KULKARNI',
  'बाळासाहेब देसाई': 'BALASAHEB DESAI', 'संगीता मोरे': 'SANGITA MORE', 'तुकाराम गायकवाड': 'TUKARAM GAIKWAD', 'लक्ष्मी साळुंखे': 'LAXMI SALUNKHE',
};
const ref = (seed) => 'SIM' + String(hash(seed)).padStart(10, '0').slice(0, 10);

export const SIM_NOTE = 'simulated';

/** ₹1 check of a UPI ID. → { ok, name?, ref?, reason? } */
export function simVerify(upiId, farmerName) {
  if (!upiId || !UPI_RE.test(upiId)) return { ok: false, reason: 'invalid-vpa' };
  const h = hash(upiId.toLowerCase());
  if (h % 17 === 3) return { ok: false, reason: 'vpa-not-found' };
  const bank = BANK_NAMES[farmerName] || String(farmerName || '').toUpperCase();
  // now and then the account is in someone else's name (wife, son…): the owner must look and decide
  const name = h % 11 === 5 ? 'SHRI ' + bank.split(' ').reverse().join(' ') : bank;
  return { ok: true, name, ref: ref('v' + upiId + Date.now()) };
}

/** ₹1 to a bank account (IMPS "penny drop"): does the account exist, whose name is it in? → { ok, name?, ref?, reason? } */
export function simVerifyBank(account, ifsc, farmerName) {
  if (!/^\d{9,18}$/.test(String(account || ''))) return { ok: false, reason: 'invalid-account' };
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(ifsc || '').toUpperCase())) return { ok: false, reason: 'invalid-ifsc' };
  const h = hash(account + ifsc);
  if (h % 19 === 4) return { ok: false, reason: 'account-not-found' };
  const bank = BANK_NAMES[farmerName] || String(farmerName || '').toUpperCase();
  return { ok: true, name: h % 13 === 6 ? 'SMT ' + bank.split(' ').reverse().join(' ') : bank, ref: ref('b' + account + Date.now()) };
}

/**
 * Hand a payout to the gateway. Like a real provider it only ACCEPTS it now; the result comes later by webhook (D-110):
 * → { accepted, reason?, outcome: 'success' | 'failed', failReason?, utr?, reverse? (a success the bank reverses later) }
 */
export function simSend({ to, amountPaise, key }) {
  if (!to) return { accepted: false, reason: 'invalid-destination' };
  if (!(amountPaise > 0)) return { accepted: false, reason: 'invalid-amount' };
  const h = hash(key);
  if (h % 29 === 7) return { accepted: true, outcome: 'failed', failReason: 'bank-down' };
  return { accepted: true, outcome: 'success', utr: ref('p' + key), reverse: h % 41 === 11 };
}
