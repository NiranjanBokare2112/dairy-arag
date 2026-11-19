---
description: Bring Arag's functional changes into this client's folder (Mallewadi), keeping its own logo, name and data
---
Read `project.json` and `docs/two-projects.md` first.

0. If `project.json` → `role` is `main` (the Arag folder), stop and say: "Run /sync-from-arag in the Mallewadi folder."
1. `git status --short` must be clean (except untracked test data). If not, stop and ask me to commit or put the work aside.
2. If there is no `arag` remote, add it fetch-only:
   `git remote add arag https://github.com/NiranjanBokare2112/dairy-arag.git` and `git remote set-url --push arag NO_PUSH`.
   Then `git fetch arag`.
3. List the commits in `<syncedFromArag>..arag/main` (oldest first) with one line each, and tell me what will come in.
4. Cherry-pick them one by one with `git cherry-pick -x <hash>`. On a conflict:
   - files in `ownFiles`: keep this folder's version (`git checkout --ours -- <file>`);
   - files in `brandedParts`: take Arag's change but keep this client's name, logo, texts, villages and the CSS blocks at the end;
   - `frontend/public/sw.js`: keep the `swPrefix`, with a number one higher than both sides;
   - a commit with nothing left to change: `git cherry-pick --skip`.
   Never take Arag's `demo-data.json`, logo files, `CLAUDE.md` or `project.json`.
5. `node scripts/project-check.mjs` (must pass), then `cd frontend && npm test`. If anything fails, fix it here and amend the last pick.
6. Set `syncedFromArag` in `project.json` to the full hash of `arag/main`, bump the app version once more if anything under `frontend/public/` changed, and commit:
   "Sync from Arag up to <short hash>".
7. Do not push. Tell me what came in, what conflicts you resolved and how, and that `/push` will deploy it.
