ALTER TABLE public.cycle_runtime_state
  ADD COLUMN IF NOT EXISTS cycle_minute_key bigint;

CREATE OR REPLACE FUNCTION public.acquire_cycle_runtime_lease(
  p_id text, p_owner text, p_lease_seconds integer
)
RETURNS SETOF public.cycle_runtime_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_minute bigint := floor(extract(epoch from now()) / 60)::bigint;
  v_next_minute timestamptz := to_timestamp((floor(extract(epoch from now()) / 60)::bigint + 1) * 60);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cycle_runtime_lease:' || p_id));

  -- If a claim preparation died before it could progress, do not keep hammering
  -- the vault. End that minute bucket and let the next minute try cleanly.
  UPDATE public.cycle_runtime_state
  SET phase = 'claim',
      cycle_start_at = NULL,
      cooldown_until = v_next_minute,
      claim_guard_until = v_next_minute,
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

  -- Any non-claim cycle stuck for too long is ended fail-closed. This prevents
  -- old leases from blocking forever while still avoiding a second claim in the
  -- same minute bucket.
  UPDATE public.cycle_runtime_state
  SET phase = 'claim',
      cycle_start_at = NULL,
      cooldown_until = v_next_minute,
      claim_guard_until = v_next_minute,
      claimed_usdc = 0,
      spot_price = 0,
      attempts = 0,
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE id = p_id
    AND phase <> 'claim'
    AND cycle_start_at IS NOT NULL
    AND cycle_start_at < now() - interval '5 minutes'
    AND (lease_expires_at IS NULL OR lease_expires_at < now());

  RETURN QUERY
  UPDATE public.cycle_runtime_state
  SET lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      cycle_start_at = COALESCE(cycle_start_at, now()),
      cycle_minute_key = CASE
        WHEN cycle_start_at IS NULL THEN v_minute
        ELSE cycle_minute_key
      END,
      cooldown_until = CASE
        WHEN cycle_start_at IS NULL THEN v_next_minute
        ELSE cooldown_until
      END,
      updated_at = now()
  WHERE id = p_id
    AND (lease_expires_at IS NULL OR lease_expires_at < now())
    AND (
      -- Resume an already-started cycle before any new claim can start.
      cycle_start_at IS NOT NULL
      OR (
        -- Start at most once per deterministic minute bucket.
        (cycle_minute_key IS NULL OR cycle_minute_key < v_minute)
        AND (claim_guard_until IS NULL OR claim_guard_until <= now())
      )
    )
  RETURNING *;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_cycle_claim(
  p_id text, p_owner text, p_guard_seconds integer,
  p_claimed_usdc numeric, p_spot_price numeric
)
RETURNS SETOF public.cycle_runtime_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_next_minute timestamptz := to_timestamp((floor(extract(epoch from now()) / 60)::bigint + 1) * 60);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cycle_runtime_lease:' || p_id));

  RETURN QUERY
  UPDATE public.cycle_runtime_state
  SET phase = 'buy',
      claimed_usdc = p_claimed_usdc,
      spot_price = p_spot_price,
      attempts = 0,
      cooldown_until = v_next_minute,
      claim_guard_until = v_next_minute,
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

REVOKE ALL ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.reserve_cycle_claim(text, text, integer, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_cycle_claim(text, text, integer, numeric, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_cycle_claim(text, text, integer, numeric, numeric) TO service_role;