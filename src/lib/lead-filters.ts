import { z } from "zod";

// ---------------------------------------------------------------------------
// Single source of truth for People-Search lead filtering.
// Used by BOTH the in-app list (app.people.tsx) and the bulk "select all
// matching" server function (leads-bulk.functions.ts) so they never drift.
// ---------------------------------------------------------------------------

export type LeadFilters = {
  name: string;
  titles: string[];
  company: string;
  locations: string[];
  industry: string;
  companySize: string[];
  hasPhone: boolean;
  hasEmail: boolean;
};

export const LEAD_FILTERS_SCHEMA = z.object({
  name: z.string().max(200).optional().default(""),
  titles: z.array(z.string().max(200)).max(50).optional().default([]),
  company: z.string().max(200).optional().default(""),
  industry: z.string().max(200).optional().default(""),
  // Accept either the new `locations` array or a legacy single `location` string.
  locations: z.array(z.string().max(200)).max(50).optional().default([]),
  location: z.string().max(200).optional(),
  companySize: z.array(z.string().max(50)).max(20).optional().default([]),
  hasPhone: z.boolean().optional().default(false),
  hasEmail: z.boolean().optional().default(false),
});

export const SIZE_BUCKETS: Record<string, string[]> = {
  "1-10": ["1", "1 to 10", "2 to 10"],
  "11-25": ["11 to 25", "11 to 50"],
  "26-50": ["26 to 50", "11 to 50"],
  "51-100": ["51 to 100", "51 to 200"],
  "101-250": ["101 to 250", "51 to 200", "201 to 500"],
  "251-500": ["251 to 500", "201 to 500"],
  "501-1000": ["501 to 1000", "501 to 1,000"],
  "1001-2500": ["1001 to 5000", "1,001 to 5,000"],
  "2501-5000": ["1001 to 5000", "1,001 to 5,000"],
  "5000+": ["5001 to 10000", "5,001 to 10,000", "10000+", "10001+", "10,001+"],
};

export function escapeForOr(v: string): string {
  // PostgREST .or() uses commas/parens as syntax; escape them in user input.
  return v.replace(/,/g, "\\,").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// Full US state name -> 2-letter abbreviation (+ DC).
const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
const STATE_ABBR_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAME_TO_ABBR).map(([name, abbr]) => [abbr.toLowerCase(), name]),
);

// Build the PostgREST OR conditions for one location term — robust to states
// being stored as EITHER full names ("Florida") or abbreviations ("FL").
function locationConditions(term: string): string[] {
  const l = term.trim().toLowerCase();
  if (!l) return [];
  const out: string[] = [];

  if (STATE_NAME_TO_ABBR[l]) {
    // Full state name typed → match full name OR its abbreviation in `state`.
    const abbr = STATE_NAME_TO_ABBR[l].toLowerCase();
    out.push(`state.ilike.%${escapeForOr(l)}%`);
    out.push(`state.ilike.${escapeForOr(abbr)}`); // exact "FL"
    out.push(`city.ilike.%${escapeForOr(l)}%`);
    out.push(`country.ilike.%${escapeForOr(l)}%`);
  } else if (l.length === 2 && STATE_ABBR_TO_NAME[l]) {
    // Abbreviation typed → match the abbreviation OR the full name in `state`.
    const name = STATE_ABBR_TO_NAME[l];
    out.push(`state.ilike.${escapeForOr(l)}`); // exact "FL"
    out.push(`state.ilike.%${escapeForOr(name)}%`);
    // Don't broad-match city/country on a 2-letter token (false positives).
  } else {
    // Not a US state — treat as a free city/state/country contains-match.
    out.push(`city.ilike.%${escapeForOr(l)}%`);
    out.push(`state.ilike.%${escapeForOr(l)}%`);
    out.push(`country.ilike.%${escapeForOr(l)}%`);
  }
  return out;
}

export function locationOrExpr(locations: string[]): string | null {
  const terms = (locations ?? []).map((l) => l.trim()).filter(Boolean);
  if (!terms.length) return null;
  const expr = terms.flatMap(locationConditions).join(",");
  return expr || null;
}

// Apply all People-Search filters to a Supabase query (leads table). Untyped on
// purpose — the Supabase query builder is chained dynamically.
export function buildLeadQuery(q: any, f: Partial<LeadFilters> & { location?: string }): any {
  let r: any = q;

  const nameQ = (f.name ?? "").trim();
  if (nameQ) {
    const parts = nameQ.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const first = escapeForOr(parts[0]);
      const last = escapeForOr(parts.slice(1).join(" "));
      r = r
        .or(`first_name.ilike.%${first}%,last_name.ilike.%${first}%`)
        .or(`first_name.ilike.%${last}%,last_name.ilike.%${last}%`);
    } else {
      const t = escapeForOr(nameQ);
      r = r.or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%`);
    }
  }

  const titles = (f.titles ?? []).map((t) => t.trim()).filter(Boolean);
  if (titles.length === 1) {
    r = r.ilike("title", `%${titles[0]}%`);
  } else if (titles.length > 1) {
    r = r.or(titles.map((t) => `title.ilike.%${escapeForOr(t)}%`).join(","));
  }

  if ((f.company ?? "").trim()) r = r.ilike("org_name", `%${(f.company ?? "").trim()}%`);
  if ((f.industry ?? "").trim()) r = r.ilike("org_industry", `%${(f.industry ?? "").trim()}%`);

  // Locations: accept the array, plus a legacy single `location` string.
  const locs = [...(f.locations ?? []), ...(f.location ? [f.location] : [])];
  const locExpr = locationOrExpr(locs);
  if (locExpr) r = r.or(locExpr);

  const sizes = f.companySize ?? [];
  if (sizes.length > 0) {
    const raw = Array.from(new Set(sizes.flatMap((s) => SIZE_BUCKETS[s] ?? [])));
    if (raw.length > 0) r = r.in("org_employee_count", raw);
  }

  if (f.hasPhone) r = r.not("phone", "is", null).neq("phone", "");
  if (f.hasEmail) r = r.not("email", "is", null).neq("email", "");

  return r;
}
