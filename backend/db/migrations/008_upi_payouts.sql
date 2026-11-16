-- 008 — UPI payouts to farmers (D-107): ₹1 UPI check, farmer's choice of when to be paid, payout runs.
-- Payouts may pay milk BEFORE its bill exists, so a payment can now belong to a bill period (cycle_id) and is linked to
-- the bill once the bill is made. A correction after a payout can leave a farmer overpaid: that carries to the next bill.
-- Apply:  python -m app.cli migrate

-- owner's payout settings (mode, time, minimum, limits, fee…; null = defaults in the app)
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS payout jsonb;

-- farmer: when they want their money, and the state of their UPI ID check
ALTER TABLE public.farmers ADD COLUMN IF NOT EXISTS pay_kind text NOT NULL DEFAULT 'bill';
ALTER TABLE public.farmers ADD COLUMN IF NOT EXISTS pay_day integer;
ALTER TABLE public.farmers ADD COLUMN IF NOT EXISTS upi_check jsonb NOT NULL DEFAULT '{"status": "none"}'::jsonb;
ALTER TABLE public.farmers DROP CONSTRAINT IF EXISTS farmers_pay_check;
ALTER TABLE public.farmers ADD CONSTRAINT farmers_pay_check CHECK (
    pay_kind IN ('daily', 'bill', 'day', 'month-end')
    AND ((pay_kind = 'day' AND pay_day IS NOT NULL AND pay_day BETWEEN 1 AND 28) OR (pay_kind <> 'day' AND pay_day IS NULL)));

-- one run = the day's list (proposed → sent, or cancelled)
CREATE TABLE IF NOT EXISTS public.payout_runs (
    id           text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    center_id    text NOT NULL REFERENCES public.centers(id),
    date         date NOT NULL,
    mode         text NOT NULL CHECK (mode IN ('approve', 'auto')),
    auto         boolean NOT NULL DEFAULT false,
    status       text NOT NULL CHECK (status IN ('proposed', 'sent', 'cancelled')),
    up_to        date NOT NULL,
    count        integer NOT NULL DEFAULT 0 CHECK (count >= 0),
    total_paise  bigint NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   text NOT NULL,
    sent_at      timestamptz,
    approved_by  text,
    cancelled_at timestamptz,
    CHECK (up_to <= date)
);
CREATE INDEX IF NOT EXISTS payout_runs_date_idx ON public.payout_runs (center_id, date);

-- one payout (or one ₹1 UPI check) to one farmer
CREATE TABLE IF NOT EXISTS public.payouts (
    id           text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    center_id    text NOT NULL REFERENCES public.centers(id),
    run_id       text REFERENCES public.payout_runs(id),
    kind         text NOT NULL CHECK (kind IN ('payout', 'verify')),
    date         date NOT NULL,
    farmer_id    text NOT NULL REFERENCES public.farmers(id),
    upi_id       text NOT NULL CHECK (btrim(upi_id) <> ''),
    amount_paise bigint NOT NULL CHECK (amount_paise > 0),          -- what it settles of the farmer's money
    credit_paise bigint NOT NULL CHECK (credit_paise > 0),          -- what reaches the farmer (amount − fee if the farmer pays it)
    fee_paise    bigint NOT NULL DEFAULT 0 CHECK (fee_paise >= 0),
    fee_by       text NOT NULL DEFAULT 'center' CHECK (fee_by IN ('center', 'farmer')),
    parts        jsonb NOT NULL DEFAULT '[]'::jsonb,                -- [{cycleId, billId, start, end, paise, kind}]
    capped       boolean NOT NULL DEFAULT false,
    status       text NOT NULL CHECK (status IN ('proposed', 'approved', 'processing', 'success', 'failed', 'skipped', 'cancelled')),
    ref          text,                                              -- bank reference (UTR) from the gateway
    reason       text,
    bank_name    text,                                              -- ₹1 check: the account holder's name the bank returned
    attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at   timestamptz NOT NULL DEFAULT now(),
    sent_at      timestamptz,
    done_at      timestamptz,
    approved_by  text,
    CHECK (credit_paise <= amount_paise),
    CHECK (status <> 'success' OR (ref IS NOT NULL AND btrim(ref) <> '')),
    CHECK ((kind = 'verify') = (run_id IS NULL)),
    CHECK (kind <> 'verify' OR amount_paise = 100)
);
CREATE INDEX IF NOT EXISTS payouts_farmer_idx ON public.payouts (center_id, farmer_id, date);
-- a farmer appears at most once in a run
CREATE UNIQUE INDEX IF NOT EXISTS payouts_run_farmer_uq ON public.payouts (run_id, farmer_id) WHERE run_id IS NOT NULL;

-- payments made by a payout: they may belong to a bill period before its bill exists
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS cycle_id text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payout_id text REFERENCES public.payouts(id);
ALTER TABLE public.payments ALTER COLUMN bill_id DROP NOT NULL;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_source_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_source_check CHECK (
    (source = 'manual' AND bill_id IS NOT NULL AND payout_id IS NULL)
    OR (source = 'payout' AND mode = 'upi' AND payout_id IS NOT NULL AND (bill_id IS NOT NULL OR cycle_id IS NOT NULL)));
CREATE INDEX IF NOT EXISTS payments_cycle_idx ON public.payments (center_id, farmer_id, cycle_id) WHERE cycle_id IS NOT NULL;

-- manual payments: final bills only (as before). Payout payments: the farmer's own bill (draft or final) or a period.
-- The only edit allowed (besides voiding) is linking a payout payment to its bill once the bill is made.
CREATE OR REPLACE FUNCTION public.payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments are never deleted; void and re-enter instead';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.source = 'manual' AND NOT EXISTS (SELECT 1 FROM bills b
                   WHERE b.id = NEW.bill_id AND b.status = 'final'
                     AND b.farmer_id = NEW.farmer_id AND b.center_id = NEW.center_id) THEN
      RAISE EXCEPTION 'payment must be for a final bill of the same farmer';
    END IF;
    IF NEW.source = 'payout' AND NEW.bill_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bills b
                   WHERE b.id = NEW.bill_id AND b.farmer_id = NEW.farmer_id AND b.center_id = NEW.center_id) THEN
      RAISE EXCEPTION 'payout payment must be for a bill of the same farmer';
    END IF;
  ELSIF (to_jsonb(NEW) - 'void' - 'void_reason' - 'bill_id') IS DISTINCT FROM
        (to_jsonb(OLD) - 'void' - 'void_reason' - 'bill_id')
        OR (OLD.void AND NOT NEW.void)
        OR (NEW.bill_id IS DISTINCT FROM OLD.bill_id AND NOT (OLD.source = 'payout' AND OLD.bill_id IS NULL)) THEN
    RAISE EXCEPTION 'payment % can only be voided, not edited', OLD.id;
  END IF;
  RETURN NEW;
END $$;
-- keep bills.paid_paise right when a payout payment is linked to its bill later
DROP TRIGGER IF EXISTS payments_sync_bill_link ON public.payments;
CREATE TRIGGER payments_sync_bill_link AFTER UPDATE OF bill_id ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.payments_sync_bill();

-- bills: payouts sent before the bill (prepaid) and any overpayment (carried to the next bill as dues)
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS prepaid_paise bigint NOT NULL DEFAULT 0;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS overpaid_paise bigint NOT NULL DEFAULT 0;
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_prepaid_check;
ALTER TABLE public.bills ADD CONSTRAINT bills_prepaid_check CHECK (prepaid_paise >= 0 AND overpaid_paise >= 0
    AND overpaid_paise = GREATEST(prepaid_paise - payable_paise, 0::bigint));
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_check4;
ALTER TABLE public.bills ADD CONSTRAINT bills_check4 CHECK (carry_forward_dues_paise = GREATEST(-net_paise, 0::bigint) + overpaid_paise);
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_check5;
ALTER TABLE public.bills ADD CONSTRAINT bills_check5 CHECK (paid_paise >= 0 AND paid_paise <= payable_paise + overpaid_paise);
