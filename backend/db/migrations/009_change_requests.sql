-- 009 — Changes to a farmer's details asked by an operator or by the farmer wait for the owner's approval (D-108).
-- Additive only: one new table.
-- Apply:  python -m app.cli migrate

CREATE TABLE IF NOT EXISTS public.change_requests (
    id                text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    center_id         text NOT NULL REFERENCES public.centers(id),
    entity            text NOT NULL DEFAULT 'farmer' CHECK (entity IN ('farmer')),
    entity_id         text NOT NULL REFERENCES public.farmers(id),
    requested_by      text NOT NULL,                      -- user id, or 'farmer:<id>' for the farmer's own request
    requested_by_kind text NOT NULL CHECK (requested_by_kind IN ('operator', 'farmer')),
    fields            jsonb NOT NULL,                     -- { field: { before, after } }
    note              text NOT NULL DEFAULT '' CHECK (char_length(note) <= 300),
    status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'replaced')),
    requested_at      timestamptz NOT NULL DEFAULT now(),
    decided_at        timestamptz,
    decided_by        text,
    decision_note     text NOT NULL DEFAULT '' CHECK (char_length(decision_note) <= 300),
    CHECK (jsonb_typeof(fields) = 'object' AND fields <> '{}'::jsonb),
    CHECK ((status = 'pending') = (decided_at IS NULL)),
    CHECK (status NOT IN ('approved', 'rejected') OR decided_by IS NOT NULL),
    CHECK (requested_by_kind <> 'farmer' OR requested_by = 'farmer:' || entity_id)
);
CREATE INDEX IF NOT EXISTS change_requests_pending_idx ON public.change_requests (center_id, status, requested_at);
CREATE INDEX IF NOT EXISTS change_requests_farmer_idx ON public.change_requests (center_id, entity_id);
