import { BudgetSettingsPanel } from "@/components/budget-settings-panel";
import { mapCategoryRowFromSupabase } from "@/lib/category-display";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import type { CategoryRow } from "@/types/finance";

export default async function SettingsBudgetPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return null;

  const { error: ensureError } = await supabase.rpc(
    "ensure_default_categories_for_my_household",
  );

  const { data, error } = await supabase
    .from("categories")
    .select(
      "id, name, color, sort_order, description, primary_group_id, monthly_budget, parent_category_id, budget_repeats_annually, budget_active_from_month, budget_active_from_day, budget_active_to_month, budget_active_to_day, budget_period_start, budget_period_end, budget_amount_period, budget_annual_payment_month, budget_recurring_payment, budget_recurring_interval",
    )
    .eq("household_id", household.householdId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const { data: refRow, error: refErr } = await supabase
    .from("household_budget_reference")
    .select("source_filename, line_items, last_ai_summary")
    .eq("household_id", household.householdId)
    .maybeSingle();

  if (error) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        Could not load categories: {error.message}
      </p>
    );
  }

  if (refErr) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        Could not load budget reference: {refErr.message}
      </p>
    );
  }

  const rows: CategoryRow[] = (data ?? []).map((c) =>
    mapCategoryRowFromSupabase(c),
  );

  const lineItems = refRow?.line_items;
  const lineCount = Array.isArray(lineItems) ? lineItems.length : 0;

  const initialReference =
    lineCount > 0 || refRow?.last_ai_summary
      ? {
          sourceFilename:
            refRow?.source_filename != null
              ? String(refRow.source_filename)
              : null,
          lineCount,
          lastAiSummary:
            refRow?.last_ai_summary != null
              ? String(refRow.last_ai_summary)
              : null,
        }
      : null;

  return (
    <div className="space-y-4">
      {ensureError ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          Default categories could not be synced: {ensureError.message}.
        </p>
      ) : null}
      <BudgetSettingsPanel
        initialCategories={rows}
        initialReference={initialReference}
      />
    </div>
  );
}
