import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_AI_MODEL_ID } from "@/lib/ai-models";

export async function getHouseholdAiModel(
  supabase: SupabaseClient,
  householdId: string,
): Promise<string> {
  const { data } = await supabase
    .from("ai_settings")
    .select("model_id")
    .eq("household_id", householdId)
    .maybeSingle();
  return data?.model_id ?? DEFAULT_AI_MODEL_ID;
}
