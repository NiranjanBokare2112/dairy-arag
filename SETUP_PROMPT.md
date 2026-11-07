# First-run prompt for Claude Code — project setup only

Put `CLAUDE.md` in the project folder, open the folder in Claude Code, and paste everything below the line as your first message.

---

We are starting a new client project for Bokare Technologies: a milk collection and farmer billing system for **आरग दूध संकलन केंद्र** (Arag, Tal. Miraj, Dist. Sangli). Read `CLAUDE.md` in this folder completely first — it is the project brief.

**Your task in this session is ONLY to set up the project. Do not write application code, choose libraries or create the database yet.**

1. Create this folder structure in the current folder (keep anything that already exists):

```
CLAUDE.md                  (already here — do not change it)
SETUP_PROMPT.md            (this prompt, if present — leave it)
README.md
.gitignore
.env.example
design-assets/
  README.md
  logo/
  letterhead/
  bill/
  images/
docs/
  decisions.md
  requirements.md
backend/
  README.md
frontend/
  README.md
scripts/
  README.md
```

2. File contents:
   - `README.md`: project name (Marathi and English), one-paragraph summary from `CLAUDE.md`, the folder structure with one line per folder, and a "Status: setup done, development not started" line.
   - `.gitignore`: Python, Node, Vite build output, `.env`, SQLite database files (`*.db`, `*.db-wal`, `*.db-shm`), backups folder, generated PDFs, OS and editor files.
   - `.env.example`: placeholder keys only, no values: app secret, database path, center id, WhatsApp Cloud API (phone number id, access token, business account id, verify token), SMS gateway (base URL, username, password, daily cap = 95), Cloudflare tunnel hostname, backup destination.
   - `design-assets/README.md`: if I have already copied one in, keep it; otherwise create a placeholder saying the brand files go here.
   - `docs/decisions.md`: keep it if present; otherwise create it with the decisions recorded in `CLAUDE.md` sections 2, 3 and 7, each with date 2026-11-07.
   - `docs/requirements.md`: a clean, numbered requirements list derived from `CLAUDE.md` sections 1–6 (functional and non-functional), so we can tick them off later.
   - `backend/README.md`, `frontend/README.md`, `scripts/README.md`: one paragraph each on what will live there (from `CLAUDE.md`), marked "not started".
3. Run `git init`, then make the first commit: "Project setup: structure, brief, requirements".
4. Check `design-assets/` and tell me which of these files are present and which are missing:
   - `logo/arag-logo-badge.html`, `logo/arag-logo-badge.png`
   - `logo/arag-logo-horizontal.html`, `logo/arag-logo-horizontal.png`
   - `letterhead/arag-letterhead-a4.html`, `letterhead/arag-letterhead-a4.png`
   - `bill/arag-bill-sample-a4.html`, `bill/arag-bill-sample-a4.png`
   - `images/arag-cow-calf-transparent.png`, `images/arag-farm-scene.jpg`
5. Finish with a short report: the folder tree you created, the missing asset files, and any questions or concerns you have about the brief in `CLAUDE.md` (ambiguities, risky decisions). Then stop and wait — we will plan the architecture in the next step.
