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
  RETURN QUERY
  UPDATE public.cycle_runtime_state
  SET lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  WHERE id = p_id
    AND (lease_expires_at IS NULL OR lease_expires_at < now())
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) TO service_role;