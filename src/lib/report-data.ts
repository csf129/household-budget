import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CategoryRow,
  PrimaryCategoryGroupRow,
  TransactionRow,
} from "@/types/finance";
import type {
  ReportData,
  ReportMonth,
  ReportCreditCard,
  ReportFeedback,
  ReportTransaction,
  ReportTransactionsPayload,
} from "@/types/report";
import type { PeriodBucket } from "@/lib/dashboard-analytics";
import { fetchAllHouseholdTransactions } from "@/lib/fetch-household-transactions";
import { mapTransactionRow } from "@/lib/map-transaction";
import { formatCategoryLabel, mapCategoryRowFromSupabase } from "@/lib/category-display";
import { effectiveMonthlyBudgetForDateRange } from "@/lib/category-budget-season";
import { attachPrimaryGroupsFromCategoryCatalog } from "@/lib/attach-primary-group-to-transactions";
import {
  aggregateCategorySpendingInRange,
  categoryDisplayName,
  overviewIncomeContribution,
  transactionCountsAsOverviewPurchasesBar,
} from "@/lib/dashboard-analytics";
import { fetchCreditCards } from "@/lib/fetch-credit-cards";
import { fetchSavingsPlansWithProgress } from "@/lib/fetch-savings-plans";
import { buildCategorySeries } from "@/lib/report-series";

const pad2 = (n: number) => String(n).padStart(2, "0");

const CATEGORY_SELECT =
  "id,name,color,sort_order,description,primary_group_id,monthly_budget,parent_category_id,budget_repeats_annually,budget_active_from_month,budget_active_from_day,budget_active_to_month,budget_active_to_day,budget_period_start,budget_period_end,budget_amount_period,budget_annual_payment_month,budget_recurring_payment,budget_recurring_interval";

const MIN_MONTHS = 2;
const MAX_MONTHS = 12;
const DEFAULT_MONTHS = 6;

/**
 * Last `count` COMPLETE calendar months, oldest → newest. Excludes the
 * in-progress current month so month-over-month comparisons are not distorted
 * by a partial month.
 */
export function buildCompleteMonthBuckets(
  count: number,
  now: Date = new Date(),
): PeriodBucket[] {
  const buckets: PeriodBucket[] = [];
  for (let i = count; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const start = `${y}-${pad2(m)}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${pad2(m)}-${pad2(lastDay)}`;
    buckets.push({
      key: `${y}-${pad2(m)}`,
      label: new Date(y, m - 1, 1).toLocaleString("en-US", {
        month: "short",
        year: "numeric",
      }),
      start,
      end,
    });
  }
  return buckets;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Assemble the full household budget report: monthly income/spending/net,
 * per-category spend series with up/down trend signals, credit-card standing,
 * and savings-plan progress. Reuses the same categorization and overview
 * helpers the dashboard and email summary use, so numbers match the app.
 */
export async function assembleReportData(
  supabase: SupabaseClient,
  householdId: string,
  householdName: string,
  options?: { months?: number },
): Promise<ReportData> {
  const monthCount = Math.min(
    Math.max(Math.trunc(options?.months ?? DEFAULT_MONTHS), MIN_MONTHS),
    MAX_MONTHS,
  );
  const buckets = buildCompleteMonthBuckets(monthCount);

  // Categories + primary groups (needed to resolve display names and income/
  // spending classification).
  const [catResult, pgResult] = await Promise.all([
    supabase.from("categories").select(CATEGORY_SELECT).eq("household_id", householdId),
    supabase
      .from("primary_category_groups")
      .select("id,name,slug,color,sort_order")
      .eq("household_id", householdId),
  ]);

  const categoryRows: CategoryRow[] = (catResult.data ?? []).map((c) =>
    mapCategoryRowFromSupabase(c),
  );
  const primaryGroupRows: PrimaryCategoryGroupRow[] = (pgResult.data ?? []).map((g) => ({
    id: String(g.id),
    name: String(g.name ?? ""),
    slug: String(g.slug ?? ""),
    color: g.color != null ? String(g.color) : null,
    sort_order: Number(g.sort_order ?? 0),
  }));

  const { data: rawTxs } = await fetchAllHouseholdTransactions(supabase, householdId);
  const allTxs: TransactionRow[] = attachPrimaryGroupsFromCategoryCatalog(
    (rawTxs ?? []).map(mapTransactionRow),
    categoryRows,
    primaryGroupRows,
  );

  // Per-month income, spending, and category breakdown.
  const months: ReportMonth[] = [];
  const perBucketCat: Map<string, { amount: number; color: string }>[] = [];
  for (const b of buckets) {
    const inRange = allTxs.filter((t) => t.occurred_on >= b.start && t.occurred_on <= b.end);

    let income = 0;
    for (const t of inRange) income += overviewIncomeContribution(t);

    // "purchases_bills" matches the overview spending bar: excludes transfers,
    // credit-card payments, and income so we don't double-count money.
    const catMap = aggregateCategorySpendingInRange(inRange, b.start, b.end, "purchases_bills");
    let spending = 0;
    for (const v of catMap.values()) spending += v.amount;
    perBucketCat.push(catMap);

    months.push({
      key: b.key,
      label: b.label,
      start: b.start,
      end: b.end,
      income,
      spending,
      net: income - spending,
    });
  }

  const categoriesBase = buildCategorySeries(perBucketCat);
  // Attach each category's currently-set monthly budget (effective for the
  // latest complete month) by matching the series' display name to a category,
  // so the per-category plots can draw a budget reference line.
  const curBucket = buckets[buckets.length - 1];
  const catByLabel = new Map(
    categoryRows.map((cat) => [formatCategoryLabel(cat, categoryRows), cat] as const),
  );
  const categories = categoriesBase.map((s) => {
    const cat = catByLabel.get(s.name);
    const monthlyBudget =
      cat && curBucket
        ? effectiveMonthlyBudgetForDateRange(cat, curBucket.start, curBucket.end)
        : null;
    // A plain flat monthly budget (or no budget yet) can be edited inline;
    // seasonal / annual / weekly / recurring budgets are left to Settings.
    const budgetEditableInline =
      cat != null &&
      cat.budget_amount_period === "month" &&
      cat.budget_active_from_month == null &&
      cat.budget_period_start == null &&
      !cat.budget_recurring_payment;
    return {
      ...s,
      categoryId: cat?.id ?? null,
      monthlyBudget,
      budgetEditableInline,
    };
  });

  const last = months.length - 1;
  const priorMonths = last > 0 ? months.slice(0, last) : [];
  const totals = {
    income: months[last]?.income ?? 0,
    spending: months[last]?.spending ?? 0,
    net: months[last]?.net ?? 0,
    avgIncome: average(priorMonths.map((m) => m.income)),
    avgSpending: average(priorMonths.map((m) => m.spending)),
  };

  // Credit cards.
  const { rows: cards } = await fetchCreditCards(supabase, householdId);
  const creditCards: ReportCreditCard[] = cards.map((c) => {
    const balance = c.currentBalance;
    const available = c.availableBalance;
    const limit =
      balance != null && available != null ? balance + available : null;
    const utilization = limit != null && limit > 0 ? balance! / limit : null;
    return {
      name: c.name,
      mask: c.mask,
      balance,
      available,
      utilization,
      paymentDueDay: c.paymentDueDay,
      annualFee: c.annualFee,
      annualFeeMonth: c.annualFeeMonth,
      pointsProgram: c.pointsProgram,
      pointsBalance: c.pointsBalance,
      rewardSummary: c.rewardSummary,
      status: c.status,
    };
  });

  // Savings plans.
  const { rows: plans } = await fetchSavingsPlansWithProgress(supabase, householdId, {
    includeArchived: false,
  });
  const savingsPlans = plans.map((p) => ({
    title: p.title,
    kind: p.plan_kind,
    target: p.target_amount,
    saved: p.total_saved,
    expectedByToday: p.expected_by_today,
    targetDate: p.target_date,
    progress: p.target_amount > 0 ? p.total_saved / p.target_amount : 0,
    pace: p.total_saved - p.expected_by_today,
  }));

  // Household notes on the report, carried across regenerations so the AI
  // analysis respects the household's own constraints. Best-effort: a missing
  // table or read error must not break the whole report.
  const { data: feedbackRows } = await supabase
    .from("report_feedback")
    .select("category,note,updated_at")
    .eq("household_id", householdId)
    .order("updated_at", { ascending: false });

  const feedback: ReportFeedback[] = (feedbackRows ?? [])
    .map((r) => ({
      category: String((r as Record<string, unknown>).category ?? ""),
      note: String((r as Record<string, unknown>).note ?? "").trim(),
      updatedAt: String((r as Record<string, unknown>).updated_at ?? ""),
    }))
    .filter((f) => f.note.length > 0);

  return {
    householdName,
    generatedAt: new Date().toISOString(),
    months,
    currentIndex: last,
    totals,
    categories,
    creditCards,
    savingsPlans,
    feedback,
  };
}

/**
 * The individual spending transactions behind each category/month bar, for the
 * report's "Individual" tab drill-down. Uses the SAME window, categorization,
 * and purchases-&-bills filter as `assembleReportData`, so each month's
 * transactions sum to that category's bar. Kept separate from the main report
 * so the overview payload and the `/budget-report` skill stay lean.
 */
export async function assembleReportTransactions(
  supabase: SupabaseClient,
  householdId: string,
  options?: { months?: number },
): Promise<ReportTransactionsPayload> {
  const monthCount = Math.min(
    Math.max(Math.trunc(options?.months ?? DEFAULT_MONTHS), MIN_MONTHS),
    MAX_MONTHS,
  );
  const buckets = buildCompleteMonthBuckets(monthCount);

  const [catResult, pgResult] = await Promise.all([
    supabase.from("categories").select(CATEGORY_SELECT).eq("household_id", householdId),
    supabase
      .from("primary_category_groups")
      .select("id,name,slug,color,sort_order")
      .eq("household_id", householdId),
  ]);

  const categoryRows: CategoryRow[] = (catResult.data ?? []).map((c) =>
    mapCategoryRowFromSupabase(c),
  );
  const primaryGroupRows: PrimaryCategoryGroupRow[] = (pgResult.data ?? []).map((g) => ({
    id: String(g.id),
    name: String(g.name ?? ""),
    slug: String(g.slug ?? ""),
    color: g.color != null ? String(g.color) : null,
    sort_order: Number(g.sort_order ?? 0),
  }));

  const { data: rawTxs } = await fetchAllHouseholdTransactions(supabase, householdId);
  const allTxs: TransactionRow[] = attachPrimaryGroupsFromCategoryCatalog(
    (rawTxs ?? []).map(mapTransactionRow),
    categoryRows,
    primaryGroupRows,
  );

  const items: ReportTransaction[] = [];
  for (const b of buckets) {
    for (const t of allTxs) {
      if (t.occurred_on < b.start || t.occurred_on > b.end) continue;
      if (!transactionCountsAsOverviewPurchasesBar(t)) continue;
      const description =
        (t.normalized_description || t.raw_description || "").trim() || "(no description)";
      items.push({
        category: categoryDisplayName(t),
        monthKey: b.key,
        occurredOn: t.occurred_on,
        description,
        amount: -t.amount,
      });
    }
  }

  return {
    months: buckets.map((b) => ({ key: b.key, label: b.label })),
    items,
  };
}
