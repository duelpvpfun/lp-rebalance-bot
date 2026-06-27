CREATE TABLE IF NOT EXISTS public.stats_cache (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.stats_cache TO service_role;
ALTER TABLE public.stats_cache ENABLE ROW LEVEL SECURITY;
-- service_role only; no policies for anon/authenticated.