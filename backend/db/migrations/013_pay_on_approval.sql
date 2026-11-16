-- 013 — Farmer pay choice "only after owner approval" (D-123): owed money builds up daily, sent only when the owner approves.
-- Apply:  python -m app.cli migrate

ALTER TABLE public.farmers DROP CONSTRAINT IF EXISTS farmers_pay_check;
ALTER TABLE public.farmers ADD CONSTRAINT farmers_pay_check CHECK (
    pay_kind IN ('daily', 'bill', 'day', 'month-end', 'approval')
    AND ((pay_kind = 'day' AND pay_day IS NOT NULL AND pay_day BETWEEN 1 AND 28) OR (pay_kind <> 'day' AND pay_day IS NULL)));
