import type { SupabaseClient } from "@supabase/supabase-js";
import type { SummarySections, SummaryPeriod } from "@/types/email-summary";
import type { SummaryData } from "@/lib/email-summary-template";
import { fetchAllHouseholdTransactions } from "@/lib/fetch-household-transactions";
import { fetchSavingsPlansWithProgress } from "@/lib/fetch-savings-plans";
import { mapTransactionRow } from "@/lib/map-transaction";
import { mapCategoryRowFromSupabase } from "@/lib/category-display";
import { attachPrimaryGroupsFromCategoryCatalog } from "@/lib/attach-primary-group-to-transactions";
import {
  aggregateCategorySpendingInRange,
  transactionCountsAsOverviewIncomeBar,
} from "@/lib/dashboard-analytics";
import type { CategoryRow, PrimaryCategoryGroupRow } from "@/types/finance";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function periodDateRange(period: SummaryPeriod): {
  start: string;
  end: string;
  label: string;
} {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based

  if (period === "week") {
    const day = now.getDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1; // Monday-based week
    const mon = new Date(now);
    mon.setDate(now.getDate() - diff);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    return {
      start: fmt(mon),
      end: fmt(sun),
      label: `Week of ${mon.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
    };
  }

  if (period === "quarter") {
    const q = Math.floor(m / 3);
    const qStart = q * 3;
    const qEnd = qStart + 2;
    const lastDay = new Date(y, qEnd + 1, 0).getDate();
    return {
      start: `${y}-${pad2(qStart + 1)}-01`,
      end: `${y}-${pad2(qEnd + 1)}-${pad2(lastDay)}`,
      label: `Q${q + 1} ${y}`,
    };
  }

  // month (default)
  const lastDay = new Date(y, m + 1, 0).getDate();
  return {
    start: `${y}-${pad2(m + 1)}-01`,
    end: `${y}-${pad2(m + 1)}-${pad2(lastDay)}`,
    label: new Date(y, m, 1).toLocaleString("en-US", { month: "long", year: "numeric" }),
  };
}

export async function fetchEmailSummaryData(
  supabase: SupabaseClient,
  householdId: string,
  householdName: string,
  period: SummaryPeriod,
  sections: SummarySections,
): Promise<SummaryData> {
  const { start, end, label } = periodDateRange(period);

  // Fetch categories + primary groups (always needed)
  const [catResult, pgResult] = await Promise.all([
    supabase
      .from("categories")
      .select(
        "id,name,color,sort_order,description,primary_group_id,monthly_budget,parent_category_id,budget_repeats_annually,budget_active_from_month,budget_active_from_day,budget_active_to_month,budget_active_to_day,budget_period_start,budget_period_end,budget_amount_period,budget_annual_payment_month,budget_recurring_payment,budget_recurring_interval",
      )
      .eq("household_id", householdId),
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

  // Fetch transactions
  const { data: rawTxs } = await fetchAllHouseholdTransactions(supabase, householdId);
  const txs = attachPrimaryGroupsFromCategoryCatalog(
    (rawTxs ?? []).map(mapTransactionRow),
    categoryRows,
    primaryGroupRows,
  ).filter((t) => t.occurred_on >= start && t.occurred_on <= end);

  // ── Income & Spending ──────────────────────────────────────────
  let totalIncome = 0;
  let totalSpending = 0;
  for (const t of txs) {
    if (!Number.isFinite(t.amount)) continue;
    if (transactionCountsAsOverviewIncomeBar(t)) {
      totalIncome += t.amount;
    } else if (t.amount < 0) {
      totalSpending += -t.amount;
    }
  }

  // ── Category breakdown ────────────────────────────────────────
  const aggMap = aggregateCategorySpendingInRange(txs, start, end, "all");
  const categoryRowsOut = [...aggMap.entries()]
    .map(([name, v]) => ({ name, amount: v.amount, color: v.color }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // ── Budget progress ───────────────────────────────────────────
  const budgetRows: SummaryData["budgetRows"] = [];
  if (sections.budget_progress) {
    for (const cat of categoryRows) {
      if (!cat.monthly_budget) continue;
      const { formatCategoryLabel } = await import("@/lib/category-display");
      const displayName = formatCategoryLabel(cat, categoryRows);
      const spent = aggMap.get(displayName)?.amount ?? 0;
      budgetRows.push({ name: displayName, spent, budget: cat.monthly_budget });
    }
    budgetRows.sort((a, b) => b.spent / b.budget - a.spent / a.budget);
  }

  // ── Top transactions ──────────────────────────────────────────
  const topTransactions: SummaryData["topTransactions"] = [];
  if (sections.top_transactions) {
    const expenses = txs
      .filter((t) => Number.isFinite(t.amount) && t.amount < 0)
      .sort((a, b) => a.amount - b.amount) // most negative first
      .slice(0, 10);
    for (const t of expenses) {
      topTransactions.push({
        occurred_on: t.occurred_on,
        normalized_description: t.normalized_description,
        amount: t.amount,
        category: t.categories?.name ?? null,
      });
    }
  }

  // ── Business expenses ─────────────────────────────────────────
  let businessExpenseCount = 0;
  let businessExpenseTotal = 0;
  let businessMissingReceiptsCount = 0;
  if (sections.business_expenses) {
    for (const t of txs) {
      if (!t.is_business_expense) continue;
      businessExpenseCount++;
      businessExpenseTotal += Math.abs(t.amount);
      if (!t.receipts || t.receipts.length === 0) businessMissingReceiptsCount++;
    }
  }

  // ── Savings plans ─────────────────────────────────────────────
  const savingsPlanRows: SummaryData["savingsPlanRows"] = [];
  if (sections.savings_plans) {
    const { rows } = await fetchSavingsPlansWithProgress(supabase, householdId, {
      includeArchived: false,
    });
    for (const plan of rows) {
      savingsPlanRows.push({
        name: plan.title,
        saved: plan.total_saved ?? 0,
        target: plan.target_amount,
      });
    }
  }

  return {
    householdName,
    periodLabel: label,
    sections,
    totalIncome,
    totalSpending,
    categoryRows: categoryRowsOut,
    budgetRows,
    topTransactions,
    businessExpenseCount,
    businessExpenseTotal,
    businessMissingReceiptsCount,
    savingsPlanRows,
  };
}
