
-- ============ ROLES ============
CREATE TYPE public.app_role AS ENUM ('admin', 'customer');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ============ PLANS ============
CREATE TABLE public.plans (
  id text PRIMARY KEY,                  -- 'basic' | 'pro' | 'enterprise'
  name text NOT NULL,
  monthly_credits integer NOT NULL,
  annual_price_cents integer NOT NULL,        -- per year, paid upfront
  quarterly_price_cents integer NOT NULL,     -- per 4-month period
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plans TO anon, authenticated;
GRANT ALL ON public.plans TO service_role;

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plans are public" ON public.plans FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.plans (id, name, monthly_credits, annual_price_cents, quarterly_price_cents, sort_order) VALUES
  ('basic',      'Basic',        5000,   958800,  415480, 1),
  ('pro',        'Professional', 10000, 1318800,  571480, 2),
  ('enterprise', 'Enterprise',   25000, 1798800,  779480, 3);

-- ============ CREDIT COSTS ============
CREATE TABLE public.credit_costs (
  action text PRIMARY KEY,             -- 'pull_contacts' | 'enrich' | 'generate_email' | 'activate_campaign'
  cost_per_unit integer NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.credit_costs TO authenticated;
GRANT ALL ON public.credit_costs TO service_role;

ALTER TABLE public.credit_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Costs readable by authed" ON public.credit_costs FOR SELECT TO authenticated USING (true);

INSERT INTO public.credit_costs (action, cost_per_unit, description) VALUES
  ('pull_contacts',     1, 'Per contact pulled from the database'),
  ('enrich',            2, 'Per contact enriched'),
  ('generate_email',    3, 'Per AI-generated email or call script'),
  ('activate_campaign', 5, 'Per contact activated in a campaign');

-- ============ SUBSCRIPTIONS ============
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.plans(id),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('annual','quarterly')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','suspended','cancelled')),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL,
  next_billing_date timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own sub" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins read all subs" ON public.subscriptions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_subs_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ CREDIT LEDGER ============
-- Append-only. Positive = grant (monthly reset, bonus). Negative = spend.
CREATE TABLE public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount integer NOT NULL,              -- signed
  action text NOT NULL,                 -- 'grant','spend:pull_contacts','spend:enrich','spend:generate_email','spend:activate_campaign','adjustment'
  period_start timestamptz NOT NULL,    -- billing period this entry counts against
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_user_period ON public.credit_ledger(user_id, period_start);

GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own ledger" ON public.credit_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins read all ledger" ON public.credit_ledger FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ ATOMIC SPEND FUNCTION ============
-- Returns new remaining balance, or raises 'insufficient_credits'.
-- Admins bypass: returns 999999999 and writes no row.
CREATE OR REPLACE FUNCTION public.spend_credits(
  _user_id uuid,
  _action text,
  _amount integer,
  _note text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period_start timestamptz;
  v_allowance integer;
  v_used integer;
  v_remaining integer;
BEGIN
  IF public.has_role(_user_id, 'admin') THEN
    RETURN 999999999;
  END IF;

  SELECT s.current_period_start, p.monthly_credits
    INTO v_period_start, v_allowance
  FROM public.subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.user_id = _user_id AND s.status = 'active';

  IF v_period_start IS NULL THEN
    RAISE EXCEPTION 'no_active_subscription';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_used
  FROM public.credit_ledger
  WHERE user_id = _user_id AND period_start = v_period_start;
  -- v_used is signed: grants positive, spends negative. Remaining = allowance + v_used effectively when we treat allowance as cap.

  -- Compute remaining: allowance minus absolute spends. Grants beyond initial allowance (bonus) increase cap.
  SELECT v_allowance
    + COALESCE((SELECT SUM(amount) FROM public.credit_ledger WHERE user_id=_user_id AND period_start=v_period_start AND amount > 0), 0)
    - COALESCE((SELECT -SUM(amount) FROM public.credit_ledger WHERE user_id=_user_id AND period_start=v_period_start AND amount < 0), 0)
    INTO v_remaining;

  IF v_remaining < _amount THEN
    RAISE EXCEPTION 'insufficient_credits' USING DETAIL = v_remaining::text;
  END IF;

  INSERT INTO public.credit_ledger (user_id, amount, action, period_start, note)
  VALUES (_user_id, -_amount, 'spend:' || _action, v_period_start, _note);

  RETURN v_remaining - _amount;
END;
$$;

-- Read helper
CREATE OR REPLACE FUNCTION public.get_credit_summary(_user_id uuid)
RETURNS TABLE (
  is_admin boolean,
  plan_id text,
  plan_name text,
  allowance integer,
  used integer,
  remaining integer,
  period_start timestamptz,
  period_end timestamptz,
  by_action jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin boolean := public.has_role(_user_id, 'admin');
BEGIN
  IF v_admin THEN
    RETURN QUERY SELECT true, NULL::text, 'Owner'::text, 999999999, 0, 999999999,
      now(), now() + interval '100 years', '{}'::jsonb;
    RETURN;
  END IF;

  RETURN QUERY
  WITH sub AS (
    SELECT s.current_period_start, s.current_period_end, p.id pid, p.name pname, p.monthly_credits mc
    FROM public.subscriptions s JOIN public.plans p ON p.id = s.plan_id
    WHERE s.user_id = _user_id AND s.status = 'active'
  ),
  agg AS (
    SELECT
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS bonus,
      COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS spent,
      COALESCE(jsonb_object_agg(action, total), '{}'::jsonb) AS by_action
    FROM (
      SELECT action, SUM(-amount)::int AS total
      FROM public.credit_ledger l, sub
      WHERE l.user_id = _user_id AND l.period_start = sub.current_period_start AND l.amount < 0
      GROUP BY action
    ) x
    FULL OUTER JOIN (SELECT 0) z ON true
  )
  SELECT false, sub.pid, sub.pname,
         (sub.mc + agg.bonus)::int,
         agg.spent::int,
         (sub.mc + agg.bonus - agg.spent)::int,
         sub.current_period_start, sub.current_period_end,
         agg.by_action
  FROM sub, agg;
END;
$$;

GRANT EXECUTE ON FUNCTION public.spend_credits(uuid, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_credit_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, anon;
