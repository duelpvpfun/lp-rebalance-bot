DROP POLICY IF EXISTS "Trusted backend can manage cycle runtime state" ON public.cycle_runtime_state;
CREATE POLICY "Trusted backend can manage cycle runtime state"
ON public.cycle_runtime_state
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

REVOKE ALL ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) TO service_role;