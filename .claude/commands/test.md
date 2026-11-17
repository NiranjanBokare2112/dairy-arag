---
description: Run all frontend and backend tests and report the result
---
Run every test of the project and report the result in short:

1. Frontend: `npm test` in `frontend/` — report pass / fail counts; for each failure, the test name and the first lines of the error.
2. Backend: `python -m pytest -q` in `backend/` (test database only) — same report.

Do not change any code. If something fails, explain the likely cause in one or two lines and ask before fixing.
