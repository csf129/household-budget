import type { SupabaseClient } from "@supabase/supabase-js";
import { expectedSavedByDate } from "@/lib/savings-plan-math";
import { mapSavingsPlan } from "@/lib/map-savings-plan";
import type { SavingsPlanWithProgress } from "@/types/finance";

export async function fetchSavingsPlansWithProgress(
  supabase: SupabaseClient,
  householdId: string,
  options?: { includeArchived?: boolean },
): Promise<{ rows: SavingsPlanWithProgress[]; error: string | null }> {
  let plansQuery = supabase
    .from("savings_plans")
    .select("*")
    .eq("household_id", householdId)
    .order("target_date", { ascending: true });

  if (!options?.includeArchived) {
    plansQuery = plansQuery.eq("is_archived", false);
  }

  const { data: plansRaw, error: plansErr } = await plansQuery;

  if (plansErr) {
    return { rows: [], error: plansErr.message };
  }

  const { data: contribRaw, error: contribErr } = await supabase
    .from("savings_plan_contributions")
    .select("savings_plan_id, amount")
    .eq("household_id", householdId);

  if (contribErr) {
    return { rows: [], error: contribErr.message };
  }

  const savedByPlan = new Map<string, number>();
  for (const row of contribRaw ?? []) {
    const pid = String((row as { savings_plan_id: string }).savings_plan_id);
    const a = (row as { amount: string | number }).amount;
    const n =
      typeof a === "string" ? Number.parseFloat(a) : Number(a);
    if (!Number.isFinite(n)) continue;
    savedByPlan.set(pid, (savedByPlan.get(pid) ?? 0) + n);
  }

  const asOf = new Date();
  const rows: SavingsPlanWithProgress[] = (plansRaw ?? []).map((raw) => {
    const plan = mapSavingsPlan(raw);
    const total_saved = savedByPlan.get(plan.id) ?? 0;
    const expected_by_today = expectedSavedByDate(
      plan.target_amount,
      plan.start_date,
      plan.target_date,
      plan.increment_amount,
      plan.increment_period,
      asOf,
    );
    return { ...plan, total_saved, expected_by_today };
  });

  return { rows, error: null };
}
