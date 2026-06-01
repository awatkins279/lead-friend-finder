-- Auto-promote specific emails to admin on signup, and backfill if they already exist

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  -- Auto-grant admin to allowlisted emails (free unlimited access for testers)
  IF lower(NEW.email) IN ('awatkins@ttmusa.net', 'jeremy@ttmusa.net') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- Backfill: if either already has an account, promote them now
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::app_role
FROM auth.users u
WHERE lower(u.email) IN ('awatkins@ttmusa.net', 'jeremy@ttmusa.net')
ON CONFLICT (user_id, role) DO NOTHING;
