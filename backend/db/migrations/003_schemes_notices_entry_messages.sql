-- 003 — Government schemes (D-71), broadcast notices (D-72) and one message per milk entry (D-73).
-- Additive only: two new tables, new columns on outbox_messages, a wider kind list, and a new "no double send" index.
-- Apply:  python -m app.cli migrate        (records itself in schema_migrations)
--
-- Rules enforced here (mirroring frontend/public/src/api/mock.js):
--   * schemes: name and short description required; link, when given, is a full http(s) address; the website shows
--     a scheme only while published and not past its last date (that filter lives in the API query)
--   * notices: 1–500 characters; when also sent by SMS, at most 140 characters (2 Marathi SMS parts); audience is
--     all / cow / buffalo / chosen codes; a notice is never edited or deleted once sent
--   * outbox: kind 'pour' points at its milk entry, 'pour-fix' at its correction, 'notice' at its notice;
--     the same entry / correction / notice is never queued twice for a farmer (retries are safe);
--     no_sms = a notice the owner did not allow on SMS, so it must never fall back to SMS

-- ---------- schemes (सरकारी योजना) ----------
CREATE TABLE IF NOT EXISTS public.schemes (
    id           text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    center_id    text NOT NULL REFERENCES public.centers(id),
    title        text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 120),
    summary      text NOT NULL CHECK (btrim(summary) <> '' AND char_length(summary) <= 600),
    benefit      text NOT NULL DEFAULT '' CHECK (char_length(benefit) <= 200),
    eligibility  text NOT NULL DEFAULT '' CHECK (char_length(eligibility) <= 400),
    documents    text NOT NULL DEFAULT '' CHECK (char_length(documents) <= 400),
    last_date    date,
    link         text NOT NULL DEFAULT '' CHECK (link = '' OR link ~* '^https?://[^[:space:]]+\.[^[:space:]]+$'),
    published    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    created_by   text REFERENCES public.users(id)
);
CREATE INDEX IF NOT EXISTS schemes_site_idx ON public.schemes (center_id, published, last_date);

-- ---------- broadcast notices (सूचना पाठवा) ----------
CREATE TABLE IF NOT EXISTS public.broadcasts (
    id           text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    center_id    text NOT NULL REFERENCES public.centers(id),
    text         text NOT NULL CHECK (btrim(text) <> '' AND char_length(text) <= 500),
    audience     text NOT NULL CHECK (audience IN ('all', 'cow', 'buffalo', 'codes')),
    codes        integer[] NOT NULL DEFAULT '{}',
    sms          boolean NOT NULL DEFAULT false,
    counts       jsonb NOT NULL DEFAULT '{}'::jsonb,       -- {"whatsapp": n, "sms": n, "skipped": n}
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   text NOT NULL REFERENCES public.users(id),
    CHECK (NOT sms OR char_length(text) <= 140),
    CHECK (audience <> 'codes' OR cardinality(codes) > 0)
);
CREATE INDEX IF NOT EXISTS broadcasts_recent_idx ON public.broadcasts (center_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.broadcasts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a sent notice is never changed or deleted';
END $$;
DROP TRIGGER IF EXISTS broadcasts_guard_trg ON public.broadcasts;
CREATE TRIGGER broadcasts_guard_trg BEFORE UPDATE OR DELETE ON public.broadcasts FOR EACH ROW EXECUTE FUNCTION public.broadcasts_guard();

-- ---------- outbox: per-entry, correction and notice messages ----------
ALTER TABLE public.outbox_messages ADD COLUMN IF NOT EXISTS collection_id text REFERENCES public.collections(id);
ALTER TABLE public.outbox_messages ADD COLUMN IF NOT EXISTS correction_id text REFERENCES public.corrections(id);
ALTER TABLE public.outbox_messages ADD COLUMN IF NOT EXISTS broadcast_id  text REFERENCES public.broadcasts(id);
ALTER TABLE public.outbox_messages ADD COLUMN IF NOT EXISTS no_sms        boolean NOT NULL DEFAULT false;

ALTER TABLE public.outbox_messages DROP CONSTRAINT IF EXISTS outbox_messages_kind_check;
ALTER TABLE public.outbox_messages ADD CONSTRAINT outbox_messages_kind_check
    CHECK (kind IN ('daily', 'bill', 'payment', 'payment-corrected', 'pour', 'pour-fix', 'notice'));
ALTER TABLE public.outbox_messages DROP CONSTRAINT IF EXISTS outbox_messages_pour_ref_check;
ALTER TABLE public.outbox_messages ADD CONSTRAINT outbox_messages_pour_ref_check CHECK (
    (kind <> 'pour' OR collection_id IS NOT NULL)
    AND (kind <> 'pour-fix' OR correction_id IS NOT NULL)
    AND (kind <> 'notice' OR broadcast_id IS NOT NULL));
ALTER TABLE public.outbox_messages DROP CONSTRAINT IF EXISTS outbox_messages_no_sms_check;
ALTER TABLE public.outbox_messages ADD CONSTRAINT outbox_messages_no_sms_check CHECK (NOT no_sms OR channel = 'whatsapp');

-- the old index allowed one message per farmer / kind / day; per-entry messages need several a day
DROP INDEX IF EXISTS public.outbox_no_double_uq;
CREATE UNIQUE INDEX IF NOT EXISTS outbox_no_double_uq ON public.outbox_messages (center_id, farmer_id, kind, date,
    COALESCE(bill_id, ''), COALESCE(payment_id, ''), COALESCE(collection_id, ''), COALESCE(correction_id, ''), COALESCE(broadcast_id, ''));
