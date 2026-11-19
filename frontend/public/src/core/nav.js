// Navigation (labels via i18n). `bottom` = roles that see the item in the phone bottom bar (max 4, in this order);
// every other item of the role is in the bar's "अधिक" sheet (D-52), so phones can reach every page.
const NAV = [
  // No "मुख्य पान" item (D-44): "/" redirects to the role's start page (dashboard / collection).
  { path: '/dashboard', key: 'nav.dashboard', ic: 'chart', roles: ['owner'], bottom: ['owner'] },
  { path: '/collection', key: 'nav.collection', ic: 'milk', roles: ['owner', 'operator'], bottom: ['owner', 'operator'] },
  { path: '/ledger', key: 'nav.ledger', ic: 'sack', roles: ['owner', 'operator'], bottom: ['operator'] },
  { path: '/expenses', key: 'nav.expenses', ic: 'receipt', roles: ['owner', 'operator'] }, // खर्च (D-126)
  { path: '/farmers', key: 'nav.farmers', ic: 'users', roles: ['owner', 'operator'], bottom: ['owner'] },
  // बिल व पेमेंट (D-60): one item, two tabs (#/billing and #/billing?tab=pay)
  { path: '/billing', key: 'nav.billPay', ic: 'bill', roles: ['owner'], bottom: ['owner'] },
  { path: '/dispatch', key: 'nav.dispatch', ic: 'truck', roles: ['owner', 'operator'], bottom: ['operator'] },
  { path: '/buyers', key: 'nav.buyers', ic: 'handshake', roles: ['owner', 'operator'], bottom: ['operator'] }, // daily milk buyers (D-51)
  { path: '/rates', key: 'nav.rates', ic: 'grid', roles: ['owner'] },
  { path: '/messages', key: 'nav.messages', ic: 'chat', roles: ['owner', 'operator'] },
  // मंजुरी is not in the menu (D-71): it is a tab of बिल व पेमेंट (D-114), opened from the dashboard notices
  { path: '/schemes', key: 'nav.schemes', ic: 'scheme', roles: ['owner'] }, // सरकारी योजना → website (D-71)
  { path: '/doctors', key: 'nav.doctors', ic: 'doctor', roles: ['owner'] }, // पशुवैद्यक डॉक्टर → farmers' page + website (D-83)
  { path: '/settings', key: 'nav.settings', ic: 'gear', roles: ['owner'] },
  { path: '/staff', key: 'nav.staff', ic: 'idcard', roles: ['owner'] },
  { path: '/audit', key: 'nav.audit', ic: 'log', roles: ['owner'] },
  { path: '/help', key: 'nav.help', ic: 'help', roles: ['owner', 'operator'] }, // मदत — support tickets (D-109), always allowed
  { path: '/support', key: 'nav.support', ic: 'help', roles: ['support'], bottom: ['support'] }, // Bokare support inbox (D-109)
];
/** Pages an operator can be given (D-86); दूध संकलन is always allowed. */
export const OPERATOR_PAGES = NAV.filter((n) => n.roles.includes('operator') && n.path !== '/help'); // मदत is always there (D-109)
/** May this user open this page section? Owners: everything for their role; operators: only the pages the owner allowed. */
export const allowedFor = (user, path) => user.role !== 'operator' || !Array.isArray(user.pages) || path === '/collection' || path === '/help' || user.pages.includes(path)
  || !OPERATOR_PAGES.some((n) => n.path === path); // pages outside the menu (receipts…) follow their own role rules
/** Menu for a user (or a role, for old callers). */
export const navFor = (who) => { const user = typeof who === 'string' ? { role: who } : who; return NAV.filter((n) => n.roles.includes(user.role) && allowedFor(user, n.path)); };
/** Sidebar sections (D-144): daily work, farmers & money, management; मदत sits at the bottom. NAV order is kept inside a group. */
const GROUP = {'/dashboard': 'daily', '/collection': 'daily', '/ledger': 'daily', '/expenses': 'daily', '/dispatch': 'daily', '/buyers': 'daily', '/farmers': 'people', '/billing': 'people', '/messages': 'people', '/rates': 'admin', '/schemes': 'admin', '/doctors': 'admin', '/settings': 'admin', '/staff': 'admin', '/audit': 'admin', '/help': 'help', '/support': 'daily'};
export const NAV_GROUPS = ['daily', 'people', 'admin'];
export const navGroups = (items) => {
  const by = (g) => items.filter((n) => (GROUP[n.path] || 'admin') === g);
  return { groups: NAV_GROUPS.map((g) => ({ id: g, items: by(g) })).filter((g) => g.items.length), bottom: by('help') };
};
