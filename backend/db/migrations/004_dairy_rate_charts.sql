-- 004 — Two kinds of rate chart (D-80): 'farmer' (what we pay farmers; prices every milk entry) and 'dairy' (what
-- the dairy pays us; fills the dispatch rate and gives the profit of each entry).
-- Additive only: one column with a default (every existing chart becomes a farmer chart), an index, one column on
-- dispatches, and a guard so a milk entry can only be priced with a farmer chart.
-- Apply:  python -m app.cli migrate

ALTER TABLE public.rate_charts ADD COLUMN IF NOT EXISTS side text NOT NULL DEFAULT 'farmer';
ALTER TABLE public.rate_charts DROP CONSTRAINT IF EXISTS rate_charts_side_check;
ALTER TABLE public.rate_charts ADD CONSTRAINT rate_charts_side_check CHECK (side IN ('farmer', 'dairy'));
CREATE INDEX IF NOT EXISTS rate_charts_lookup_idx ON public.rate_charts (center_id, side, milk_type, effective_from DESC);

-- the dairy chart a dispatch's rate came from (null = typed by hand)
ALTER TABLE public.dispatches ADD COLUMN IF NOT EXISTS dairy_chart_id text REFERENCES public.rate_charts(id);

CREATE OR REPLACE FUNCTION public.collections_farmer_chart_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.chart_id IS NOT NULL AND EXISTS (SELECT 1 FROM rate_charts r WHERE r.id = NEW.chart_id AND r.side <> 'farmer') THEN
    RAISE EXCEPTION 'a milk entry is priced with the farmer rate chart, not the dairy chart';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS collections_farmer_chart_trg ON public.collections;
CREATE TRIGGER collections_farmer_chart_trg BEFORE INSERT OR UPDATE OF chart_id ON public.collections
    FOR EACH ROW EXECUTE FUNCTION public.collections_farmer_chart_guard();

CREATE OR REPLACE FUNCTION public.dispatches_dairy_chart_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.dairy_chart_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rate_charts r WHERE r.id = NEW.dairy_chart_id AND r.side = 'dairy') THEN
    RAISE EXCEPTION 'dispatches.dairy_chart_id must point at a dairy rate chart';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dispatches_dairy_chart_trg ON public.dispatches;
CREATE TRIGGER dispatches_dairy_chart_trg BEFORE INSERT OR UPDATE OF dairy_chart_id ON public.dispatches
    FOR EACH ROW EXECUTE FUNCTION public.dispatches_dairy_chart_guard();
