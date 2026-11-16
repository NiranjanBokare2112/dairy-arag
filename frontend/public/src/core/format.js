// Display helpers. Latin digits in tables/inputs (B3.3).
import { formatRupees } from '../lib/money.js';
import { fmtLitres, fmtTenths, formatFixed } from '../lib/qty.js';
import { fmtDate, fmtDateTime } from '../lib/dates.js';
import { t } from './i18n.js';

export const rs = (paise) => formatRupees(paise, { symbol: true });
export const rsPlain = (paise) => formatRupees(paise);
export const litres = (x100) => fmtLitres(x100);
export const tenths = (x10) => fmtTenths(x10);
export const hundredths = (x100) => formatFixed(x100, 2);
export const date = fmtDate;
export const dateTime = fmtDateTime;
export const shift = (s) => t('shift.' + s);
export const milk = (m) => t('milk.' + m);
export const maskMobile = (m) => (m && m.length >= 10 ? m.slice(0, 2) + 'XXXXXX' + m.slice(-2) : m || '');
