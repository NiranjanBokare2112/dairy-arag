# Two clients, two folders — how to work without mixing them

The same app is used by two milk centres. Each has its **own folder, GitHub repo, Vercel site, logo, name and test data**.
This guide is the same in both folders. Each folder's own settings are in its **`project.json`**.

| | Arag (main) | Mallewadi |
|---|---|---|
| Client | आरग दूध संकलन केंद्र | मल्लेवाडी शेतकरी दूध उत्पादक व पुरवठा सह. संस्था मर्या. |
| Folder | `F:\Dairy-Arag` (today `F:\Dairy`) | `F:\Dairy-mallewadi` |
| GitHub (= its Vercel site) | `dairy-arag` | `dairy-sd-sample` |
| Dev server / test port | 5173 / 5174 | 5175 / 5176 |
| App version (`sw.js`) | `arag-vNNN` | `mallewadi-vNNN` |
| Decisions | `docs/decisions.md` (D-numbers, shared) | the same, plus `docs/mallewadi-decisions.md` (M-numbers) |
| Database | Supabase, shared while testing; **writes only from Arag** | no migrate / seed / restore until it has its own |

## The rules

1. **Open one folder per VS Code window.** Claude works only in the folder it was opened in and never edits the other one.
2. **Functional change** (business rules, `lib/`, mock API, backend, migrations, tests, a new screen or field):
   make it in **Arag**, test, `/push`. Then open the Mallewadi folder and run **`/sync-from-arag`**.
3. **Look change** (logo, name, address, colours, pictures, a layout only one client wants): make it **only in that client's folder**.
   In Mallewadi, record it in `docs/mallewadi-decisions.md`.
4. **Never copy files between the folders by hand**, and never point one folder's git at the other repo.
   Mallewadi has a fetch-only remote `arag` for syncing; Arag has no Mallewadi remote.
5. **Pushing = deploying**: Vercel builds each repo's `main` on every push. Three guards stop a mix-up:
   - the **pre-push hook** (`.githooks/pre-push`) refuses a push to a repo that isn't in `project.json`, or a folder that has the other client's name or data;
   - the **Vercel build** (`vercel.json` → `node scripts/project-check.mjs --deploy`) fails the deploy for the same reasons;
   - **`/push`** runs the same check first.
   Run it any time: `node scripts/project-check.mjs` (VS Code task "Project check").
6. **Data**: each folder has its own test data (`frontend/.dev-shared-db*.json`) and demo data (`frontend/public/demo/demo-data.json`). Build them with `/demo-data` in that folder.
7. **Database**: while both use one Supabase, only Arag runs `migrate`, `seed`, `restore` or `init-db`. A `seed --reset` from Mallewadi would replace Arag's data.
   When Mallewadi gets its own Supabase: put its URL in Mallewadi's `.env`, update `database` in its `project.json`, and record an M-decision.

## How `/sync-from-arag` works (Mallewadi folder)

- `project.json` → `syncedFromArag` holds the last Arag commit already taken.
- The command fetches `arag/main` and cherry-picks the newer commits one by one (`-x`, so each one names its Arag commit).
- On a conflict:
  - files in `ownFiles` keep Mallewadi's version;
  - files in `brandedParts` take Arag's change but keep Mallewadi's name, logo and texts;
  - `sw.js` keeps `mallewadi-v` and moves one step past both versions.
- Then the project check and all tests run. `syncedFromArag` is moved forward, and nothing is pushed until you say `/push`.

## If a check stops you

- **Wrong repo**: you are in the wrong folder or on the wrong remote. Run `git remote -v` and open the right folder.
- **Other client's words**: something was copied across. Undo that file (`git checkout -- <file>`) or ask Claude to fix it in this folder.
- **Demo data belongs to another client**: rebuild it here with `/demo-data`.
