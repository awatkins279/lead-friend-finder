-- Fix #1: Add ALL company size buckets the frontend actually sends.
-- The UI dropdown includes fine-grained options but the RPC only handled
-- a subset. Every option NOT handled was silently ignored (no filtering).
--
-- Fix #2: Re-add COALESCE fallback for leads whose location_tokens IS NULL
-- (backfill didn't complete). These leads were invisible to location search
-- since the previous version removed the fallback.
--
-- Fix #3: Single CTE builds the filtered rowset ONCE then count + data
-- queries read from it — the filter logic cannot drift between the two.

CREATE OR REPLACE FUNCTION public.search_leads(
  p_user_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_count_cap integer DEFAULT 50001
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := trim(coalesce(p_filters->>'name',''));
  v_company text := trim(coalesce(p_filters->>'company',''));
  v_industry text := trim(coalesce(p_filters->>'industry',''));
  v_has_phone bool := coalesce((p_filters->>'hasPhone')::bool, false);
  v_has_email bool := coalesce((p_filters->>'hasEmail')::bool, false);
  v_titles text[] := coalesce(
    (SELECT array_agg(trim(value)) FROM jsonb_array_elements_text(coalesce(p_filters->'titles','[]'::jsonb)) value WHERE trim(value) <> ''),
    '{}'::text[]
  );
  v_locations text[] := coalesce(
    (SELECT array_agg(lower(trim(value))) FROM jsonb_array_elements_text(coalesce(p_filters->'locations','[]'::jsonb)) value WHERE trim(value) <> ''),
    '{}'::text[]
  );
  v_sizes text[] := coalesce(
    (SELECT array_agg(trim(value)) FROM jsonb_array_elements_text(coalesce(p_filters->'companySize','[]'::jsonb)) value WHERE trim(value) <> ''),
    '{}'::text[]
  );
  v_loc_tokens text[] := '{}'::text[];
  v_size_mins int[] := '{}'::int[];
  v_size_maxs int[] := '{}'::int[];
  v_name1 text := '';
  v_name2 text := '';
  v_two_name bool := false;
  v_total int := 0;
  v_rows jsonb := '[]'::jsonb;
  s text;
BEGIN
  -- Build location tokens (including state name<->abbreviation expansion)
  FOREACH s IN ARRAY v_locations LOOP
    v_loc_tokens := array_append(v_loc_tokens, s);
    IF public.us_state_to_abbr(s) IS NOT NULL THEN
      v_loc_tokens := array_append(v_loc_tokens, public.us_state_to_abbr(s));
    END IF;
    IF public.us_abbr_to_state(s) IS NOT NULL THEN
      v_loc_tokens := array_append(v_loc_tokens, public.us_abbr_to_state(s));
    END IF;
  END LOOP;
  v_loc_tokens := coalesce(
    (SELECT array_agg(DISTINCT t) FROM unnest(v_loc_tokens) t WHERE t IS NOT NULL AND t <> ''),
    '{}'::text[]
  );

  -- FIX #1: Handle EVERY company size bucket the frontend sends.
  -- Frontend options: 1-10, 11-25, 26-50, 51-100, 101-250, 251-500,
  -- 501-1000, 1001-5000, 5000+
  FOREACH s IN ARRAY v_sizes LOOP
    IF s = '1-10' THEN
      v_size_mins := v_size_mins || 1;   v_size_maxs := v_size_maxs || 10;
    ELSIF s = '11-25' THEN
      v_size_mins := v_size_mins || 11;  v_size_maxs := v_size_maxs || 25;
    ELSIF s = '26-50' THEN
      v_size_mins := v_size_mins || 26;  v_size_maxs := v_size_maxs || 50;
    ELSIF s = '51-100' THEN
      v_size_mins := v_size_mins || 51;  v_size_maxs := v_size_maxs || 100;
    ELSIF s = '101-250' THEN
      v_size_mins := v_size_mins || 101; v_size_maxs := v_size_maxs || 250;
    ELSIF s = '251-500' THEN
      v_size_mins := v_size_mins || 251; v_size_maxs := v_size_maxs || 500;
    ELSIF s = '501-1000' THEN
      v_size_mins := v_size_mins || 501; v_size_maxs := v_size_maxs || 1000;
    ELSIF s = '1001-5000' THEN
      v_size_mins := v_size_mins || 1001; v_size_maxs := v_size_maxs || 5000;
    ELSIF s = '5000+' THEN
      v_size_mins := v_size_mins || 5000; v_size_maxs := v_size_maxs || 2147483647;
    END IF;
  END LOOP;

  -- Parse name into first/last parts for two-word searches
  IF v_name <> '' THEN
    IF position(' ' in v_name) > 0 THEN
      v_two_name := true;
      v_name1 := split_part(v_name, ' ', 1);
      v_name2 := trim(substring(v_name from position(' ' in v_name) + 1));
    ELSE
      v_name1 := v_name;
    END IF;
  END IF;

  -- FIX #3: Single CTE builds the filtered set ONCE.
  -- Both count and data queries read from it — no logic drift.
  WITH filtered AS (
    SELECT l.*
    FROM public.leads l
    WHERE (l.imported_by IS NULL OR l.imported_by = p_user_id)
      AND (v_name = '' OR (
        CASE WHEN v_two_name THEN
          (l.first_name ILIKE '%'||v_name1||'%' OR l.last_name ILIKE '%'||v_name1||'%')
          AND (l.first_name ILIKE '%'||v_name2||'%' OR l.last_name ILIKE '%'||v_name2||'%')
        ELSE
          (l.first_name ILIKE '%'||v_name1||'%' OR l.last_name ILIKE '%'||v_name1||'%')
        END
      ))
      AND (cardinality(v_titles) = 0 OR EXISTS (
        SELECT 1 FROM unnest(v_titles) t WHERE l.title ILIKE '%'||t||'%'
      ))
      AND (v_company = '' OR l.org_name ILIKE '%'||v_company||'%')
      AND (v_industry = '' OR l.org_industry ILIKE '%'||v_industry||'%')
      -- FIX #2: COALESCE fallback for NULL location_tokens so leads
      -- that weren't yet backfilled still appear in location searches.
      AND (cardinality(v_loc_tokens) = 0 OR (
        COALESCE(l.location_tokens, public.build_location_tokens(l.city, l.state, l.country)) && v_loc_tokens
      ))
      -- FIX #1 continued: COALESCE fallback for NULL employee_min/max
      -- so leads without parsed ranges still match company-size filters.
      AND (cardinality(v_size_mins) = 0 OR EXISTS (
        SELECT 1 FROM unnest(v_size_mins, v_size_maxs) AS sb(a, b)
        WHERE COALESCE(l.employee_max, public.parse_employee_max(l.org_employee_count), 2147483647) >= sb.a
          AND COALESCE(l.employee_min, public.parse_employee_min(l.org_employee_count), 0) <= sb.b
      ))
      AND (NOT v_has_phone OR (l.phone IS NOT NULL AND l.phone <> ''))
      AND (NOT v_has_email OR (l.email IS NOT NULL AND l.email <> ''))
  )
  SELECT count(*)::int INTO v_total FROM (
    SELECT 1 FROM filtered LIMIT p_count_cap
  ) sub;

  IF p_limit > 0 THEN
    SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_rows FROM (
      SELECT * FROM filtered
      ORDER BY id
      OFFSET greatest(p_offset, 0)
      LIMIT p_limit
    ) c;
  END IF;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'totalCount', v_total,
    'capped', v_total >= p_count_cap
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.search_leads(uuid, jsonb, int, int, int) TO authenticated, service_role;