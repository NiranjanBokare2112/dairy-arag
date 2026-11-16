// Outgoing message texts (Marathi). WhatsApp texts mirror the utility templates that must be
// approved in Meta Business Manager; SMS texts are kept short (Unicode ≈ 70 chars/segment).
import { formatRupees } from '../lib/money.js';
import { fmtLitres, fmtTenths } from '../lib/qty.js';
import { fmtDate, fmtDayMonth } from '../lib/dates.js';

const SH = { morning: 'सकाळ', evening: 'संध्या' };

/** entries: that farmer's entries for the day. */
export function dailySummary({ farmer, date, entries }) {
  const total = entries.reduce((s, e) => s + e.amountPaise, 0);
  const lines = entries.map((e) => `${SH[e.shift]}: ${fmtLitres(e.litresX100)} ली, फॅट ${fmtTenths(e.fatX10)}, SNF ${fmtTenths(e.snfX10)}, ₹${formatRupees(e.amountPaise)}`);
  const whatsapp = `नमस्कार ${farmer.name},\nदि. ${fmtDate(date)} चे दूध:\n${lines.join('\n')}\nआजची रक्कम: ₹${formatRupees(total)}\n— आरग दूध संकलन केंद्र`;
  const litres = entries.reduce((s, e) => s + e.litresX100, 0);
  const sms = `आरग दूध ${fmtDayMonth(date)}: ${fmtLitres(litres)}ली ₹${formatRupees(total)}`;
  return { whatsapp, sms };
}

export function billMessage({ farmer, bill, link }) {
  const period = `${fmtDate(bill.start)} ते ${fmtDate(bill.end)}`;
  const whatsapp = `नमस्कार ${farmer.name},\n${period} चे दूध बिल सोबत जोडले आहे.\nनिव्वळ देय: ₹${formatRupees(bill.payablePaise)}\n— आरग दूध संकलन केंद्र`;
  const sms = `आरग दूध बिल ${fmtDayMonth(bill.start)}-${fmtDayMonth(bill.end)}: ₹${formatRupees(bill.payablePaise)} ${link}`;
  return { whatsapp, sms };
}

/** Broadcast notice from the center (D-72). WhatsApp: full text; SMS (only if allowed): short prefix + text. */
export function noticeMessage({ text }) {
  return { whatsapp: `📢 आरग दूध संकलन केंद्र — सूचना\n${text}`, sms: `आरग दूध केंद्र: ${text}` };
}

const MILK = { cow: 'गाय', buffalo: 'म्हैस' };
const SHIFT_FULL = { morning: 'सकाळ', evening: 'संध्याकाळ' };
/** One message per milk entry, sent as soon as it is saved (D-73). */
export function pourMessage({ farmer, entry: e }) {
  const whatsapp = `नमस्कार ${farmer.name},\n${fmtDate(e.date)} ${SHIFT_FULL[e.shift]} · ${MILK[e.milkType]} दूध\n${fmtLitres(e.litresX100)} ली · फॅट ${fmtTenths(e.fatX10)} · SNF ${fmtTenths(e.snfX10)}\nदर ₹${formatRupees(e.ratePaise)} · रक्कम ₹${formatRupees(e.amountPaise)}\n— आरग दूध संकलन केंद्र`;
  const sms = `आरग दूध ${fmtDayMonth(e.date)} ${SH[e.shift]} ${MILK[e.milkType]}: ${fmtLitres(e.litresX100)}ली फॅट${fmtTenths(e.fatX10)} SNF${fmtTenths(e.snfX10)} ₹${formatRupees(e.amountPaise)}`;
  return { whatsapp, sms };
}
/** After an approved correction: the new figures, or that the entry was cancelled (D-73). */
export function pourFixMessage({ farmer, entry: e }) {
  const head = `${fmtDate(e.date)} ${SHIFT_FULL[e.shift]} · ${MILK[e.milkType]} दूध`;
  if (e.void) return { whatsapp: `नमस्कार ${farmer.name},\nदुरुस्ती: ${head} ची नोंद रद्द केली आहे.\n— आरग दूध संकलन केंद्र`, sms: `आरग दूध दुरुस्ती ${fmtDayMonth(e.date)} ${SH[e.shift]} ${MILK[e.milkType]}: नोंद रद्द` };
  return {
    whatsapp: `नमस्कार ${farmer.name},\nदुरुस्ती: ${head}\nआता ${fmtLitres(e.litresX100)} ली · फॅट ${fmtTenths(e.fatX10)} · SNF ${fmtTenths(e.snfX10)}\nदर ₹${formatRupees(e.ratePaise)} · रक्कम ₹${formatRupees(e.amountPaise)}\n— आरग दूध संकलन केंद्र`,
    sms: `आरग दूध दुरुस्ती ${fmtDayMonth(e.date)} ${SH[e.shift]} ${MILK[e.milkType]}: ${fmtLitres(e.litresX100)}ली ₹${formatRupees(e.amountPaise)}`,
  };
}

/** Reply to a farmer's help ticket (D-109): short, points to "मदत" in their login. */
export function supportReplyMessage({ farmer, ticket }) {
  return {
    whatsapp: `नमस्कार ${farmer.name},\nतुमच्या तक्रार क्र. ${ticket.no} ("${ticket.subject}") ला उत्तर आले आहे.\nतुमच्या लॉगिनमध्ये "मदत" मध्ये पहा.\n— आरग दूध संकलन केंद्र`,
    sms: `आरग दूध केंद्र: तक्रार ${ticket.no} ला उत्तर आले. लॉगिन करून "मदत" पहा.`,
  };
}

/** Farmer payout status (D-110): sent after the gateway confirms, fails or the bank reverses it. */
export function payoutMessage({ farmer, payout: x, status }) {
  const amt = '₹' + formatRupees(x.creditPaise);
  const to = x.method === 'bank' ? 'बँक खात्यात' : 'UPI वर';
  if (status === 'success') return {
    whatsapp: `नमस्कार ${farmer.name},\nतुमच्या ${to} ${amt} जमा झाले.\nसंदर्भ (UTR): ${x.ref}\n— आरग दूध संकलन केंद्र`,
    sms: `आरग दूध केंद्र: ${amt} ${to} जमा. UTR ${x.ref}`,
  };
  if (status === 'reversed') return {
    whatsapp: `नमस्कार ${farmer.name},\n${amt} चे पेमेंट बँकेने परत केले. रक्कम तुमच्या नावे बाकी आहे — केंद्र पुन्हा पाठवेल.\n— आरग दूध संकलन केंद्र`,
    sms: `आरग दूध केंद्र: ${amt} पेमेंट बँकेने परत केले; रक्कम बाकी आहे, पुन्हा पाठवू.`,
  };
  return {
    whatsapp: `नमस्कार ${farmer.name},\n${amt} चे पेमेंट आत्ता जाऊ शकले नाही. रक्कम तुमच्या नावे बाकी आहे — केंद्र पुन्हा पाठवेल.\n— आरग दूध संकलन केंद्र`,
    sms: `आरग दूध केंद्र: ${amt} पेमेंट अयशस्वी; रक्कम बाकी आहे, पुन्हा पाठवू.`,
  };
}
