-- 011 — Farmer payouts to the agreed requirement (D-110, D-111): UPI or bank account, fixed-time automatic payouts from the
-- owner's business account, per-farmer approval, gateway-confirmed statuses (processing → success / failed → reversed),
-- breakdown per payout, deduction consent, payout status messages to the farmer.
-- Apply:  python -m app.cli migrate

-- farmer: how they are paid, the bank account check, whether their payouts wait for the owner, consent to deductions
ALTER TABLE public.farmers ADD COLUMN IF NOT EXISTS pay_method text NOT NULL DEFAULT 'upi';
ALTER TABLE public.farmers ADD COLUMN IF NOT EXISTS bank_check jsonb NOT NULL DEFAULT '{"status": "none"}'::jsonb;
ALTER TABLE public.farmers ADD COLUMN IF NOT EXISTS pay_approval boolean NOT NULL DEFAULT false;
ALTER TABLE public.farmers ADD COLUMN IF NOT EXISTS deduction_consent_at timestamptz;
ALTER TABLE public.farmers ADD COLUMN IF NOT EXISTS deduction_consent_by text REFERENCES public.users(id);
ALTER TABLE public.farmers DROP CONSTRAINT IF EXISTS farmers_pay_method_check;
ALTER TABLE public.farmers ADD CONSTRAINT farmers_pay_method_check CHECK (pay_method IN ('upi', 'bank'));
ALTER TABLE public.farmers DROP CONSTRAINT IF EXISTS farmers_consent_by_check;
ALTER TABLE public.farmers ADD CONSTRAINT farmers_consent_by_check CHECK ((deduction_consent_at IS NULL) = (deduction_consent_by IS NULL));

-- runs: immediate (one farmer, right after a collection), approve (owner's list), eod (fixed time)
ALTER TABLE public.payout_runs DROP CONSTRAINT IF EXISTS payout_runs_mode_check;
UPDATE public.payout_runs SET mode = 'eod' WHERE mode = 'auto';
ALTER TABLE public.payout_runs ADD CONSTRAINT payout_runs_mode_check CHECK (mode IN ('approve', 'eod', 'immediate'));

-- payouts
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'upi';
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS dest_label text;          -- what is shown: UPI ID, or XXXX1234 · IFSC
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS txn_ref text;             -- unique reference sent to the gateway (idempotency key)
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS breakdown jsonb;          -- gross, feed, advance, dues, net, already paid, owed, sent, credited, remaining
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS wait_approval boolean NOT NULL DEFAULT false;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS decided_by text;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS payouts_method_check;
ALTER TABLE public.payouts ADD CONSTRAINT payouts_method_check CHECK (method IN ('upi', 'bank'));
ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE public.payouts ADD CONSTRAINT payouts_status_check
    CHECK (status IN ('proposed', 'approved', 'processing', 'success', 'failed', 'skipped', 'cancelled', 'rejected', 'reversed'));
ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS payouts_rejected_check;
ALTER TABLE public.payouts ADD CONSTRAINT payouts_rejected_check CHECK (status <> 'rejected' OR (btrim(coalesce(reason, '')) <> '' AND decided_by IS NOT NULL));
ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS payouts_reversed_check;
ALTER TABLE public.payouts ADD CONSTRAINT payouts_reversed_check CHECK (status <> 'reversed' OR (reversed_at IS NOT NULL AND ref IS NOT NULL));
ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS payouts_sent_ref_check;
ALTER TABLE public.payouts ADD CONSTRAINT payouts_sent_ref_check CHECK (status NOT IN ('processing', 'success', 'reversed') OR kind = 'verify' OR txn_ref IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS payouts_txn_ref_uq ON public.payouts (txn_ref) WHERE txn_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS payouts_waiting_idx ON public.payouts (center_id, status) WHERE wait_approval;

-- the farmer is told of each payout status (success / failed / reversed): one message per payout and status
ALTER TABLE public.outbox_messages ADD COLUMN IF NOT EXISTS payout_id text REFERENCES public.payouts(id);
ALTER TABLE public.outbox_messages ADD COLUMN IF NOT EXISTS payout_status text CHECK (payout_status IS NULL OR payout_status IN ('success', 'failed', 'reversed'));
ALTER TABLE public.outbox_messages DROP CONSTRAINT IF EXISTS outbox_messages_kind_check;
ALTER TABLE public.outbox_messages ADD CONSTRAINT outbox_messages_kind_check
    CHECK (kind IN ('daily', 'bill', 'payment', 'payment-corrected', 'pour', 'pour-fix', 'notice', 'support', 'payout'));
ALTER TABLE public.outbox_messages DROP CONSTRAINT IF EXISTS outbox_messages_payout_ref_check;
ALTER TABLE public.outbox_messages ADD CONSTRAINT outbox_messages_payout_ref_check CHECK (kind <> 'payout' OR (payout_id IS NOT NULL AND payout_status IS NOT NULL));
DROP INDEX IF EXISTS public.outbox_no_double_uq;
CREATE UNIQUE INDEX IF NOT EXISTS outbox_no_double_uq ON public.outbox_messages (center_id, farmer_id, kind, date,
    COALESCE(bill_id, ''), COALESCE(payment_id, ''), COALESCE(collection_id, ''), COALESCE(correction_id, ''), COALESCE(broadcast_id, ''),
    COALESCE(ticket_message_id, ''), COALESCE(payout_id, ''), COALESCE(payout_status, ''));
