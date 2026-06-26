CREATE TABLE IF NOT EXISTS public.bot_runtime_secrets (
  key text PRIMARY KEY,
  secret text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bot_runtime_secrets TO service_role;

ALTER TABLE public.bot_runtime_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can read bot runtime secrets" ON public.bot_runtime_secrets;
CREATE POLICY "Service role can read bot runtime secrets"
ON public.bot_runtime_secrets
FOR SELECT
TO service_role
USING (true);

INSERT INTO public.bot_runtime_secrets (key, secret, updated_at)
VALUES ('pg_cron_tick', encode(gen_random_bytes(32), 'hex'), now())
ON CONFLICT (key) DO UPDATE
SET secret = excluded.secret,
    updated_at = now();

CREATE TABLE IF NOT EXISTS public.cycle_minute_runs (
  minute_key bigint PRIMARY KEY,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'finished', 'aborted')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.cycle_minute_runs TO service_role;

ALTER TABLE public.cycle_minute_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage cycle minute runs" ON public.cycle_minute_runs;
CREATE POLICY "Service role can manage cycle minute runs"
ON public.cycle_minute_runs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS touch_cycle_minute_runs_updated_at ON public.cycle_minute_runs;
CREATE TRIGGER touch_cycle_minute_runs_updated_at
BEFORE UPDATE ON public.cycle_minute_runs
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.mark_cycle_minute_run_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.cycle_start_at IS NOT NULL
     AND NEW.cycle_start_at IS NULL
     AND OLD.cycle_minute_key IS NOT NULL THEN
    UPDATE public.cycle_minute_runs
    SET status = CASE WHEN NEW.claimed_usdc = 0 THEN 'aborted' ELSE 'finished' END,
        finished_at = now(),
        updated_at = now()
    WHERE minute_key = OLD.cycle_minute_key
      AND status = 'running';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mark_cycle_minute_run_finished_trigger ON public.cycle_runtime_state;
CREATE TRIGGER mark_cycle_minute_run_finished_trigger
AFTER UPDATE ON public.cycle_runtime_state
FOR EACH ROW
EXECUTE FUNCTION public.mark_cycle_minute_run_finished();

CREATE OR REPLACE FUNCTION public.acquire_cycle_runtime_lease(
  p_id text, p_owner text, p_lease_seconds integer
)
RETURNS SETOF public.cycle_runtime_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_minute bigint := floor(extract(epoch from now()) / 60)::bigint;
  v_next_minute timestamptz := to_timestamp((floor(extract(epoch from now()) / 60)::bigint + 1) * 60);
  v_started boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cycle_runtime_lease:' || p_id));

  -- If a claim preparation died before it could progress, end that minute
  -- fail-closed. Do not reclaim inside the same bucket.
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
      updated_at = v_now
  WHERE id = p_id
    AND phase = 'claim'
    AND claimed_usdc = 0
    AND cycle_start_at IS NOT NULL
    AND cycle_start_at < v_now - interval '10 seconds'
    AND (lease_expires_at IS NULL OR lease_expires_at < v_now);

  -- Any non-claim cycle stuck for too long is ended fail-closed.
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
      updated_at = v_now
  WHERE id = p_id
    AND phase <> 'claim'
    AND cycle_start_at IS NOT NULL
    AND cycle_start_at < v_now - interval '5 minutes'
    AND (lease_expires_at IS NULL OR lease_expires_at < v_now);

  -- Resume already-started work first. This does not consume a new minute key.
  RETURN QUERY
  UPDATE public.cycle_runtime_state
  SET lease_owner = p_owner,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      updated_at = v_now
  WHERE id = p_id
    AND cycle_start_at IS NOT NULL
    AND (lease_expires_at IS NULL OR lease_expires_at < v_now)
  RETURNING *;

  IF FOUND THEN
    RETURN;
  END IF;

  -- Fresh starts are allowed only when BOTH cooldown gates are open.
  IF NOT EXISTS (
    SELECT 1
    FROM public.cycle_runtime_state
    WHERE id = p_id
      AND cycle_start_at IS NULL
      AND (lease_expires_at IS NULL OR lease_expires_at < v_now)
      AND (cooldown_until IS NULL OR cooldown_until <= v_now)
      AND (claim_guard_until IS NULL OR claim_guard_until <= v_now)
      AND (cycle_minute_key IS NULL OR cycle_minute_key < v_minute)
  ) THEN
    RETURN;
  END IF;

  -- Durable idempotency: one and only one fresh claim may start for a given
  -- deterministic minute bucket, no matter how many cron callers/deployments hit.
  INSERT INTO public.cycle_minute_runs (minute_key, status, started_at)
  VALUES (v_minute, 'running', v_now)
  ON CONFLICT (minute_key) DO NOTHING;
  GET DIAGNOSTICS v_started = ROW_COUNT;

  IF NOT v_started THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.cycle_runtime_state
  SET lease_owner = p_owner,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      cycle_start_at = v_now,
      cycle_minute_key = v_minute,
      phase = 'claim',
      cooldown_until = v_next_minute,
      claimed_usdc = 0,
      spot_price = 0,
      attempts = 0,
      updated_at = v_now
  WHERE id = p_id
    AND cycle_start_at IS NULL
    AND (lease_expires_at IS NULL OR lease_expires_at < v_now)
    AND (cooldown_until IS NULL OR cooldown_until <= v_now)
    AND (claim_guard_until IS NULL OR claim_guard_until <= v_now)
    AND (cycle_minute_key IS NULL OR cycle_minute_key < v_minute)
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
    AND cycle_minute_key = floor(extract(epoch from cycle_start_at) / 60)::bigint
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

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.liquititty_fire_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $function$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT secret INTO v_secret
  FROM public.bot_runtime_secrets
  WHERE key = 'pg_cron_tick';

  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'pg_cron_tick secret missing';
  END IF;

  SELECT net.http_post(
    url := 'https://lp-rebalance-bot.lovable.app/api/public/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.liquititty_fire_tick() FROM PUBLIC;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'liquititty-tick-every-minute'
       OR command ILIKE '%/api/public/tick%'
       OR command ILIKE '%liquititty_fire_tick%'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'liquititty-tick-every-minute',
  '* * * * *',
  'SELECT public.liquititty_fire_tick();'
);