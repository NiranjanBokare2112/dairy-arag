-- 001 — Daily milk buyers (D-51): hotels, tea stalls, hostels, households that take milk every day and pay monthly.
-- Additive only: creates 4 tables, a function and triggers; no existing table or row is changed.
-- Apply:  python -m app.cli migrate        (records itself in schema_migrations; safe to run twice)
--
-- Rules enforced here (mirroring the app, frontend/public/src/api/mock.js):
--   * one entry per buyer / date / shift; litres ≥ 0 (0 = "didn't take today")
--   * amount = round half-up (litres × rate); the rate is stored on the entry, so a later rate change
--     never alters past entries
--   * a CLOSED month (buyer_months row) locks its entries: no insert / update / delete
--   * payments: UPI needs a UTR, cash has none; payments are never deleted (void + reason instead)

CREATE TABLE IF NOT EXISTS public.milk_buyers (
    id            text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    center_id     text NOT NULL REFERENCES public.centers(id),
    code          integer NOT NULL CHECK (code > 0),
    name          text NOT NULL CHECK (btrim(name) <> ''),
    area          text NOT NULL DEFAULT '',
    mobile        text NOT NULL DEFAULT '' CHECK (mobile = '' OR mobile ~ '^[6-9][0-9]{9}$'),
    milk_type     text NOT NULL CHECK (milk_type IN ('cow', 'buffalo')),
    rate_paise    bigint NOT NULL CHECK (rate_paise > 0),          -- current rate per litre (new entries)
    morning_x100  integer NOT NULL DEFAULT 0 CHECK (morning_x100 >= 0),  -- usual litres, pre-filled on the daily sheet
    evening_x100  integer NOT NULL DEFAULT 0 CHECK (evening_x100 >= 0),
    active        boolean NOT NULL DEFAULT true,
    note          text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS milk_buyers_code_uq ON public.milk_buyers (center_id, code);
CREATE INDEX IF NOT EXISTS milk_buyers_active_idx ON public.milk_buyers (center_id, active, code);

CREATE TABLE IF NOT EXISTS public.buyer_months (            -- a row = that month is CLOSED (locked)
    id          text PRIMARY KEY,                           -- 'YYYY-MM'
    center_id   text NOT NULL REFERENCES public.centers(id),
    month       text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    closed_at   timestamptz NOT NULL DEFAULT now(),
    closed_by   text NOT NULL REFERENCES public.users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS buyer_months_uq ON public.buyer_months (center_id, month);

CREATE TABLE IF NOT EXISTS public.buyer_sales (
    id            text PRIMARY KEY,                         -- client UUID (idempotent retries)
    center_id     text NOT NULL REFERENCES public.centers(id),
    buyer_id      text NOT NULL REFERENCES public.milk_buyers(id),
    date          date NOT NULL,
    shift         text NOT NULL CHECK (shift IN ('morning', 'evening')),
    milk_type     text NOT NULL CHECK (milk_type IN ('cow', 'buffalo')),
    litres_x100   integer NOT NULL CHECK (litres_x100 >= 0 AND litres_x100 <= 50000),
    rate_paise    bigint NOT NULL CHECK (rate_paise > 0),
    amount_paise  bigint NOT NULL CHECK (amount_paise >= 0),
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text NOT NULL REFERENCES public.users(id),
    updated_at    timestamptz,
    updated_by    text REFERENCES public.users(id),
    CHECK (amount_paise = (litres_x100 * rate_paise + 50) / 100)   -- round half-up, as everywhere else
);
CREATE UNIQUE INDEX IF NOT EXISTS buyer_sales_once_uq ON public.buyer_sales (center_id, buyer_id, date, shift);
CREATE INDEX IF NOT EXISTS buyer_sales_day_idx ON public.buyer_sales (center_id, date, shift);
CREATE INDEX IF NOT EXISTS buyer_sales_buyer_idx ON public.buyer_sales (center_id, buyer_id, date);

CREATE TABLE IF NOT EXISTS public.buyer_payments (
    id            text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    center_id     text NOT NULL REFERENCES public.centers(id),
    buyer_id      text NOT NULL REFERENCES public.milk_buyers(id),
    date          date NOT NULL,
    mode          text NOT NULL CHECK (mode IN ('cash', 'upi')),
    amount_paise  bigint NOT NULL CHECK (amount_paise > 0),
    upi_ref       text NOT NULL DEFAULT '',
    note          text NOT NULL DEFAULT '',
    void          boolean NOT NULL DEFAULT false,
    void_reason   text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text NOT NULL REFERENCES public.users(id),
    CHECK (mode = 'cash' OR upi_ref <> ''),
    CHECK (mode = 'upi' OR upi_ref = ''),
    CHECK (NOT void OR btrim(void_reason) <> '')
);
CREATE INDEX IF NOT EXISTS buyer_payments_buyer_idx ON public.buyer_payments (center_id, buyer_id, date);
CREATE INDEX IF NOT EXISTS buyer_payments_date_idx ON public.buyer_payments (center_id, date);

-- closed months lock their entries
CREATE OR REPLACE FUNCTION public.buyer_sales_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (SELECT 1 FROM buyer_months m WHERE m.center_id = OLD.center_id AND m.month = to_char(OLD.date, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'buyer month % is closed', to_char(OLD.date, 'YYYY-MM');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM buyer_months m WHERE m.center_id = NEW.center_id AND m.month = to_char(NEW.date, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'buyer month % is closed', to_char(NEW.date, 'YYYY-MM');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS buyer_sales_guard ON public.buyer_sales;
CREATE TRIGGER buyer_sales_guard BEFORE INSERT OR UPDATE OR DELETE ON public.buyer_sales FOR EACH ROW EXECUTE FUNCTION public.buyer_sales_guard();

-- payments are never deleted, only voided
CREATE OR REPLACE FUNCTION public.buyer_payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'buyer payments are never deleted; void them with a reason'; END IF;
  IF (to_jsonb(NEW) - 'void' - 'void_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'void' - 'void_reason') OR (OLD.void AND NOT NEW.void) THEN
    RAISE EXCEPTION 'buyer payment % can only be voided, not edited', OLD.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS buyer_payments_guard ON public.buyer_payments;
CREATE TRIGGER buyer_payments_guard BEFORE UPDATE OR DELETE ON public.buyer_payments FOR EACH ROW EXECUTE FUNCTION public.buyer_payments_guard();

DROP TRIGGER IF EXISTS milk_buyers_updated_at ON public.milk_buyers;
CREATE TRIGGER milk_buyers_updated_at BEFORE UPDATE ON public.milk_buyers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
