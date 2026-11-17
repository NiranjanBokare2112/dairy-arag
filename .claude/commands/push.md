---
description: Check for secrets and private files, then commit and push to GitHub
argument-hint: optional short description of the change
---
Commit and push the current work to GitHub (`origin`, branch `main`). Change summary from me: $ARGUMENTS

1. `git status --short` — show what changed.
2. Stage everything (`git add -A`), then make sure **none** of these are staged: `.env`, `backups/`, `demo-package/`, `frontend/.dev-shared-db*.json`, `scripts/db/test-data-*.json`, `*.dump`. If any is, unstage it and tell me.
3. Scan the staged files for secrets: WhatsApp tokens (`EAA…`), database URLs with a password, the Supabase project ref. Report findings without printing the secret; stop if anything real is found.
4. Run the frontend tests; stop and tell me if any fail.
5. Commit with a clear message (what changed and why, the D-numbers from `docs/decisions.md`), ending with the attribution line from the system reminder.
6. `git push`. If GitHub's `main` has moved, fetch and tell me — never force-push.
7. Report the commit hash and the repository link.
