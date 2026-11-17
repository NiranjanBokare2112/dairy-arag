---
description: Compare the PC database with Supabase (read-only)
---
Read-only check of the two real databases — change nothing.

From `backend/`:
1. `python -m app.cli check` (PC) and `python -m app.cli --supabase check` (Supabase). Mask any URL (`user:****@host`).
2. Compare: server versions, number of tables, missing tables, and row counts per table — list only the tables that differ.
3. Supabase: report how many `public` tables have Row Level Security off (should be 0).
4. Date range of milk entries (`collections`), the latest dispatch, buyers' sales and expenses on each side.

If the connection fails, show the error line only (no password) and the likely cause.
