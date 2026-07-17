import { TransactionsManager } from "@/components/transactions-manager";
import {
  categoryRulesFromDb,
  resolveCategoryFromRules,
} from "@/lib/apply-category-rules";
import type { IncomeRuleRow } from "@/lib/apply-income-rules";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import { fetchAllHouseholdPlaidFeedRows } from "@/lib/fetch-household-plaid-feed";
import {
  fetchAllHouseholdTransactions,
  fetchArchivedHouseholdTransactions,
} from "@/lib/fetch-household-transactions";
import { ledgerArchiveColumnExists } from "@/lib/ledger-archive-schema";
import { hideSupersededPendingPlaidFeedRows } from "@/lib/plaid-feed-hide-superseded-pending";
import {
  mapPlaidTransactionFeedRow,
} from "@/lib/map-plaid-transaction-feed";
import { mapTransactionRow } from "@/lib/map-transaction";
import { mapCategoryRowFromSupabase } from "@/lib/category-display";
import { fetchSavingsPlansWithProgress } from "@/lib/fetch-savings-plans";
import type { AccountRow, CategoryRow, TransactionRow } from "@/types/finance";

export default async function TransactionsPage() {
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

  const { data: incomeRulesRaw } = await supabase
    .from("income_classification_rules")
    .select("match_type, pattern, priority, treatment, amount_sign")
    .eq("household_id", household.householdId)
    .order("priority", { ascending: false });

  const incomeRules: IncomeRuleRow[] = (incomeRulesRaw ?? []).map((r) => ({
    match_type: r.match_type as IncomeRuleRow["match_type"],
    pattern: String(r.pattern ?? ""),
    priority: Number(r.priority ?? 0),
    treatment: r.treatment as IncomeRuleRow["treatment"],
    amount_sign: (r.amount_sign as IncomeRuleRow["amount_sign"]) ?? "any",
  }));

  const ledgerArchiveColumn = await ledgerArchiveColumnExists(supabase);

  const { rows: plans } = await fetchSavingsPlansWithProgress(supabase, household.householdId, {
    includeArchived: false,
  });

  const { data: transactions, error: txError } =
    await fetchAllHouseholdTransactions(supabase, household.householdId, {
      ledgerArchiveColumn,
    });

  const { data: archivedRaw, error: archivedErr } =
    await fetchArchivedHouseholdTransactions(supabase, household.householdId, {
      ledgerArchiveColumn,
    });

  const { data: plaidFeed, error: feedError } =
    await fetchAllHouseholdPlaidFeedRows(supabase, household.householdId);

  const { data: accountsRaw, error: accError } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("household_id", household.householdId)
    .order("name", { ascending: true });

  const { data: categoryRulesRaw, error: rulesError } = await supabase
    .from("category_rules")
    .select("category_id, match_type, pattern, priority, amount_sign")
    .eq("household_id", household.householdId);

  if (catError || txError || archivedErr || accError || feedError || rulesError) {
    const msg =
      catError?.message ||
      txError?.message ||
      archivedErr?.message ||
      accError?.message ||
      feedError?.message ||
      rulesError?.message;
    return (
      <p className="text-sm text-red-600" role="alert">
        Could not load data: {msg}
      </p>
    );
  }

  const ledgerRows = (transactions ?? []).map(mapTransactionRow);
  const archivedLedgerRows = (archivedRaw ?? []).map(mapTransactionRow);
  const plaidLabelById = new Map<string, string | null>(
    (plaidFeed ?? []).map((p) => [
      String(p.plaid_transaction_id),
      mapPlaidTransactionFeedRow(p).account_name ?? null,
    ]),
  );
  const ledgerRowsWithPlaidAccount = ledgerRows.map((r) => {
    if (!r.plaid_transaction_id) return r;
    const label = plaidLabelById.get(r.plaid_transaction_id) ?? null;
    if (!label) return r;
    return { ...r, account_name: label };
  });
  const mirroredPlaidIds = new Set(
    ledgerRowsWithPlaidAccount
      .map((r) => r.plaid_transaction_id)
      .filter((x): x is string => Boolean(x)),
  );
  const engineCategoryRules = categoryRulesFromDb(
    (categoryRulesRaw ?? []) as Record<string, unknown>[],
  );

  const categoryRows: CategoryRow[] = (categories ?? []).map((c) =>
    mapCategoryRowFromSupabase(c),
  );

  const categoryById = new Map(categoryRows.map((c) => [c.id, c] as const));

  const feedRows = hideSupersededPendingPlaidFeedRows(
    (plaidFeed ?? [])
      .filter((p) => !mirroredPlaidIds.has(p.plaid_transaction_id))
      .map(mapPlaidTransactionFeedRow)
      .map((row) => {
        if (!row.plaid_feed_only) return row;
        const cid = resolveCategoryFromRules(
          row.normalized_description,
          row.amount,
          engineCategoryRules,
        );
        if (!cid) return row;
        const cat = categoryById.get(cid);
        if (!cat) return row;
        return {
          ...row,
          category_id: cid,
          categories: {
            name: cat.name,
            color: cat.color,
            primary_group: null,
          },
        };
      }),
    ledgerRowsWithPlaidAccount,
  );

  const initialTransactions: TransactionRow[] = [
    ...ledgerRowsWithPlaidAccount,
    ...feedRows,
  ].sort(
    (a, b) => {
      const byDate = b.occurred_on.localeCompare(a.occurred_on);
      if (byDate !== 0) return byDate;
      return b.id.localeCompare(a.id);
    },
  );

  const accountRows: AccountRow[] = (accountsRaw ?? []).map((a) => ({
    id: String(a.id),
    name: String(a.name ?? ""),
  }));

  const defaultAccountId =
    accountRows.length === 1 ? accountRows[0]!.id : null;

  return (
    <TransactionsManager
      householdId={household.householdId}
      userId={user.id}
      categories={categoryRows}
      incomeRules={incomeRules}
      initialTransactions={initialTransactions}
      initialArchivedTransactions={archivedLedgerRows}
      accounts={accountRows}
      defaultAccountId={defaultAccountId}
      ledgerArchiveColumnAvailable={ledgerArchiveColumn}
      plans={plans}
    />
  );
}
