CREATE OR REPLACE FUNCTION public.match_lead_ids_for_people_search(p_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50001)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 50001), 1), 50001);
  v_name text := trim(coalesce(p_filters->>'name', ''));
  v_company text := trim(coalesce(p_filters->>'company', ''));
  v_industry text := trim(coalesce(p_filters->>'industry', ''));
  v_has_phone boolean := coalesce((p_filters->>'hasPhone')::boolean, false);
  v_has_email boolean := coalesce((p_filters->>'hasEmail')::boolean, false);
  v_titles text[] := coalesce((SELECT array_agg(trim(value)) FROM jsonb_array_elements_text(coalesce(p_filters->'titles', '[]'::jsonb)) AS value WHERE trim(value) <> ''), '{}'::text[]);
  v_locations text[] := coalesce((SELECT array_agg(trim(value)) FROM jsonb_array_elements_text(coalesce(p_filters->'locations', '[]'::jsonb)) AS value WHERE trim(value) <> ''), '{}'::text[]);
  v_sizes text[] := coalesce((SELECT array_agg(trim(value)) FROM jsonb_array_elements_text(coalesce(p_filters->'companySize', '[]'::jsonb)) AS value WHERE trim(value) <> ''), '{}'::text[]);
  v_raw_sizes text[] := '{}'::text[];
  v_ids text[] := '{}'::text[];
  v_total_count integer := 0;
BEGIN
  IF '1-10' = ANY(v_sizes) THEN v_raw_sizes := v_raw_sizes || ARRAY['1','1 to 10','2 to 10']; END IF;
  IF '11-25' = ANY(v_sizes) THEN v_raw_sizes := v_raw_sizes || ARRAY['11 to 25','11 to 50']; END IF;
  IF '26-50' = ANY(v_sizes) THEN v_raw_sizes := v_raw_sizes || ARRAY['26 to 50']; END IF;
  IF '51-100' = ANY(v_sizes) THEN v_raw_sizes := v_raw_sizes || ARRAY['51 to 100','51 to 200']; END IF;
  IF '101-250' = ANY(v_sizes) THEN v_raw_sizes := v_raw_sizes || ARRAY['101 to 250']; END IF;
  IF '251-500' = ANY(v_sizes) THEN v_raw_sizes := v_raw_sizes || ARRAY['251 to 500','201 to 500']; END IF;
  IF '501-1000' = ANY(v_sizes) THEN v_raw_sizes := v_raw_sizes || ARRAY['501 to 1000','501 to 1,000']; END IF;
  IF '1001-5000' = ANY(v_sizes) THEN v_raw_sizes := v_raw_sizes || ARRAY['1001 to 5000','1,001 to 5,000']; END IF;
  IF '5000+' = ANY(v_sizes) THEN v_raw_sizes := v_raw_sizes || ARRAY['5001 to 10000','5,001 to 10,000','10000+','10001+','10,001+']; END IF;
  v_raw_sizes := coalesce((SELECT array_agg(DISTINCT s) FROM unnest(v_raw_sizes) AS s), '{}'::text[]);

  SELECT count(*)::integer INTO v_total_count
  FROM public.leads l
  WHERE (l.imported_by IS NULL OR l.imported_by = p_user_id)
    AND (v_name = '' OR (
      (array_length(regexp_split_to_array(v_name, '\s+'), 1) >= 2 AND (l.first_name ILIKE '%' || split_part(v_name, ' ', 1) || '%' OR l.last_name ILIKE '%' || split_part(v_name, ' ', 1) || '%') AND (l.first_name ILIKE '%' || substring(v_name from position(' ' in v_name) + 1) || '%' OR l.last_name ILIKE '%' || substring(v_name from position(' ' in v_name) + 1) || '%'))
      OR (array_length(regexp_split_to_array(v_name, '\s+'), 1) < 2 AND (l.first_name ILIKE '%' || v_name || '%' OR l.last_name ILIKE '%' || v_name || '%'))
    ))
    AND (cardinality(v_titles) = 0 OR EXISTS (SELECT 1 FROM unnest(v_titles) t WHERE l.title ILIKE '%' || t || '%'))
    AND (v_company = '' OR l.org_name ILIKE '%' || v_company || '%')
    AND (v_industry = '' OR l.org_industry ILIKE '%' || v_industry || '%')
    AND (cardinality(v_locations) = 0 OR EXISTS (SELECT 1 FROM unnest(v_locations) loc WHERE lower(coalesce(l.city,'')) LIKE '%' || lower(trim(loc)) || '%' OR lower(coalesce(l.state,'')) LIKE '%' || lower(trim(loc)) || '%' OR lower(coalesce(l.country,'')) LIKE '%' || lower(trim(loc)) || '%' OR (lower(trim(loc))='fl' AND (lower(coalesce(l.state,'')) LIKE '%florida%' OR lower(coalesce(l.state,''))='fl')) OR (lower(trim(loc))='florida' AND lower(coalesce(l.state,''))='fl')))
    AND (cardinality(v_raw_sizes) = 0 OR l.org_employee_count = ANY(v_raw_sizes))
    AND (NOT v_has_phone OR (l.phone IS NOT NULL AND l.phone <> ''))
    AND (NOT v_has_email OR (l.email IS NOT NULL AND l.email <> ''));

  WITH limited AS MATERIALIZED (
    SELECT l.id
    FROM public.leads l
    WHERE (l.imported_by IS NULL OR l.imported_by = p_user_id)
      AND (v_name = '' OR (
        (array_length(regexp_split_to_array(v_name, '\s+'), 1) >= 2 AND (l.first_name ILIKE '%' || split_part(v_name, ' ', 1) || '%' OR l.last_name ILIKE '%' || split_part(v_name, ' ', 1) || '%') AND (l.first_name ILIKE '%' || substring(v_name from position(' ' in v_name) + 1) || '%' OR l.last_name ILIKE '%' || substring(v_name from position(' ' in v_name) + 1) || '%'))
        OR (array_length(regexp_split_to_array(v_name, '\s+'), 1) < 2 AND (l.first_name ILIKE '%' || v_name || '%' OR l.last_name ILIKE '%' || v_name || '%'))
      ))
      AND (cardinality(v_titles) = 0 OR EXISTS (SELECT 1 FROM unnest(v_titles) t WHERE l.title ILIKE '%' || t || '%'))
      AND (v_company = '' OR l.org_name ILIKE '%' || v_company || '%')
      AND (v_industry = '' OR l.org_industry ILIKE '%' || v_industry || '%')
      AND (cardinality(v_locations) = 0 OR EXISTS (SELECT 1 FROM unnest(v_locations) loc WHERE lower(coalesce(l.city,'')) LIKE '%' || lower(trim(loc)) || '%' OR lower(coalesce(l.state,'')) LIKE '%' || lower(trim(loc)) || '%' OR lower(coalesce(l.country,'')) LIKE '%' || lower(trim(loc)) || '%' OR (lower(trim(loc))='fl' AND (lower(coalesce(l.state,'')) LIKE '%florida%' OR lower(coalesce(l.state,''))='fl')) OR (lower(trim(loc))='florida' AND lower(coalesce(l.state,''))='fl')))
      AND (cardinality(v_raw_sizes) = 0 OR l.org_employee_count = ANY(v_raw_sizes))
      AND (NOT v_has_phone OR (l.phone IS NOT NULL AND l.phone <> ''))
      AND (NOT v_has_email OR (l.email IS NOT NULL AND l.email <> ''))
    LIMIT v_limit
  )
  SELECT coalesce(array_agg(id), '{}'::text[]) INTO v_ids FROM limited;

  RETURN jsonb_build_object(
    'ids', coalesce(to_jsonb(v_ids), '[]'::jsonb),
    'totalCount', v_total_count,
    'capped', v_total_count > cardinality(v_ids)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.match_lead_ids_for_people_search(uuid, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_lead_ids_for_people_search(uuid, jsonb, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_lead_ids_for_people_search(uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_lead_ids_for_people_search(uuid, jsonb, integer) TO service_role;