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
SET search_path = public
AS $$
BEGIN
  -- Serialize claim reservation with lease acquisition and every other claim
  -- reservation. Only one transaction can pass the claim -> buy transition.
  PERFORM pg_advisory_xact_lock(hashtext('cycle_runtime_lease:' || p_id));

  RETURN QUERY
  UPDATE public.cycle_runtime_state
  SET phase = 'buy',
      claimed_usdc = p_claimed_usdc,
      spot_price = p_spot_price,
      attempts = 0,
      cooldown_until = now() + make_interval(secs => p_guard_seconds),
      updated_at = now()
  WHERE id = p_id
    AND lease_owner = p_owner
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at >= now()
    AND cycle_start_at IS NOT NULL
    AND phase = 'claim'
    AND claimed_usdc = 0
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_cycle_claim(text, text, integer, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_cycle_claim(text, text, integer, numeric, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_cycle_claim(text, text, integer, numeric, numeric) TO service_role;