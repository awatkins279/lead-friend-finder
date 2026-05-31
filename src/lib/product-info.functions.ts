import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProductInfo = {
  company_name: string | null;
  product_name: string | null;
  product_description: string | null;
  product_value_props: string | null;
  ideal_customer: string | null;
  common_objections: string | null;
  proof_points: string | null;
  pricing_notes: string | null;
  competitors: string | null;
  call_to_action: string | null;
};

const FIELDS = [
  "company_name",
  "product_name",
  "product_description",
  "product_value_props",
  "ideal_customer",
  "common_objections",
  "proof_points",
  "pricing_notes",
  "competitors",
  "call_to_action",
] as const;

export const getProductInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ info: ProductInfo }> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select(FIELDS.join(","))
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const info = {} as ProductInfo;
    for (const f of FIELDS) (info as any)[f] = (data as any)?.[f] ?? null;
    return { info };
  });

const saveSchema = z.object({
  company_name: z.string().max(200).nullish(),
  product_name: z.string().max(200).nullish(),
  product_description: z.string().max(4000).nullish(),
  product_value_props: z.string().max(4000).nullish(),
  ideal_customer: z.string().max(2000).nullish(),
  common_objections: z.string().max(4000).nullish(),
  proof_points: z.string().max(4000).nullish(),
  pricing_notes: z.string().max(2000).nullish(),
  competitors: z.string().max(2000).nullish(),
  call_to_action: z.string().max(500).nullish(),
});

export const saveProductInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => saveSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, string | null> = {};
    for (const f of FIELDS) patch[f] = ((data as any)[f] ?? null) || null;
    const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
