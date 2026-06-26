ALTER TABLE public.cycle_runtime_state
ADD COLUMN IF NOT EXISTS claim_guard_until timestamp with time zone;

UPDATE public.cycle_runtime_state
SET claim_guard_until = GREATEST(
  COALESCE(claim_guard_until, 'epoch'::timestamp with time zone),
  COALESCE(cooldown_until, 'epoch'::timestamp with time zone)
)
WHERE id = 'liquititty-auto-lp';

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

  -- A row stuck at phase=claim after startup is dangerous: retrying it can
  -- create duplicate CollectCreatorFee txs. Fail closed by skipping this minute
  -- and keep a claim-specific guard so stale callers cannot immediately reclaim.
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
    AND cycle_start_at < now() - interval '10 seconds';

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

CREATE OR REPLACE FUNCTION public.reserve_cycle_claim(
  p_id text,
  p_owner text,
  p_guard_seconds integer,
  p_claimed_usdc numeric,
  p_spot_price numeric
)
RETURNS SETOF public.cycle_runtime_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Serialize claim reservation with lease acquisition and every other claim
  -- reservation. Only one transaction can pass the claim -> buy transition per guard window.
  PERFORM pg_advisory_xact_lock(hashtext('cycle_runtime_lease:' || p_id));

  RETURN QUERY
  UPDATE public.cycle_runtime_state
  SET phase = 'buy',
      claimed_usdc = p_claimed_usdc,
      spot_price = p_spot_price,
      attempts = 0,
      cooldown_until = now() + make_interval(secs => p_guard_seconds),
      claim_guard_until = now() + make_interval(secs => p_guard_seconds),
      updated_at = now()
  WHERE id = p_id
    AND lease_owner = p_owner
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at >= now()
    AND cycle_start_at IS NOT NULL
    AND phase = 'claim'
    AND claimed_usdc = 0
    AND (claim_guard_until IS NULL OR claim_guard_until <= now())
  RETURNING *;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_cycle_claim(text, text, integer, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_cycle_claim(text, text, integer, numeric, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_cycle_claim(text, text, integer, numeric, numeric) TO service_role;