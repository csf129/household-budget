import { CategoriesManager } from "@/components/categories-manager";
import { mapCategoryRowFromSupabase } from "@/lib/category-display";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import type { CategoryRow, PrimaryCategoryGroupRow } from "@/types/finance";

export default async function SettingsCategoriesPage() {
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

  const { data: primaryData, error: primaryError } = await supabase
    .from("primary_category_groups")
    .select("id, name, slug, color, sort_order")
    .eq("household_id", household.householdId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error || primaryError) {
    const errMsg = error?.message || primaryError?.message || "";
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          Could not load categories: {errMsg}
        </p>
        {errMsg.toLowerCase().includes("primary_category_groups") ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Run the migration{" "}
            <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">
              20260409180000_primary_category_groups.sql
            </code>{" "}
            in the Supabase SQL Editor.
          </p>
        ) : null}
      </div>
    );
  }

  const rows: CategoryRow[] = (data ?? []).map((c) =>
    mapCategoryRowFromSupabase(c),
  );

  const primaryRows: PrimaryCategoryGroupRow[] = (primaryData ?? []).map(
    (g) => ({
      id: String(g.id),
      name: String(g.name ?? ""),
      slug: String(g.slug ?? ""),
      color: g.color != null ? String(g.color) : null,
      sort_order: Number(g.sort_order ?? 0),
    }),
  );

  return (
    <div className="space-y-4">
      {ensureError ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          Default categories could not be synced: {ensureError.message}.
        </p>
      ) : null}
      <CategoriesManager
        householdId={household.householdId}
        initialCategories={rows}
        initialPrimaryGroups={primaryRows}
        embedded
      />
    </div>
  );
}
