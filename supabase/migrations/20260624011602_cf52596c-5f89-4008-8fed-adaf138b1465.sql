
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS employee_min integer,
  ADD COLUMN IF NOT EXISTS employee_max integer,
  ADD COLUMN IF NOT EXISTS location_tokens text[];

CREATE OR REPLACE FUNCTION public.parse_employee_min(p text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE s text; m text[];
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  s := lower(trim(regexp_replace(p, ',', '', 'g')));
  IF s = '' THEN RETURN NULL; END IF;
  m := regexp_match(s, '^([0-9]+)\s*\+$');
  IF m IS NOT NULL THEN RETURN (m[1])::int; END IF;
  m := regexp_match(s, '^([0-9]+)\s*(?:to|-)\s*([0-9]+)$');
  IF m IS NOT NULL THEN RETURN (m[1])::int; END IF;
  m := regexp_match(s, '^([0-9]+)$');
  IF m IS NOT NULL THEN RETURN (m[1])::int; END IF;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.parse_employee_max(p text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE s text; m text[];
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  s := lower(trim(regexp_replace(p, ',', '', 'g')));
  IF s = '' THEN RETURN NULL; END IF;
  m := regexp_match(s, '^([0-9]+)\s*\+$');
  IF m IS NOT NULL THEN RETURN NULL; END IF;
  m := regexp_match(s, '^([0-9]+)\s*(?:to|-)\s*([0-9]+)$');
  IF m IS NOT NULL THEN RETURN (m[2])::int; END IF;
  m := regexp_match(s, '^([0-9]+)$');
  IF m IS NOT NULL THEN RETURN (m[1])::int; END IF;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.build_location_tokens(p_city text, p_state text, p_country text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  name_to_abbr jsonb := '{
    "alabama":"al","alaska":"ak","arizona":"az","arkansas":"ar","california":"ca",
    "colorado":"co","connecticut":"ct","delaware":"de","florida":"fl","georgia":"ga",
    "hawaii":"hi","idaho":"id","illinois":"il","indiana":"in","iowa":"ia","kansas":"ks",
    "kentucky":"ky","louisiana":"la","maine":"me","maryland":"md","massachusetts":"ma",
    "michigan":"mi","minnesota":"mn","mississippi":"ms","missouri":"mo","montana":"mt",
    "nebraska":"ne","nevada":"nv","new hampshire":"nh","new jersey":"nj",
    "new mexico":"nm","new york":"ny","north carolina":"nc","north dakota":"nd",
    "ohio":"oh","oklahoma":"ok","oregon":"or","pennsylvania":"pa","rhode island":"ri",
    "south carolina":"sc","south dakota":"sd","tennessee":"tn","texas":"tx",
    "utah":"ut","vermont":"vt","virginia":"va","washington":"wa","west virginia":"wv",
    "wisconsin":"wi","wyoming":"wy","district of columbia":"dc"
  }'::jsonb;
  abbr_to_name jsonb;
  city_l text := lower(trim(coalesce(p_city,'')));
  state_l text := lower(trim(coalesce(p_state,'')));
  country_l text := lower(trim(coalesce(p_country,'')));
  toks text[] := '{}'::text[];
BEGIN
  SELECT jsonb_object_agg(value, key) INTO abbr_to_name FROM jsonb_each_text(name_to_abbr);
  IF city_l <> '' THEN toks := toks || city_l; END IF;
  IF country_l <> '' THEN toks := toks || country_l; END IF;
  IF state_l <> '' THEN
    toks := toks || state_l;
    IF name_to_abbr ? state_l THEN toks := toks || (name_to_abbr->>state_l);
    ELSIF abbr_to_name ? state_l THEN toks := toks || (abbr_to_name->>state_l); END IF;
  END IF;
  SELECT array_agg(DISTINCT t) INTO toks FROM unnest(toks) t WHERE t <> '';
  RETURN coalesce(toks, '{}'::text[]);
END; $$;

CREATE OR REPLACE FUNCTION public.leads_sync_derived()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.employee_min := public.parse_employee_min(NEW.org_employee_count);
  NEW.employee_max := public.parse_employee_max(NEW.org_employee_count);
  NEW.location_tokens := public.build_location_tokens(NEW.city, NEW.state, NEW.country);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS leads_sync_derived_trg ON public.leads;
CREATE TRIGGER leads_sync_derived_trg
BEFORE INSERT OR UPDATE OF org_employee_count, city, state, country
ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.leads_sync_derived();
