-- 012 — Farmers' names in Marathi and English (D-118). The English name is used to check the bank's / UPI name, for search
-- and on English screens; the centre's own spelling corrections are kept to improve the automatic suggestions.
-- Apply:  python -m app.cli migrate

ALTER TABLE public.farmers ADD COLUMN IF NOT EXISTS name_en text NOT NULL DEFAULT '';
ALTER TABLE public.farmers ADD COLUMN IF NOT EXISTS name_en_auto boolean NOT NULL DEFAULT false;  -- filled in automatically, not yet checked
ALTER TABLE public.farmers DROP CONSTRAINT IF EXISTS farmers_name_en_check;
ALTER TABLE public.farmers ADD CONSTRAINT farmers_name_en_check CHECK (char_length(name_en) <= 80 AND name_en !~ '[\u0900-\u097F]');
CREATE INDEX IF NOT EXISTS farmers_name_en_idx ON public.farmers (center_id, lower(name_en));

-- English word → Marathi word, learned from the names the centre saved: {"jamdade": "जामदाडे", ...}
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS name_words jsonb NOT NULL DEFAULT '{}'::jsonb;
