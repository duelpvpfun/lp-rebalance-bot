-- ============================================================================
-- Launchpad multi-tenant schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.coins (
  mint              text PRIMARY KEY,
  slug              text UNIQUE NOT NULL,
  name              text NOT NULL,
  symbol            text NOT NULL,
  description       text,
  image_url         text,
  website_url       text,
  twitter_url       text,
  telegram_url      text,
  deployer_wallet   text NOT NULL,
  pair_address      text,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','launching','live','paused','failed')),
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  launched_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.coin_wallets (
  mint              text PRIMARY KEY REFERENCES public.coins(mint) ON DELETE CASCADE,
  public_key        text UNIQUE NOT NULL,
  encrypted_secret  jsonb NOT NULL,
  sol_buffer        numeric NOT NULL DEFAULT 0.06,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.coin_cycle_state (
  mint              text PRIMARY KEY REFERENCES public.coins(mint) ON DELETE CASCADE,
  phase             text NOT NULL DEFAULT 'claim'
                      CHECK (phase IN ('claim','fee','refill','buy','lp','burn','sweep')),
  cycle_bucket      bigint NOT NULL DEFAULT 0,
  cycle_start_at    timestamptz,
  cooldown_until    timestamptz NOT NULL DEFAULT now(),
  claim_guard_until timestamptz,
  claimed_usdc      numeric NOT NULL DEFAULT 0,
  spot_price        numeric NOT NULL DEFAULT 0,
  attempts          integer NOT NULL DEFAULT 0,
  lease_owner       text,
  lease_expires_at  timestamptz,
  last_error        text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.coin_activity (
  id          bigserial PRIMARY KEY,
  mint        text NOT NULL REFERENCES public.coins(mint) ON DELETE CASCADE,
  step        text NOT NULL,
  ok          boolean NOT NULL,
  signature   text,
  amount_usdc numeric,
  amount_sol  numeric,
  info        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coin_activity_mint_created_idx
  ON public.coin_activity (mint, created_at DESC);

CREATE INDEX IF NOT EXISTS coins_status_enabled_idx
  ON public.coins (status, enabled);

CREATE OR REPLACE FUNCTION public.acquire_coin_cycle_lease(
  p_mint text,
  p_owner text,
  p_lease_seconds integer,
  p_bucket bigint
)
RETURNS SETOF public.coin_cycle_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('coin_cycle_lease:' || p_mint));

  UPDATE public.coin_cycle_state
  SET phase = 'claim',
      cycle_start_at = NULL,
      claimed_usdc = 0,
      spot_price = 0,
      attempts = 0,
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE mint = p_mint
    AND phase = 'claim'
    AND claimed_usdc = 0
    AND cycle_start_at IS NOT NULL
    AND cycle_start_at < now() - interval '15 seconds'
    AND (lease_expires_at IS NULL OR lease_expires_at < now());

  RETURN QUERY
  UPDATE public.coin_cycle_state s
  SET lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      cycle_start_at = COALESCE(s.cycle_start_at, now()),
      cycle_bucket = CASE WHEN s.cycle_start_at IS NULL THEN p_bucket ELSE s.cycle_bucket END,
      updated_at = now()
  WHERE s.mint = p_mint
    AND (s.lease_expires_at IS NULL OR s.lease_expires_at < now())
    AND (
      s.cycle_start_at IS NOT NULL
      OR (
        s.cooldown_until <= now()
        AND (s.claim_guard_until IS NULL OR s.claim_guard_until <= now())
        AND s.cycle_bucket < p_bucket
      )
    )
  RETURNING s.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.acquire_coin_cycle_lease(text, text, integer, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.acquire_coin_cycle_lease(text, text, integer, bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_coin_cycle_lease(text, text, integer, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_coin_claim(
  p_mint text,
  p_owner text,
  p_guard_seconds integer,
  p_claimed_usdc numeric,
  p_spot_price numeric
)
RETURNS SETOF public.coin_cycle_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('coin_cycle_lease:' || p_mint));

  RETURN QUERY
  UPDATE public.coin_cycle_state
  SET phase = 'fee',
      claimed_usdc = p_claimed_usdc,
      spot_price = p_spot_price,
      attempts = 0,
      cooldown_until = now() + make_interval(secs => p_guard_seconds),
      claim_guard_until = now() + make_interval(secs => p_guard_seconds),
      updated_at = now()
  WHERE mint = p_mint
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

REVOKE ALL ON FUNCTION public.reserve_coin_claim(text, text, integer, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_coin_claim(text, text, integer, numeric, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_coin_claim(text, text, integer, numeric, numeric) TO service_role;

ALTER TABLE public.coins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_cycle_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coins_public_read ON public.coins;
CREATE POLICY coins_public_read ON public.coins
  FOR SELECT USING (true);

DROP POLICY IF EXISTS coin_activity_public_read ON public.coin_activity;
CREATE POLICY coin_activity_public_read ON public.coin_activity
  FOR SELECT USING (true);

-- ============================================================================
-- User-funded launch flow
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pending_wallets (
  public_key       text PRIMARY KEY,
  encrypted_secret jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pending_launches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status           text NOT NULL DEFAULT 'awaiting_funds'
                     CHECK (status IN ('awaiting_funds','funded','executing','launched','failed','expired')),
  dev_wallet       text NOT NULL REFERENCES public.pending_wallets(public_key),
  deployer_wallet  text NOT NULL,
  name             text NOT NULL,
  symbol           text NOT NULL,
  slug             text NOT NULL,
  description      text,
  image_url        text,
  website_url      text,
  twitter_url      text,
  telegram_url     text,
  metadata_uri     text,
  initial_buy_usdc numeric NOT NULL,
  gas_reserve_sol  numeric NOT NULL DEFAULT 0.1,
  mint             text,
  last_error       text,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pending_launches_status_idx
  ON public.pending_launches (status, expires_at);
CREATE INDEX IF NOT EXISTS pending_launches_deployer_idx
  ON public.pending_launches (deployer_wallet, created_at DESC);

ALTER TABLE public.pending_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_launches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pending_launches_public_read ON public.pending_launches;
CREATE POLICY pending_launches_public_read ON public.pending_launches
  FOR SELECT USING (true);
