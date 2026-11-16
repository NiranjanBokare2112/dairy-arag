-- 006 — Owner's dashboard layout (D-85), operator tabs (D-86), daily buyers' start date and payment schedule (D-87).
-- Additive only: new columns with defaults, and one guard trigger.
-- Apply:  python -m app.cli migrate

-- dashboard layout chosen by the owner: {"order": [...], "off": [...], "seen": [...]} (null = default layout)
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS dashboard jsonb;

-- which tabs an operator may use (null = all); '/collection' is always allowed by the app
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pages text[];
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_pages_check;
ALTER TABLE public.users ADD CONSTRAINT users_pages_check CHECK (
    pages IS NULL OR (role = 'operator' AND pages <@ ARRAY['/collection', '/ledger', '/farmers', '/dispatch', '/buyers', '/messages']::text[]));

-- daily buyers: from when they take milk, and when they pay ('month-end', or 'day' + bill_day 1…28)
ALTER TABLE public.milk_buyers ADD COLUMN IF NOT EXISTS start_date date;
UPDATE public.milk_buyers b SET start_date = COALESCE((SELECT min(s.date) FROM public.buyer_sales s WHERE s.buyer_id = b.id), b.created_at::date)
 WHERE start_date IS NULL;
ALTER TABLE public.milk_buyers ALTER COLUMN start_date SET DEFAULT CURRENT_DATE;
ALTER TABLE public.milk_buyers ALTER COLUMN start_date SET NOT NULL;
ALTER TABLE public.milk_buyers ADD COLUMN IF NOT EXISTS bill_kind text NOT NULL DEFAULT 'month-end';
ALTER TABLE public.milk_buyers ADD COLUMN IF NOT EXISTS bill_day integer;
ALTER TABLE public.milk_buyers DROP CONSTRAINT IF EXISTS milk_buyers_bill_check;
ALTER TABLE public.milk_buyers ADD CONSTRAINT milk_buyers_bill_check CHECK (
    (bill_kind = 'month-end' AND bill_day IS NULL) OR (bill_kind = 'day' AND bill_day BETWEEN 1 AND 28));

-- no milk entry before the buyer's start date
CREATE OR REPLACE FUNCTION public.buyer_sales_start_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.litres_x100 > 0 AND EXISTS (SELECT 1 FROM milk_buyers b WHERE b.id = NEW.buyer_id AND NEW.date < b.start_date) THEN
    RAISE EXCEPTION 'buyer % takes milk only from their start date', NEW.buyer_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS buyer_sales_start_trg ON public.buyer_sales;
CREATE TRIGGER buyer_sales_start_trg BEFORE INSERT OR UPDATE OF date, litres_x100 ON public.buyer_sales
    FOR EACH ROW EXECUTE FUNCTION public.buyer_sales_start_guard();
