CREATE OR REPLACE FUNCTION public.acquire_cycle_runtime_lease(
  p_id text,
  p_owner text,
  p_lease_seconds integer
)
RETURNS SETOF public.cycle_runtime_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Serialize every concurrent acquirer for this state id. Held for the
  -- duration of this transaction and released automatically.
  PERFORM pg_advisory_xact_lock(hashtext('cycle_runtime_lease:' || p_id));

  -- A row stuck at phase=claim after startup is dangerous, but ONLY reset it
  -- after the active lease is gone. Never clear a live lease while a slow claim
  -- transaction is still being built/sent, because that can create duplicates.
  UPDATE public.cycle_runtime_state
  SET phase = 'claim',
      cycle_start_at = NULL,
      cooldown_until = now() + interval '60 seconds',
      claim_guard_until = GREATEST(
        COALESCE(claim_guard_until, 'epoch'::timestamp with time zone),
        now() + interval '60 seconds'
      ),
      claimed_usdc = 0,
      spot_price = 0,
      attempts = 0,
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE id = p_id
    AND phase = 'claim'
    AND claimed_usdc = 0
    AND cycle_start_at IS NOT NULL
    AND cycle_start_at < now() - interval '10 seconds'
    AND (lease_expires_at IS NULL OR lease_expires_at < now());

  RETURN QUERY
  UPDATE public.cycle_runtime_state
  SET lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      cycle_start_at = COALESCE(cycle_start_at, now()),
      cooldown_until = CASE
        WHEN cycle_start_at IS NULL THEN now() + interval '60 seconds'
        ELSE cooldown_until
      END,
      updated_at = now()
  WHERE id = p_id
    AND (lease_expires_at IS NULL OR lease_expires_at < now())
    AND (
      cycle_start_at IS NOT NULL
      OR (
        cooldown_until <= now()
        AND (claim_guard_until IS NULL OR claim_guard_until <= now())
      )
    )
  RETURNING *;
END;
$function$;

REVOKE ALL ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) TO service_role;