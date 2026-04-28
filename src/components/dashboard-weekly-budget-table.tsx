"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BUDGET_WEEK_START_STORAGE_KEY,
  clampWeekStartDay,
  DEFAULT_BUDGET_WEEK_START_DAY,
  WEEK_START_DAY_LABELS,
} from "@/lib/budget-week-settings";
import { formatCategoryLabel } from "@/lib/category-display";
import {
  aggregateCategorySpendingInRange,
  type CategorySpendRow,
} from "@/lib/dashboard-analytics";
import { totalEffectiveMonthlyBudgetForCalendarMonth } from "@/lib/category-budget-season";
import { formatUsd } from "@/lib/money";
import {
  addCalendarDays,
  budgetPortionForCategoryFullWeekWithSeason,
  getTodayIsoDateLocal,
  listWeekSlicesInMonth,
  parseIsoDateParts,
  pickDefaultWeekSliceForToday,
} from "@/lib/weekly-spending-budget";
import type { CategoryRow, TransactionRow } from "@/types/finance";

export type WeeklyBudgetCategoryDrilldownPayload = {
  category: CategorySpendRow;
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
};

type Props = {
  categories: CategoryRow[];
  transactions: TransactionRow[];
  monthStart: string;
  monthEnd: string;
  monthLabel: string;
  onCategoryDrilldown?: (payload: WeeklyBudgetCategoryDrilldownPayload) => void;
};

function readWeekStartFromStorage(): number {
  if (typeof window === "undefined") return DEFAULT_BUDGET_WEEK_START_DAY;
  try {
    const raw = window.localStorage.getItem(BUDGET_WEEK_START_STORAGE_KEY);
    if (raw == null) return DEFAULT_BUDGET_WEEK_START_DAY;
    return clampWeekStartDay(Number.parseInt(raw, 10));
  } catch {
    return DEFAULT_BUDGET_WEEK_START_DAY;
  }
}

type CategoryWeekRow = {
  name: string;
  color: string;
  budgetPortion: number;
  spent: number;
};

export function DashboardWeeklyBudgetTable({
  categories,
  transactions,
  monthStart,
  monthEnd,
  monthLabel,
  onCategoryDrilldown,
}: Props) {
  const [weekStartsOn, setWeekStartsOn] = useState(DEFAULT_BUDGET_WEEK_START_DAY);
  const [userSelectedWeekStart, setUserSelectedWeekStart] = useState<string | null>(null);
  const skipPersistRef = useRef(true);

  useEffect(() => {
    setWeekStartsOn(readWeekStartFromStorage());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    try {
      window.localStorage.setItem(
        BUDGET_WEEK_START_STORAGE_KEY,
        String(weekStartsOn),
      );
    } catch {
      /* ignore */
    }
  }, [weekStartsOn]);

  const totalBudget = useMemo(() => {
    const { y, m } = parseIsoDateParts(monthStart);
    return totalEffectiveMonthlyBudgetForCalendarMonth(categories, y, m);
  }, [categories, monthStart]);

  const weekSlices = useMemo(
    () => listWeekSlicesInMonth(monthStart, monthEnd, weekStartsOn),
    [monthStart, monthEnd, weekStartsOn],
  );

  // Derive the effective selected week synchronously so the current week is
  // shown on the first render without waiting for a useEffect.
  const selectedWeekStart = useMemo(() => {
    if (weekSlices.length === 0) return null;
    if (userSelectedWeekStart && weekSlices.some((w) => w.weekStart === userSelectedWeekStart)) {
      return userSelectedWeekStart;
    }
    return pickDefaultWeekSliceForToday(weekSlices, getTodayIsoDateLocal());
  }, [weekSlices, userSelectedWeekStart]);

  const activeSlice = useMemo(
    () => weekSlices.find((w) => w.weekStart === selectedWeekStart),
    [weekSlices, selectedWeekStart],
  );

  const spendRange = useMemo(() => {
    if (!selectedWeekStart) return null;
    return {
      start: selectedWeekStart,
      end: addCalendarDays(selectedWeekStart, 6),
    };
  }, [selectedWeekStart]);

  const categoryWeekRows = useMemo((): CategoryWeekRow[] => {
    if (!spendRange || !selectedWeekStart) return [];

    const agg = aggregateCategorySpendingInRange(
      transactions,
      spendRange.start,
      spendRange.end,
    );

    const sortedCats = [...categories].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.name.localeCompare(b.name);
    });

    const hasUncategorized = sortedCats.some(
      (c) => c.name.trim() === "Uncategorized",
    );

    const rows: CategoryWeekRow[] = sortedCats.map((cat) => {
      // Must match `categoryDisplayName` / overview keys: subcategories aggregate as "Parent › Child".
      const displayName = formatCategoryLabel(cat, sortedCats);
      const budgetPortion = budgetPortionForCategoryFullWeekWithSeason(
        cat,
        selectedWeekStart,
      );
      const spent = agg.get(displayName)?.amount ?? 0;
      const color =
        cat.color?.trim() ||
        agg.get(displayName)?.color ||
        (displayName === "Uncategorized" ? "#9ca3af" : "#94a3b8");
      return { name: displayName, color, budgetPortion, spent };
    });

    if (!hasUncategorized) {
      const u = agg.get("Uncategorized");
      rows.push({
        name: "Uncategorized",
        color: "#9ca3af",
        budgetPortion: 0,
        spent: u?.amount ?? 0,
      });
    }

    return rows.filter((r) => r.budgetPortion > 0 || r.spent > 0.005);
  }, [categories, transactions, selectedWeekStart, spendRange]);

  const totals = useMemo(() => {
    const budget = categoryWeekRows.reduce((s, r) => s + r.budgetPortion, 0);
    const spent = categoryWeekRows.reduce((s, r) => s + r.spent, 0);
    return { budget, spent, left: budget - spent };
  }, [categoryWeekRows]);

  if (totalBudget <= 0) return null;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Weekly spending budget
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {monthLabel}
            </span>
            <span className="text-zinc-400 dark:text-zinc-600"> · </span>
            Each week uses all 7 days: daily amount is monthly budget ÷ days in
            that calendar month, so cross-month weeks blend April vs May (etc.).
            Spending matches the same full week (same rules as the category
            table).
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-[min(100%,220px)] flex-1">
            <label
              htmlFor="budget-week-picker"
              className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
            >
              Week
            </label>
            <select
              id="budget-week-picker"
              value={selectedWeekStart ?? ""}
              onChange={(e) => setUserSelectedWeekStart(e.target.value || null)}
              disabled={weekSlices.length === 0}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-500/25"
            >
              {weekSlices.map((w) => (
                <option key={w.weekStart} value={w.weekStart}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[min(100%,200px)] sm:shrink-0">
            <label
              htmlFor="budget-week-starts"
              className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
            >
              Week starts on
            </label>
            <select
              id="budget-week-starts"
              value={weekStartsOn}
              onChange={(e) =>
                setWeekStartsOn(
                  clampWeekStartDay(Number.parseInt(e.target.value, 10)),
                )
              }
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-500/25"
            >
              {WEEK_START_DAY_LABELS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!activeSlice || !spendRange ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          No week slices for this month.
        </p>
      ) : categoryWeekRows.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          No spending and no category budgets apply to this week (or all lines
          round to zero).
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {onCategoryDrilldown ? (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Click a category to list transactions for this week.
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-950/50">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400">
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 text-right font-medium">
                  Budget (week)
                </th>
                <th className="px-3 py-2 text-right font-medium">Spent</th>
                <th className="px-3 py-2 text-right font-medium">Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {categoryWeekRows.map((r) => {
                const left = r.budgetPortion - r.spent;
                const openDrilldown = () => {
                  if (!onCategoryDrilldown || !spendRange || !activeSlice) return;
                  onCategoryDrilldown({
                    category: {
                      name: r.name,
                      amount: r.spent,
                      color: r.color,
                    },
                    weekStart: spendRange.start,
                    weekEnd: spendRange.end,
                    weekLabel: activeSlice.label,
                  });
                };
                return (
                  <tr
                    key={r.name}
                    className={
                      onCategoryDrilldown
                        ? "cursor-pointer outline-none transition-colors hover:bg-zinc-100/80 focus-visible:bg-zinc-100/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-400 dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800/60 dark:focus-visible:outline-zinc-500"
                        : undefined
                    }
                    tabIndex={onCategoryDrilldown ? 0 : undefined}
                    role={onCategoryDrilldown ? "button" : undefined}
                    onClick={onCategoryDrilldown ? openDrilldown : undefined}
                    onKeyDown={
                      onCategoryDrilldown
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openDrilldown();
                            }
                          }
                        : undefined
                    }
                    aria-label={
                      onCategoryDrilldown
                        ? `View ${r.name} transactions for this week`
                        : undefined
                    }
                  >
                    <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: r.color }}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate" title={r.name}>
                          {r.name}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                      {r.budgetPortion > 0 ? formatUsd(r.budgetPortion) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                      {formatUsd(r.spent)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        r.budgetPortion <= 0
                          ? "text-zinc-500 dark:text-zinc-500"
                          : left >= 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-red-700 dark:text-red-400"
                      }`}
                    >
                      {r.budgetPortion > 0 ? formatUsd(left) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 bg-zinc-50/80 font-semibold dark:border-zinc-700 dark:bg-zinc-800/40">
                <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                  Week total
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatUsd(totals.budget)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatUsd(totals.spent)}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    totals.left >= 0
                      ? "text-emerald-800 dark:text-emerald-300"
                      : "text-red-800 dark:text-red-300"
                  }`}
                >
                  {formatUsd(totals.left)}
                </td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      )}

      {activeSlice ? (
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          Spending covers the full week{" "}
          <span className="font-medium text-zinc-600 dark:text-zinc-300">
            {spendRange?.start} – {spendRange?.end}
          </span>
          . Weeks in the list are those that touch {monthLabel}. Categories with
          no weekly budget and no spending this week are hidden. Full month
          budget: {formatUsd(totalBudget)}.
        </p>
      ) : null}
    </section>
  );
}
