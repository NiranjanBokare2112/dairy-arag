// Owner's dashboard layout (D-85): which sections and cards show, and in what order. Saved in center settings as
// center.dashboard = { order: [section ids], off: [section or card ids] }. Sections / cards added in later versions
// appear on their own (on or off by their default) without disturbing a saved layout.

/** Sections in their default order. `items` = cards / charts inside a section that can be switched on and off. */
// D-117: simple by default — milk, the profit calculation and money; everything else is off until the owner switches it on.
export const LAYOUT_VERSION = 2;
export const DASH_SECTIONS = [
  { id: 'milk', on: true },
  { id: 'profit', on: true },
  { id: 'money', on: true },
  { id: 'kpis', on: false, items: [['kpi.purchase', true], ['kpi.profit', true], ['kpi.quality', true], ['kpi.farmers', true], ['kpi.perLitre', false], ['kpi.avgRate', false]] },
  { id: 'balances', on: false },
  { id: 'payouts', on: false }, // D-113: farmers' UPI / bank payouts (summarised in 'money')
  { id: 'charts', on: false, items: [['chart.byShift', true], ['chart.daily', true], ['chart.quality', false]] },
  { id: 'sales', on: false },
  { id: 'shrink', on: false },
  { id: 'suppliers', on: false, items: [['sup.top', true], ['sup.low', true]] },
  { id: 'payments', on: false },
  { id: 'ledger', on: false },
  { id: 'messages', on: false },
];

const DEFAULT_OFF = [...DASH_SECTIONS.filter((s) => !s.on).map((s) => s.id), ...DASH_SECTIONS.flatMap((s) => (s.items || []).filter(([, on]) => !on).map(([id]) => id))];

/** The layout to use: the saved one, completed with anything new. */
export function dashLayout(saved) {
  if (saved && saved.v !== LAYOUT_VERSION) saved = null; // D-117: the new simple layout replaces older saved ones
  const known = DASH_SECTIONS.map((s) => s.id);
  const order = [...(saved?.order || []).filter((id) => known.includes(id)), ...known.filter((id) => !(saved?.order || []).includes(id))];
  const seen = new Set(saved?.seen || []); // ids the owner has already decided about
  const off = new Set(saved?.off || []);
  for (const id of DEFAULT_OFF) if (!seen.has(id)) off.add(id); // new optional items start off
  return { order, off };
}

/** What to save after the owner's choices. */
export function layoutToSave(order, off) {
  const all = DASH_SECTIONS.flatMap((s) => [s.id, ...(s.items || []).map(([id]) => id)]);
  return { order, off: [...off], seen: all, v: LAYOUT_VERSION };
}
