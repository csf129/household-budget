import { CategoryRulesManager } from "@/components/category-rules-manager";
import { mapCategoryRowFromSupabase } from "@/lib/category-display";
import { IncomeRulesManager } from "@/components/income-rules-manager";
import { createClient } from "@/lib/supabase/server";
import { fetchAllHouseholdTransactions } from "@/lib/fetch-household-transactions";
import { getHouseholdForUser } from "@/lib/household";
import { ledgerArchiveColumnExists } from "@/lib/ledger-archive-schema";
import {
  CATEGORY_RULE_CATEGORIES_EMBED,
  mapCategoryRuleRow,
} from "@/lib/map-category-rule";
import { mapIncomeRuleRow } from "@/lib/map-income-rule";
import { mapTransactionRow } from "@/lib/map-transaction";
import type { CategoryRow, CategoryRuleView, IncomeRuleView, TransactionRow } from "@/types/finance";

export default async function SettingsRulesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return null;

  await supabase.rpc("ensure_default_categories_for_my_household");

  const { data: categories, error: catError } = await supabase
    .from("categories")
    .select(
      "id, name, color, sort_order, description, primary_group_id, monthly_budget, parent_category_id, budget_repeats_annually, budget_active_from_month, budget_active_from_day, budget_active_to_month, budget_active_to_day, budget_period_start, budget_period_end, budget_amount_period, budget_annual_payment_month, budget_recurring_payment, budget_recurring_interval",
    )
    .eq("household_id", household.householdId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const { data: categoryRulesRaw, error: categoryRulesError } = await supabase
    .from("category_rules")
    .select(
      `
      id,
      category_id,
      match_type,
      pattern,
      priority,
      amount_sign,
      ${CATEGORY_RULE_CATEGORIES_EMBED}
    `,
    )
    .eq("household_id", household.householdId)
    .order("priority", { ascending: false });

  const { data: incomeRulesRaw, error: incomeRulesError } = await supabase
    .from("income_classification_rules")
    .select("id, match_type, pattern, priority, treatment, amount_sign")
    .eq("household_id", household.householdId)
    .order("priority", { ascending: false });

  const ledgerArchiveColumn = await ledgerArchiveColumnExists(supabase);

  const { data: transactionsRaw, error: txError } =
    await fetchAllHouseholdTransactions(supabase, household.householdId, {
      ledgerArchiveColumn,
    });

  if (catError || categoryRulesError || incomeRulesError || txError) {
    const msg =
      catError?.message ||
      categoryRulesError?.message ||
      incomeRulesError?.message ||
      txError?.message;
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        Could not load rules: {msg}
      </p>
    );
  }

  const categoryRows: CategoryRow[] = (categories ?? []).map((c) =>
    mapCategoryRowFromSupabase(c),
  );

  const categoryRules: CategoryRuleView[] = (categoryRulesRaw ?? []).map((r) =>
    mapCategoryRuleRow(r),
  );

  const incomeRules: IncomeRuleView[] = (incomeRulesRaw ?? []).map((r) =>
    mapIncomeRuleRow(r),
  );

  const initialTransactions: TransactionRow[] = (transactionsRaw ?? []).map(
    mapTransactionRow,
  );

  return (
    <div className="space-y-16">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Jump to:{" "}
        <a
          href="#category-rules"
          className="font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400"
        >
          Category rules
        </a>{" "}
        ·{" "}
        <a
          href="#income-rules"
          className="font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400"
        >
          Income
        </a>
      </p>

      <CategoryRulesManager
        householdId={household.householdId}
        categories={categoryRows}
        initialRules={categoryRules}
        embedded
      />

      <div className="border-t border-zinc-200 pt-12 dark:border-zinc-800">
        <IncomeRulesManager
          householdId={household.householdId}
          initialRules={incomeRules}
          categories={categoryRows}
          initialTransactions={initialTransactions}
          embedded
          ledgerArchiveColumnAvailable={ledgerArchiveColumn}
        />
      </div>
    </div>
  );
}
