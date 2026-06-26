-- Add per-minute bucket key + tighten lease/claim guards to a single 60s interval.
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
BEGIN
  -- Serialize every concurrent acquirer for this state id.
  PERFORM pg_advisory_xact_lock(hashtext('cycle_runtime_lease:' || p_id));

  -- A row stuck at phase=claim after the lease expired is dangerous; reset it
  -- only when no live lease is held, never while a slow claim is in-flight.
  UPDATE public.cycle_runtime_state
  SET phase = 'claim',
      cycle_start_at = NULL,
      cooldown_until = now() + interval '60 seconds',
      claim_guard_until = GREATEST(
        COALESCE(claim_guard_until, 'epoch'::timestamptz),
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

  -- Acquire the lease. A new cycle (cycle_start_at currently NULL) is only
  -- allowed once per floor(now/60s) minute bucket. Resuming an in-flight cycle
  -- bypasses the bucket check (the bucket was already claimed when it started).
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
        AND (cycle_minute_key IS NULL OR cycle_minute_key < v_minute)
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
BEGIN
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

-- Ensure pg_cron / pg_net are enabled so the scheduler can call the tick route.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;