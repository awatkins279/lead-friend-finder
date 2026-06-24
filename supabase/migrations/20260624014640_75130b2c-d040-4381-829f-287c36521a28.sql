
CREATE OR REPLACE FUNCTION public.search_leads(
  p_user_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0,
  p_count_cap int DEFAULT 50001
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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

  FOREACH s IN ARRAY v_sizes LOOP
    IF s = '1-10' THEN v_size_mins := v_size_mins || 1; v_size_maxs := v_size_maxs || 10;
    ELSIF s = '11-25' THEN v_size_mins := v_size_mins || 11; v_size_maxs := v_size_maxs || 25;
    ELSIF s = '26-50' THEN v_size_mins := v_size_mins || 26; v_size_maxs := v_size_maxs || 50;
    ELSIF s = '51-100' THEN v_size_mins := v_size_mins || 51; v_size_maxs := v_size_maxs || 100;
    ELSIF s = '101-250' THEN v_size_mins := v_size_mins || 101; v_size_maxs := v_size_maxs || 250;
    ELSIF s = '251-500' THEN v_size_mins := v_size_mins || 251; v_size_maxs := v_size_maxs || 500;
    ELSIF s = '501-1000' THEN v_size_mins := v_size_mins || 501; v_size_maxs := v_size_maxs || 1000;
    ELSIF s = '1001-5000' THEN v_size_mins := v_size_mins || 1001; v_size_maxs := v_size_maxs || 5000;
    ELSIF s = '5000+' THEN v_size_mins := v_size_mins || 5000; v_size_maxs := v_size_maxs || 2147483647;
    END IF;
  END LOOP;

  IF v_name <> '' THEN
    IF position(' ' in v_name) > 0 THEN
      v_two_name := true;
      v_name1 := split_part(v_name, ' ', 1);
      v_name2 := trim(substring(v_name from position(' ' in v_name) + 1));
    ELSE
      v_name1 := v_name;
    END IF;
  END IF;

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
      AND (cardinality(v_loc_tokens) = 0 OR (l.location_tokens && v_loc_tokens))
      AND (cardinality(v_size_mins) = 0 OR EXISTS (
        SELECT 1 FROM unnest(v_size_mins, v_size_maxs) AS sb(a, b)
        WHERE l.employee_max >= sb.a AND l.employee_min <= sb.b
      ))
      AND (NOT v_has_phone OR (l.phone IS NOT NULL AND l.phone <> ''))
      AND (NOT v_has_email OR (l.email IS NOT NULL AND l.email <> ''))
  ),
  capped AS (
    SELECT * FROM filtered ORDER BY id LIMIT p_count_cap
  )
  SELECT
    (SELECT count(*)::int FROM capped),
    (SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
     FROM (SELECT * FROM capped ORDER BY id OFFSET greatest(p_offset,0) LIMIT greatest(p_limit,0)) c)
  INTO v_total, v_rows;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'totalCount', v_total,
    'capped', v_total >= p_count_cap
  );
END $$;
