-- 002 — Walk-in (सुटी) milk sales (D-53): occasional / unknown people buying ¼ · ½ · 1 L at the counter, paid on the spot.
-- Additive only: two columns on centers (with defaults), one table, a guard function and triggers.
-- Apply:  python -m app.cli migrate        (records itself in schema_migrations; safe to run twice)
--
-- Rules enforced here (mirroring frontend/public/src/api/mock.js):
--   * litres > 0 and ≤ 50 L per sale; amount = round half-up (litres × rate); the rate is stored on the row
--   * no account and no name needed (name optional); UPI reference optional for walk-ins
--   * never deleted; a wrong entry is voided with a reason; only void / void_reason may change
--   * a CLOSED month (buyer_months row, migration 001) locks its walk-in sales too

ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS counter_rate_cow_paise     bigint NOT NULL DEFAULT 6000 CHECK (counter_rate_cow_paise > 0);
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS counter_rate_buffalo_paise bigint NOT NULL DEFAULT 7600 CHECK (counter_rate_buffalo_paise > 0);

CREATE TABLE IF NOT EXISTS public.counter_sales (
    id            text PRIMARY KEY,                         -- client UUID (idempotent retries)
    center_id     text NOT NULL REFERENCES public.centers(id),
    date          date NOT NULL,
    shift         text NOT NULL CHECK (shift IN ('morning', 'evening')),
    milk_type     text NOT NULL CHECK (milk_type IN ('cow', 'buffalo')),
    litres_x100   integer NOT NULL CHECK (litres_x100 > 0 AND litres_x100 <= 5000),
    rate_paise    bigint NOT NULL CHECK (rate_paise > 0),
    amount_paise  bigint NOT NULL CHECK (amount_paise > 0),
    mode          text NOT NULL CHECK (mode IN ('cash', 'upi')),
    upi_ref       text NOT NULL DEFAULT '',
    name          text NOT NULL DEFAULT '',
    void          boolean NOT NULL DEFAULT false,
    void_reason   text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text NOT NULL REFERENCES public.users(id),
    CHECK (amount_paise = (litres_x100 * rate_paise + 50) / 100),
    CHECK (mode = 'upi' OR upi_ref = ''),
    CHECK (NOT void OR btrim(void_reason) <> '')
);
CREATE INDEX IF NOT EXISTS counter_sales_day_idx ON public.counter_sales (center_id, date, shift);

CREATE OR REPLACE FUNCTION public.counter_sales_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'walk-in sales are never deleted; void them with a reason'; END IF;
  IF EXISTS (SELECT 1 FROM buyer_months m WHERE m.center_id = NEW.center_id AND m.month = to_char(NEW.date, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'buyer month % is closed', to_char(NEW.date, 'YYYY-MM');
  END IF;
  IF TG_OP = 'UPDATE' AND ((to_jsonb(NEW) - 'void' - 'void_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'void' - 'void_reason') OR (OLD.void AND NOT NEW.void)) THEN
    RAISE EXCEPTION 'walk-in sale % can only be voided, not edited', OLD.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS counter_sales_guard ON public.counter_sales;
CREATE TRIGGER counter_sales_guard BEFORE INSERT OR UPDATE OR DELETE ON public.counter_sales FOR EACH ROW EXECUTE FUNCTION public.counter_sales_guard();
