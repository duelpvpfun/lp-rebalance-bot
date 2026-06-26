DROP FUNCTION IF EXISTS public.acquire_cycle_runtime_lease(text, text, integer);

CREATE OR REPLACE FUNCTION public.acquire_cycle_runtime_lease(
  p_id text,
  p_owner text,
  p_lease_seconds integer
)
RETURNS SETOF public.cycle_runtime_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Serialize every concurrent acquirer for this state id. Held for the
  -- duration of this transaction and released automatically.
  PERFORM pg_advisory_xact_lock(hashtext('cycle_runtime_lease:' || p_id));

  RETURN QUERY
  UPDATE public.cycle_runtime_state
  SET lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      -- If this lease starts a fresh cycle, mark it active immediately in the
      -- same atomic UPDATE. That closes the gap where another caller could see
      -- an expired idle row while the first caller is still building claim txs.
      cycle_start_at = COALESCE(cycle_start_at, now()),
      cooldown_until = CASE
        WHEN cycle_start_at IS NULL THEN now() + interval '60 seconds'
        ELSE cooldown_until
      END
  WHERE id = p_id
    AND (lease_expires_at IS NULL OR lease_expires_at < now())
    AND (cycle_start_at IS NOT NULL OR cooldown_until <= now())
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) TO service_role;