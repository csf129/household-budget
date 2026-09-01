import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllHouseholdTransactions } from "@/lib/fetch-household-transactions";
import { mapTransactionRow } from "@/lib/map-transaction";
import {
  formatCategoryLabel,
  mapCategoryRowFromSupabase,
} from "@/lib/category-display";
import { attachPrimaryGroupsFromCategoryCatalog } from "@/lib/attach-primary-group-to-transactions";
import { aggregateCategorySpendingInRange } from "@/lib/dashboard-analytics";
import {
  budgetDailyPortionForDate,
  effectiveMonthlyBudgetForCalendarMonth,
  totalEffectiveMonthlyBudgetForCalendarMonth,
} from "@/lib/category-budget-season";
import { periodDateRange } from "@/lib/fetch-summary-data";
import type {
  CategoryRow,
  PrimaryCategoryGroupRow,
  TransactionRow,
} from "@/types/finance";

/**
 * The aggregate rollup Hearth's Finances tab shows.
 *
 * This is the ONLY thing that leaves the budget app for Hearth. It is derived
 * entirely from the app's own analytics (`aggregateCategorySpendingInRange`,
 * the season-aware budget helpers), so Hearth's figures equal the dashboard's
 * rather than a second, drifting implementation. It carries no account numbers,
 * no Plaid data, and not a single transaction — only budget-vs-spent totals.
 */
export type HearthRollup = {
  as_of: string;
  currency: string;
  week: PeriodTotals;
  month: PeriodTotals;
  categories: RollupCategory[];
  trend: TrendPoint[];
};

type PeriodTotals = {
  start: string;
  end: string;
  budget: number;
  spent: number;
};

export type RollupCategory = {
  name: string;
  color: string | null;
  category_group: string | null;
  month_budget: number;
  month_spent: number;
  week_budget: number;
  week_spent: number;
};

type TrendPoint = { month: string; budget: number; spent: number };

const pad2 = (n: number) => String(n).padStart(2, "0");
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function addIsoDays(iso: string, delta: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d + delta);
  return isoDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** Total spend in a range, as the sum of the category breakdown — so the
 *  headline always equals the sum of the rows beneath it. */
function spentInRange(txs: TransactionRow[], start: string, end: string): number {
  let s = 0;
  for (const v of aggregateCategorySpendingInRange(txs, start, end, "all").values()) {
    s += v.amount;
  }
  return s;
}

/**
 * Build the rollup for one budget-app household. `supabase` should be a client
 * that can read this household's rows (the service-role admin client for a
 * scheduled run).
 */
export async function computeHearthRollup(
  supabase: SupabaseClient,
  householdId: string,
): Promise<HearthRollup> {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-based

  const week = periodDateRange("week"); // Monday-based, matches the dashboard
  const monthStart = isoDate(y, m, 1);
  const monthEnd = isoDate(y, m, lastDayOfMonth(y, m));

  // --- load categories, primary groups, and every transaction --------------
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
  const groupNameById = new Map(primaryGroupRows.map((g) => [g.id, g.name]));

  const { data: rawTxs } = await fetchAllHouseholdTransactions(supabase, householdId);
  const txs = attachPrimaryGroupsFromCategoryCatalog(
    (rawTxs ?? []).map(mapTransactionRow),
    categoryRows,
    primaryGroupRows,
  );

  // --- per-category budget and spend, week and month -----------------------
  const monthAgg = aggregateCategorySpendingInRange(txs, monthStart, monthEnd, "all");
  const weekAgg = aggregateCategorySpendingInRange(txs, week.start, week.end, "all");

  const weekBudgetForCategory = (cat: CategoryRow): number => {
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      sum += budgetDailyPortionForDate(cat, addIsoDays(week.start, i));
    }
    return sum;
  };

  const byName = new Map<string, RollupCategory>();
  const covered = new Set<string>();

  for (const cat of categoryRows) {
    const name = formatCategoryLabel(cat, categoryRows);
    covered.add(name);
    const monthBudget = effectiveMonthlyBudgetForCalendarMonth(cat, y, m) ?? 0;
    const weekBudget = weekBudgetForCategory(cat);
    const monthSpent = monthAgg.get(name)?.amount ?? 0;
    const weekSpent = weekAgg.get(name)?.amount ?? 0;

    // Fold subcategories that share a display label into one line.
    const prev = byName.get(name);
    if (prev) {
      prev.month_budget = round2(prev.month_budget + monthBudget);
      prev.week_budget = round2(prev.week_budget + weekBudget);
      // spend is looked up by name, so it's already the combined figure
    } else {
      byName.set(name, {
        name,
        color: cat.color ?? null,
        category_group: cat.primary_group_id
          ? groupNameById.get(cat.primary_group_id) ?? null
          : null,
        month_budget: round2(monthBudget),
        month_spent: round2(monthSpent),
        week_budget: round2(weekBudget),
        week_spent: round2(weekSpent),
      });
    }
  }

  // Spend on names with no matching category row (e.g. "Uncategorized") still
  // belongs in the total, so it gets a budget-less line rather than vanishing.
  const addLooseSpend = (
    agg: Map<string, { amount: number; color: string }>,
    field: "month_spent" | "week_spent",
  ) => {
    for (const [name, v] of agg) {
      if (covered.has(name)) continue;
      const prev = byName.get(name);
      if (prev) {
        prev[field] = round2(v.amount);
      } else {
        byName.set(name, {
          name,
          color: v.color ?? null,
          category_group: null,
          month_budget: 0,
          month_spent: field === "month_spent" ? round2(v.amount) : 0,
          week_budget: 0,
          week_spent: field === "week_spent" ? round2(v.amount) : 0,
        });
      }
    }
  };
  addLooseSpend(monthAgg, "month_spent");
  addLooseSpend(weekAgg, "week_spent");

  const categories = [...byName.values()].filter(
    (c) => c.month_budget || c.month_spent || c.week_budget || c.week_spent,
  );

  // --- headline totals: sum of the rows, so they always reconcile ----------
  const monthBudgetTotal = totalEffectiveMonthlyBudgetForCalendarMonth(categoryRows, y, m);
  const weekBudgetTotal = categories.reduce((s, c) => s + c.week_budget, 0);

  // --- trailing six months for the patterns chart -------------------------
  const trend: TrendPoint[] = [];
  for (let back = 5; back >= 0; back--) {
    const dt = new Date(y, m - 1 - back, 1);
    const ty = dt.getFullYear();
    const tm = dt.getMonth() + 1;
    const tStart = isoDate(ty, tm, 1);
    const tEnd = isoDate(ty, tm, lastDayOfMonth(ty, tm));
    trend.push({
      month: `${ty}-${pad2(tm)}-01`,
      budget: round2(totalEffectiveMonthlyBudgetForCalendarMonth(categoryRows, ty, tm)),
      spent: round2(spentInRange(txs, tStart, tEnd)),
    });
  }

  return {
    as_of: new Date().toISOString(),
    currency: "USD",
    week: {
      start: week.start,
      end: week.end,
      budget: round2(weekBudgetTotal),
      spent: round2(spentInRange(txs, week.start, week.end)),
    },
    month: {
      start: monthStart,
      end: monthEnd,
      budget: round2(monthBudgetTotal),
      spent: round2(spentInRange(txs, monthStart, monthEnd)),
    },
    categories,
    trend,
  };
}
