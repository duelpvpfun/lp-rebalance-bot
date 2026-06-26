CREATE TABLE IF NOT EXISTS public.cycle_runtime_state (
  id text PRIMARY KEY DEFAULT 'liquititty-auto-lp',
  phase text NOT NULL DEFAULT 'claim' CHECK (phase IN ('claim', 'buy', 'lp', 'burn')),
  cycle_start_at timestamptz,
  cooldown_until timestamptz NOT NULL DEFAULT now(),
  claimed_usdc numeric NOT NULL DEFAULT 0,
  spot_price numeric NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.cycle_runtime_state TO service_role;

ALTER TABLE public.cycle_runtime_state ENABLE ROW LEVEL SECURITY;

INSERT INTO public.cycle_runtime_state (id, cooldown_until)
VALUES ('liquititty-auto-lp', now() + interval '1 minute')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_cycle_runtime_state_updated_at ON public.cycle_runtime_state;
CREATE TRIGGER touch_cycle_runtime_state_updated_at
BEFORE UPDATE ON public.cycle_runtime_state
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.acquire_cycle_runtime_lease(
  p_id text,
  p_owner text,
  p_lease_seconds integer
)
RETURNS public.cycle_runtime_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.cycle_runtime_state;
BEGIN
  UPDATE public.cycle_runtime_state
  SET lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  WHERE id = p_id
    AND (lease_expires_at IS NULL OR lease_expires_at < now() OR lease_owner = p_owner)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) TO service_role;