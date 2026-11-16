-- 014 — Centre expenses (खर्च, D-126): owner and operator enter them; an operator's change / removal waits for the owner.
-- Monthly expenses (rent, salary, electricity…) cover the calendar month of their date and are spread per day in reports.
-- Additive only: two new tables and one centre setting.
-- Apply:  python -m app.cli migrate

CREATE TABLE IF NOT EXISTS public.expense_categories (
    id          text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    center_id   text NOT NULL REFERENCES public.centers(id),
    name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
    monthly     boolean NOT NULL DEFAULT false,        -- new entries of this type default to "monthly"
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (center_id, name)
);

CREATE TABLE IF NOT EXISTS public.expenses (
    id            text PRIMARY KEY,                    -- client-generated UUID: a retry never saves twice
    center_id     text NOT NULL REFERENCES public.centers(id),
    date          date NOT NULL,
    category_id   text NOT NULL REFERENCES public.expense_categories(id),
    amount_paise  bigint NOT NULL CHECK (amount_paise > 0 AND amount_paise <= 100000000),
    mode          text NOT NULL CHECK (mode IN ('cash', 'upi', 'bank')),
    period        text NOT NULL DEFAULT 'once' CHECK (period IN ('once', 'month')),
    note          text NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
    photo_path    text NOT NULL DEFAULT '',            -- data/uploads/expenses/<id>.jpg (shrunk by the app)
    pending       jsonb,                               -- operator's change waiting for the owner: { kind: edit|delete, changes, by, at, note }
    void          boolean NOT NULL DEFAULT false,
    void_reason   text NOT NULL DEFAULT '',
    voided_at     timestamptz,
    voided_by     text REFERENCES public.users(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text NOT NULL REFERENCES public.users(id),
    updated_at    timestamptz,
    updated_by    text REFERENCES public.users(id),
    CHECK (pending IS NULL OR (jsonb_typeof(pending) = 'object' AND pending->>'kind' IN ('edit', 'delete'))),
    CHECK (NOT void OR (voided_at IS NOT NULL AND char_length(btrim(void_reason)) > 0 AND pending IS NULL))
);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON public.expenses (center_id, date) WHERE NOT void;
CREATE INDEX IF NOT EXISTS expenses_pending_idx ON public.expenses (center_id) WHERE pending IS NOT NULL AND NOT void;

-- estimated cost of one WhatsApp message, in paise (counted automatically from the messages sent)
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS msg_cost_paise integer NOT NULL DEFAULT 13 CHECK (msg_cost_paise BETWEEN 0 AND 500);
