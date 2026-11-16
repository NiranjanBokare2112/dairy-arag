-- 005 — Veterinary doctors (D-83), shown on the farmers' own page and on the center website.
-- Additive only: one new table.
-- Apply:  python -m app.cli migrate

CREATE TABLE IF NOT EXISTS public.doctors (
    id             text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    center_id      text NOT NULL REFERENCES public.centers(id),
    name           text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 80),
    qualification  text NOT NULL DEFAULT '' CHECK (char_length(qualification) <= 80),
    kind           text NOT NULL DEFAULT 'govt' CHECK (kind IN ('govt', 'private')),
    mobile         text NOT NULL DEFAULT '' CHECK (mobile = '' OR mobile ~ '^[6-9][0-9]{9}$'),
    place          text NOT NULL DEFAULT '' CHECK (char_length(place) <= 120),
    areas          text NOT NULL DEFAULT '' CHECK (char_length(areas) <= 160),
    timings        text NOT NULL DEFAULT '' CHECK (char_length(timings) <= 120),
    services       text NOT NULL DEFAULT '' CHECK (char_length(services) <= 200),
    emergency      boolean NOT NULL DEFAULT false,
    published      boolean NOT NULL DEFAULT true,
    sort           integer NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doctors_list_idx ON public.doctors (center_id, published, sort);
