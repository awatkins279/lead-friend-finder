
CREATE OR REPLACE FUNCTION public.us_state_to_abbr(s text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE lower(coalesce(s,''))
    WHEN 'alabama' THEN 'al' WHEN 'alaska' THEN 'ak' WHEN 'arizona' THEN 'az'
    WHEN 'arkansas' THEN 'ar' WHEN 'california' THEN 'ca' WHEN 'colorado' THEN 'co'
    WHEN 'connecticut' THEN 'ct' WHEN 'delaware' THEN 'de' WHEN 'florida' THEN 'fl'
    WHEN 'georgia' THEN 'ga' WHEN 'hawaii' THEN 'hi' WHEN 'idaho' THEN 'id'
    WHEN 'illinois' THEN 'il' WHEN 'indiana' THEN 'in' WHEN 'iowa' THEN 'ia'
    WHEN 'kansas' THEN 'ks' WHEN 'kentucky' THEN 'ky' WHEN 'louisiana' THEN 'la'
    WHEN 'maine' THEN 'me' WHEN 'maryland' THEN 'md' WHEN 'massachusetts' THEN 'ma'
    WHEN 'michigan' THEN 'mi' WHEN 'minnesota' THEN 'mn' WHEN 'mississippi' THEN 'ms'
    WHEN 'missouri' THEN 'mo' WHEN 'montana' THEN 'mt' WHEN 'nebraska' THEN 'ne'
    WHEN 'nevada' THEN 'nv' WHEN 'new hampshire' THEN 'nh' WHEN 'new jersey' THEN 'nj'
    WHEN 'new mexico' THEN 'nm' WHEN 'new york' THEN 'ny' WHEN 'north carolina' THEN 'nc'
    WHEN 'north dakota' THEN 'nd' WHEN 'ohio' THEN 'oh' WHEN 'oklahoma' THEN 'ok'
    WHEN 'oregon' THEN 'or' WHEN 'pennsylvania' THEN 'pa' WHEN 'rhode island' THEN 'ri'
    WHEN 'south carolina' THEN 'sc' WHEN 'south dakota' THEN 'sd' WHEN 'tennessee' THEN 'tn'
    WHEN 'texas' THEN 'tx' WHEN 'utah' THEN 'ut' WHEN 'vermont' THEN 'vt'
    WHEN 'virginia' THEN 'va' WHEN 'washington' THEN 'wa' WHEN 'west virginia' THEN 'wv'
    WHEN 'wisconsin' THEN 'wi' WHEN 'wyoming' THEN 'wy' WHEN 'district of columbia' THEN 'dc'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.us_abbr_to_state(s text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE lower(coalesce(s,''))
    WHEN 'al' THEN 'alabama' WHEN 'ak' THEN 'alaska' WHEN 'az' THEN 'arizona'
    WHEN 'ar' THEN 'arkansas' WHEN 'ca' THEN 'california' WHEN 'co' THEN 'colorado'
    WHEN 'ct' THEN 'connecticut' WHEN 'de' THEN 'delaware' WHEN 'fl' THEN 'florida'
    WHEN 'ga' THEN 'georgia' WHEN 'hi' THEN 'hawaii' WHEN 'id' THEN 'idaho'
    WHEN 'il' THEN 'illinois' WHEN 'in' THEN 'indiana' WHEN 'ia' THEN 'iowa'
    WHEN 'ks' THEN 'kansas' WHEN 'ky' THEN 'kentucky' WHEN 'la' THEN 'louisiana'
    WHEN 'me' THEN 'maine' WHEN 'md' THEN 'maryland' WHEN 'ma' THEN 'massachusetts'
    WHEN 'mi' THEN 'michigan' WHEN 'mn' THEN 'minnesota' WHEN 'ms' THEN 'mississippi'
    WHEN 'mo' THEN 'missouri' WHEN 'mt' THEN 'montana' WHEN 'ne' THEN 'nebraska'
    WHEN 'nv' THEN 'nevada' WHEN 'nh' THEN 'new hampshire' WHEN 'nj' THEN 'new jersey'
    WHEN 'nm' THEN 'new mexico' WHEN 'ny' THEN 'new york' WHEN 'nc' THEN 'north carolina'
    WHEN 'nd' THEN 'north dakota' WHEN 'oh' THEN 'ohio' WHEN 'ok' THEN 'oklahoma'
    WHEN 'or' THEN 'oregon' WHEN 'pa' THEN 'pennsylvania' WHEN 'ri' THEN 'rhode island'
    WHEN 'sc' THEN 'south carolina' WHEN 'sd' THEN 'south dakota' WHEN 'tn' THEN 'tennessee'
    WHEN 'tx' THEN 'texas' WHEN 'ut' THEN 'utah' WHEN 'vt' THEN 'vermont'
    WHEN 'va' THEN 'virginia' WHEN 'wa' THEN 'washington' WHEN 'wv' THEN 'west virginia'
    WHEN 'wi' THEN 'wisconsin' WHEN 'wy' THEN 'wyoming' WHEN 'dc' THEN 'district of columbia'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.build_location_tokens(p_city text, p_state text, p_country text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(
    (SELECT array_agg(DISTINCT t)
     FROM unnest(ARRAY[
       nullif(lower(trim(coalesce(p_city,''))), ''),
       nullif(lower(trim(coalesce(p_country,''))), ''),
       nullif(lower(trim(coalesce(p_state,''))), ''),
       public.us_state_to_abbr(p_state),
       public.us_abbr_to_state(p_state)
     ]) AS t WHERE t IS NOT NULL),
    '{}'::text[]
  )
$$;
