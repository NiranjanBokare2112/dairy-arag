-- 007 — Government schemes carry fuller details (D-92): longer text and "how / where to apply".
-- Additive only: wider CHECK limits and one new column with a default.
-- Apply:  python -m app.cli migrate

ALTER TABLE public.schemes ADD COLUMN IF NOT EXISTS how_to text NOT NULL DEFAULT '';

ALTER TABLE public.schemes DROP CONSTRAINT IF EXISTS schemes_summary_check;
ALTER TABLE public.schemes DROP CONSTRAINT IF EXISTS schemes_benefit_check;
ALTER TABLE public.schemes DROP CONSTRAINT IF EXISTS schemes_eligibility_check;
ALTER TABLE public.schemes DROP CONSTRAINT IF EXISTS schemes_documents_check;
ALTER TABLE public.schemes DROP CONSTRAINT IF EXISTS schemes_how_to_check;

ALTER TABLE public.schemes ADD CONSTRAINT schemes_summary_check CHECK (btrim(summary) <> '' AND char_length(summary) <= 800);
ALTER TABLE public.schemes ADD CONSTRAINT schemes_benefit_check CHECK (char_length(benefit) <= 800);
ALTER TABLE public.schemes ADD CONSTRAINT schemes_eligibility_check CHECK (char_length(eligibility) <= 1000);
ALTER TABLE public.schemes ADD CONSTRAINT schemes_documents_check CHECK (char_length(documents) <= 800);
ALTER TABLE public.schemes ADD CONSTRAINT schemes_how_to_check CHECK (char_length(how_to) <= 1000);
