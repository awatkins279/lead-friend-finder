-- Extend subscriptions table for Stripe sync
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS product_id text,
  ADD COLUMN IF NOT EXISTS price_id text;

-- These can be derived/null until webhook resolves them
ALTER TABLE public.subscriptions ALTER COLUMN plan_id DROP NOT NULL;
ALTER TABLE public.subscriptions ALTER COLUMN billing_cycle DROP NOT NULL;
ALTER TABLE public.subscriptions ALTER COLUMN current_period_end DROP NOT NULL;

-- Unique constraint for upsert idempotency
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_stripe_sub_id_key'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_stripe_sub_id_key UNIQUE (stripe_subscription_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_env ON public.subscriptions(user_id, environment);

-- Service role needs full access for webhook writes
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO service_role;

-- Trigger: when a subscription becomes active OR its period rolls forward,
-- grant the plan's monthly_credits to credit_ledger for that period.
CREATE OR REPLACE FUNCTION public.grant_subscription_credits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits integer;
BEGIN
  IF NEW.status NOT IN ('active', 'trialing') THEN
    RETURN NEW;
  END IF;
  IF NEW.plan_id IS NULL OR NEW.current_period_start IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip if we already granted for this period
  IF EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE user_id = NEW.user_id
      AND period_start = NEW.current_period_start
      AND action = 'grant:subscription'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT monthly_credits INTO v_credits FROM public.plans WHERE id = NEW.plan_id;
  IF v_credits IS NULL OR v_credits <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.credit_ledger (user_id, amount, action, period_start, note)
  VALUES (NEW.user_id, v_credits, 'grant:subscription', NEW.current_period_start,
          'Granted ' || v_credits || ' credits for plan ' || NEW.plan_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_subscription_credits_ins ON public.subscriptions;
CREATE TRIGGER trg_grant_subscription_credits_ins
  AFTER INSERT ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.grant_subscription_credits();

DROP TRIGGER IF EXISTS trg_grant_subscription_credits_upd ON public.subscriptions;
CREATE TRIGGER trg_grant_subscription_credits_upd
  AFTER UPDATE OF current_period_start, status, plan_id ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.grant_subscription_credits();

-- Map Stripe price_id (lookup_key) → plan_id + billing_cycle automatically
CREATE OR REPLACE FUNCTION public.derive_subscription_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.price_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.plan_id IS NULL THEN
    NEW.plan_id := split_part(NEW.price_id, '_', 1);
  END IF;
  IF NEW.billing_cycle IS NULL THEN
    NEW.billing_cycle := split_part(NEW.price_id, '_', 2);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_subscription_plan ON public.subscriptions;
CREATE TRIGGER trg_derive_subscription_plan
  BEFORE INSERT OR UPDATE OF price_id ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.derive_subscription_plan();