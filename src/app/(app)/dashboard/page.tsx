import { DashboardOverviewCharts } from "@/components/dashboard-overview-charts";
import { DashboardPlansSummary } from "@/components/dashboard-plans-summary";
import { HouseholdInvitePanel } from "@/components/household-invite-panel";
import {
  categoryRulesFromDb,
  resolveCategoryFromRules,
} from "@/lib/apply-category-rules";
import type { IncomeRuleRow } from "@/lib/apply-income-rules";
import { fetchAllHouseholdPlaidFeedRows } from "@/lib/fetch-household-plaid-feed";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser, isHead } from "@/lib/household";
import { getViewContext } from "@/lib/view-as";
import {
  buildSavingsProjection,
  type ProjectionLine,
} from "@/lib/savings-plan-projection";
import { fetchSavingsPlansWithProgress } from "@/lib/fetch-savings-plans";
import { addCalendarMonths } from "@/lib/savings-plan-schedule";
import { attachPrimaryGroupsFromCategoryCatalog } from "@/lib/attach-primary-group-to-transactions";
import { mapCategoryRowFromSupabase } from "@/lib/category-display";
import { fetchAllHouseholdTransactions } from "@/lib/fetch-household-transactions";
import { hideSupersededPendingPlaidFeedRows } from "@/lib/plaid-feed-hide-superseded-pending";
import { mapPlaidTransactionFeedRow } from "@/lib/map-plaid-transaction-feed";
import { mapTransactionRow } from "@/lib/map-transaction";
import type {
  CategoryRow,
  PrimaryCategoryGroupRow,
  TransactionRow,
} from "@/types/finance";

function overviewBankAccountLabel(a: {
  name: string;
  display_name?: string | null;
  mask?: string | null;
}): string {
  const d = a.display_name?.trim();
  const base = (d || String(a.name ?? "").trim() || "Account").trim();
  const m = a.mask?.trim();
  return m ? `${base} ·•••${m}` : base;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return null;

  const view = await getViewContext(supabase, household.role);

  await supabase.rpc("ensure_default_categories_for_my_household");

  const { data: categories, error: catError } = await supabase
    .from("categories")
    .select(
      "id, name, color, sort_order, description, primary_group_id, monthly_budget, parent_category_id, budget_repeats_annually, budget_active_from_month, budget_active_from_day, budget_active_to_month, budget_active_to_day, budget_period_start, budget_period_end, budget_amount_period, budget_annual_payment_month, budget_recurring_payment, budget_recurring_interval",
    )
    .eq("household_id", household.householdId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const { data: primaryGroupsRaw, error: pgError } = await supabase
    .from("primary_category_groups")
    .select("id, name, slug, color, sort_order")
    .eq("household_id", household.householdId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const { data: incomeRulesRaw } = await supabase
    .from("income_classification_rules")
    .select("match_type, pattern, priority, treatment, amount_sign")
    .eq("household_id", household.householdId)
    .order("priority", { ascending: false });
  const { data: categoryRulesRaw } = await supabase
    .from("category_rules")
    .select("category_id, match_type, pattern, priority, amount_sign")
    .eq("household_id", household.householdId);

  const incomeRules: IncomeRuleRow[] = (incomeRulesRaw ?? []).map((r) => ({
    match_type: r.match_type as IncomeRuleRow["match_type"],
    pattern: String(r.pattern ?? ""),
    priority: Number(r.priority ?? 0),
    treatment: r.treatment as IncomeRuleRow["treatment"],
    amount_sign: (r.amount_sign as IncomeRuleRow["amount_sign"]) ?? "any",
  }));

  const { data: transactions, error: txError } =
    await fetchAllHouseholdTransactions(supabase, household.householdId);
  const { data: plaidFeed, error: feedError } =
    await fetchAllHouseholdPlaidFeedRows(supabase, household.householdId);

  const { data: bankAccountsRaw } = await supabase
    .from("bank_accounts")
    .select("id, name, display_name, mask")
    .eq("household_id", household.householdId)
    .order("name", { ascending: true });

  let initialTransactions: TransactionRow[] = [];
  if (catError || txError || pgError || feedError) {
    const msg = String(
      catError?.message ||
        txError?.message ||
        pgError?.message ||
        feedError?.message ||
        "",
    );
    return (
      <div className="space-y-2" role="alert">
        <p className="text-sm text-red-600 dark:text-red-400">Could not load data: {msg}</p>
        {msg.toLowerCase().includes("primary_category_groups") ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Run{" "}
            <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800 dark:text-zinc-200">
              supabase/migrations/20260409180000_primary_category_groups.sql
            </code>{" "}
            in the Supabase SQL Editor, then reload.
          </p>
        ) : null}
      </div>
    );
  }

  const categoryRows: CategoryRow[] = (categories ?? []).map((c) =>
    mapCategoryRowFromSupabase(c),
  );

  const primaryGroupRows: PrimaryCategoryGroupRow[] = (
    primaryGroupsRaw ?? []
  ).map((g) => ({
    id: String(g.id),
    name: String(g.name ?? ""),
    slug: String(g.slug ?? ""),
    color: g.color != null ? String(g.color) : null,
    sort_order: Number(g.sort_order ?? 0),
  }));

  const ledgerRows = (transactions ?? []).map(mapTransactionRow);
  const mirroredPlaidIds = new Set(
    ledgerRows
      .map((r) => r.plaid_transaction_id)
      .filter((x): x is string => Boolean(x)),
  );
  const engineCategoryRules = categoryRulesFromDb(
    (categoryRulesRaw ?? []) as Record<string, unknown>[],
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
    ledgerRows,
  );

  initialTransactions = attachPrimaryGroupsFromCategoryCatalog(
    [...ledgerRows, ...feedRows],
    categoryRows,
    primaryGroupRows,
  );

  const overviewBankAccounts = (bankAccountsRaw ?? []).map((a) => ({
    id: String(a.id),
    name: overviewBankAccountLabel({
      name: String(a.name ?? ""),
      display_name: a.display_name,
      mask: a.mask,
    }),
  }));

  const { rows: savingsPlanSummaries, error: plansErr } =
    await fetchSavingsPlansWithProgress(supabase, household.householdId, {
      includeArchived: false,
    });

  let monthProjection: ProjectionLine[] | undefined;
  if (!plansErr) {
    const now = new Date();
    const projStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = addCalendarMonths(projStart, 5);
    const projEnd = new Date(
      lastMonthStart.getFullYear(),
      lastMonthStart.getMonth() + 1,
      0,
    );
    const lines = buildSavingsProjection(
      savingsPlanSummaries,
      "monthly",
      projStart,
      projEnd,
    );
    monthProjection = lines.length > 0 ? lines : undefined;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Overview
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Welcome to <span className="font-medium text-zinc-900 dark:text-zinc-100">{household.name}</span>.
        </p>
      </div>

      <DashboardOverviewCharts
        householdId={household.householdId}
        categories={categoryRows}
        primaryGroups={primaryGroupRows}
        transactions={initialTransactions}
        incomeRules={incomeRules}
        bankAccounts={overviewBankAccounts}
      />

      {plansErr ? (
        plansErr.toLowerCase().includes("savings_plans") ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100" role="status">
            <p className="font-medium text-amber-950 dark:text-amber-100">
              Plans &amp; savings
            </p>
            <p className="mt-1 text-amber-900 dark:text-amber-200/90">
              To show budgets and vacation targets on the overview, run{" "}
              <code className="rounded bg-amber-100/90 px-1 text-xs dark:bg-amber-950 dark:text-amber-100">
                supabase/migrations/20260411100000_savings_plans.sql
              </code>{" "}
              in the Supabase SQL Editor.
            </p>
          </section>
        ) : (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            Could not load savings plans: {plansErr}
          </p>
        )
      ) : (
        <DashboardPlansSummary
          plans={savingsPlanSummaries}
          monthProjection={monthProjection}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Next steps
          </h2>
          <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <li>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">Settings</span> —
              accounts, household name, theme, categories, and automation rules
            </li>
            <li>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">Transactions</span> —
              add expenses and income, import CSVs, optional category
            </li>
            <li>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">Plans</span> —
              savings goals for projects and trips: targets, timelines, and contributions
            </li>
          </ul>
        </section>

        {isHead(view.effectiveRole) ? (
          <HouseholdInvitePanel initialCode={household.inviteCode} />
        ) : (
          <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Your level</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              You&apos;re a family member, so you can use everything except
              settings. Ask a household head if you need an invite code for
              someone else or a change to your access.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
