REVOKE ALL ON FUNCTION public.liquititty_fire_tick() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.liquititty_fire_tick() FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.mark_cycle_minute_run_finished() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_cycle_minute_run_finished() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_cycle_minute_run_finished() TO service_role;

REVOKE ALL ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_cycle_runtime_lease(text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.reserve_cycle_claim(text, text, integer, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_cycle_claim(text, text, integer, numeric, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_cycle_claim(text, text, integer, numeric, numeric) TO service_role;