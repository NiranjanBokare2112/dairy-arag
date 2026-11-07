# Decisions log

Each entry: date, decision, reason. Add new decisions at the bottom. Changing a decision needs the owner's / Bokare's agreement and a new entry (do not edit old ones).

## Deployment (CLAUDE.md §2)

| # | Date | Decision |
|---|---|---|
| D-01 | 2026-11-07 | Self-hosted on the center's own old Windows desktop (24×7 power backup). No monthly cloud hosting. |
| D-02 | 2026-11-07 | Works offline: operator phones/tablets connect to the desktop over the center's Wi-Fi (LAN). Collection, billing and printing work without internet. |
| D-03 | 2026-11-07 | Owner dashboard reachable remotely via Cloudflare Tunnel on the center's own domain, behind login. |
| D-04 | 2026-11-07 | Outgoing WhatsApp/SMS go through an outbox queue, sent when the network allows; nothing lost while offline. |
| D-05 | 2026-11-07 | Backups: local daily backup on the desktop + one off-site copy (free-tier cloud storage). Restore documented and tested. |

## Messaging (CLAUDE.md §3)

| # | Date | Decision |
|---|---|---|
| D-06 | 2026-11-07 | WhatsApp via Meta WhatsApp Cloud API directly (no BSP), approved utility templates, paid from client's own Meta account (~₹0.115–0.15/message). |
| D-07 | 2026-11-07 | One daily summary per farmer per day, after the evening shift (time configurable): morning + evening litres, Fat, SNF, day's amount. Not one message per pour. |
| D-08 | 2026-11-07 | At end of each bill cycle, send the Marathi PDF bill on WhatsApp. |
| D-09 | 2026-11-07 | SMS fallback (no WhatsApp or WhatsApp failure) from the center's own SIM (100 free SMS/day) via an Android SMS-gateway app on the LAN (candidate: SMS Gateway for Android, local-server mode — verify before use). SMS carries short summary; bills send a link, not a PDF. |
| D-10 | 2026-11-07 | Daily SMS cap default 95 with counter; overflow waits for next day or optional DLT gateway if configured later. |
| D-11 | 2026-11-07 | Marathi SMS is Unicode (~70 chars/segment): keep SMS templates short. |
| D-12 | 2026-11-07 | SIM sends only account/transaction messages to registered, consenting farmers. Never promotional. |
| D-13 | 2026-11-07 | WhatsApp number and SMS SIM are the client's separate business number. |

## Brand (CLAUDE.md §7)

| # | Date | Decision |
|---|---|---|
| D-14 | 2026-11-07 | Colors: primary blue `#1F4E9A`, green `#2E7D32`, grass `#8FAD3E`, sky `#E3EFF8`, text `#1A1A1A` (full token list in `design-assets/README.md`). |
| D-15 | 2026-11-07 | Font: Mukta (Google Fonts), weights 400–800. |
| D-16 | 2026-11-07 | Tagline: शुद्धता • पारदर्शकता • विश्वास. |
