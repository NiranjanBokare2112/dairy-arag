# आरग दूध संकलन केंद्र — Arag Dudh Sankalan Kendra

**Milk Collection & Farmer Billing System** — a client project of Bokare Technologies.

A milk collection and farmer billing system for a new collection center in Arag village (Tal. Miraj, Dist. Sangli, Maharashtra). Farmers pour cow and buffalo milk twice a day; the price per litre comes from a configurable Fat × SNF rate chart. The system records shift-wise collection, sells cattle feed on credit and gives advances, generates Marathi PDF bills every 7 or 10 days with deductions, records UPI/cash payments, tracks dispatch to the dairy, and sends a daily WhatsApp summary and the bill PDF to farmers (with SMS fallback). It runs self-hosted on the center's own Windows desktop, works offline over the local Wi-Fi, and exposes the owner dashboard online through a Cloudflare Tunnel. The UI is Marathi first and built for non-technical operators on cheap Android phones.

See [CLAUDE.md](CLAUDE.md) for the full brief.

## Folder structure

```
CLAUDE.md          project brief — read before every task
SETUP_PROMPT.md    first-run setup prompt for Claude Code
README.md          this file
.env.example       environment variable names (copy to .env, never commit .env)
design-assets/     logos, letterhead, bill design — source of truth for visuals
docs/              requirements, decisions log, deployment & backup/restore guides
backend/           API, database, billing engine, messaging workers
frontend/          PWA: operator app + owner dashboard
scripts/           install/run as Windows service, backup, restore, seed data
```

**Status:** the frontend (all Phase 1 screens) is built and runs on a demo mock API — see `frontend/README.md`. The backend is not started.
