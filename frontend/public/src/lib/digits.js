const MR = '०१२३४५६७८९';
/** Convert Latin digits to Marathi (Devanagari) digits — used only on printed bills when the setting is on. */
export const toMarathiDigits = (s) => String(s).replace(/[0-9]/g, (d) => MR[d]);
export const maybeMr = (s, on) => (on ? toMarathiDigits(s) : String(s));
