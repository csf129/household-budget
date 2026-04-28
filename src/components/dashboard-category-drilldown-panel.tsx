"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  filterSpendingTransactionsForCategoryLabel,
  filterSpendingTransactionsForCategorySubtree,
  type CategoryBucketSpendRow,
  type CategorySpendRow,
  type SpendingBreakdownMode,
} from "@/lib/dashboard-analytics";
import { getChartAxisTheme } from "@/lib/chart-palette";
import { TransactionEditModal } from "@/components/transaction-edit-modal";
import { formatUsd, formatUsdCompact } from "@/lib/money";
import type { CategoryRow, TransactionRow } from "@/types/finance";

type Props = {
  householdId: string;
  categories: CategoryRow[];
  category: CategorySpendRow;
  series: CategoryBucketSpendRow[];
  overviewHeading: string;
  rangeStart: string;
  rangeEnd: string;
  transactions: TransactionRow[];
  onClose: () => void;
  /** Matches the period bucket selected in the overview (e.g. month picker). */
  preferredPeriodBucketKey?: string | null;
  /** Align drilldown transaction list with overview category scope. */
  spendingBreakdownMode?: SpendingBreakdownMode;
};

function defaultPeriodKey(rows: CategoryBucketSpendRow[]): string {
  const last = [...rows].reverse().find((r) => r.spending > 0);
  return last?.key ?? "all";
}

function initialPeriodKey(
  rows: CategoryBucketSpendRow[],
  preferredKey: string | null | undefined,
): string {
  if (preferredKey && rows.some((r) => r.key === preferredKey)) {
    return preferredKey;
  }
  return defaultPeriodKey(rows);
}

export function DashboardCategoryDrilldownPanel({
  householdId,
  categories,
  category,
  series,
  overviewHeading,
  rangeStart,
  rangeEnd,
  transactions,
  onClose,
  preferredPeriodBucketKey,
  spendingBreakdownMode = "all",
}: Props) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const c = useMemo(() => getChartAxisTheme(isDark), [isDark]);
  const barMuted = isDark ? "#52525b" : "#d4d4d8";
  const [selectedKey, setSelectedKey] = useState(() =>
    initialPeriodKey(series, preferredPeriodBucketKey),
  );
  const [showRulesBanner, setShowRulesBanner] = useState(true);
  const [sidebarTable, setSidebarTable] = useState(false);
  const [editingTx, setEditingTx] = useState<TransactionRow | null>(null);

  const editMatchCount = useMemo(() => {
    if (!editingTx) return 0;
    return transactions.filter(
      (t) => t.normalized_description === editingTx.normalized_description,
    ).length;
  }, [editingTx, transactions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editingTx) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editingTx]);

  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    if (selectedKey === "all") {
      return {
        periodStart: rangeStart,
        periodEnd: rangeEnd,
        periodLabel: `All — ${overviewHeading}`,
      };
    }
    const b = series.find((s) => s.key === selectedKey);
    if (!b) {
      return {
        periodStart: rangeStart,
        periodEnd: rangeEnd,
        periodLabel: overviewHeading,
      };
    }
    return {
      periodStart: b.start,
      periodEnd: b.end,
      periodLabel: b.label,
    };
  }, [selectedKey, series, rangeStart, rangeEnd, overviewHeading]);

  const filteredTx = useMemo(() => {
    if (category.drilldownSubtreeRootId) {
      return filterSpendingTransactionsForCategorySubtree(
        transactions,
        category.drilldownSubtreeRootId,
        categories,
        periodStart,
        periodEnd,
        spendingBreakdownMode,
      );
    }
    return filterSpendingTransactionsForCategoryLabel(
      transactions,
      category.name,
      rangeStart,
      rangeEnd,
      periodStart,
      periodEnd,
      undefined,
      spendingBreakdownMode,
    );
  }, [
    transactions,
    category.name,
    category.drilldownSubtreeRootId,
    categories,
    rangeStart,
    rangeEnd,
    periodStart,
    periodEnd,
    spendingBreakdownMode,
  ]);

  const periodTotal = useMemo(
    () =>
      filteredTx.reduce((s, t) => s + (t.amount < 0 ? -t.amount : 0), 0),
    [filteredTx],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cat-drill-title"
        className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 sm:px-5 dark:border-zinc-700 dark:bg-zinc-900">
          <h2
            id="cat-drill-title"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            Category spending
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Sidebar */}
          <aside className="flex w-full shrink-0 flex-col gap-4 border-b border-zinc-200 bg-white p-4 lg:max-w-[320px] lg:border-b-0 lg:border-r lg:py-5 dark:border-zinc-700 dark:bg-zinc-900">
            <div>
              <label
                htmlFor="drill-period"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Time frame
              </label>
              <select
                id="drill-period"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              >
                <option value="all">All — {overviewHeading}</option>
                {series.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label} ({formatUsd(s.spending)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span
                  className="h-8 w-8 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: category.color }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {category.name}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{periodLabel}</p>
                </div>
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatUsd(periodTotal)}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Spending in this category for the selected time frame
              </p>
            </div>

            <div className="min-h-[160px] flex-1">
              {sidebarTable ? (
                <div className="max-h-[200px] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-950/80">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-zinc-50 text-zinc-500 dark:bg-zinc-800/80 dark:text-zinc-400">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Period</th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          Spent
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {series.map((s) => (
                        <tr
                          key={s.key}
                          className={
                            s.key === selectedKey
                              ? "bg-blue-50/80 dark:bg-blue-950/40"
                              : undefined
                          }
                        >
                          <td className="px-2 py-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedKey(s.key)}
                              className="text-left font-medium text-zinc-800 hover:underline dark:text-zinc-200"
                            >
                              {s.label}
                            </button>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatUsd(s.spending)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={series}
                      margin={{ top: 4, right: 4, left: 0, bottom: 4 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke={c.gridStroke}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10, fill: c.tickFill }}
                        interval={0}
                        angle={series.length > 6 ? -30 : 0}
                        textAnchor={series.length > 6 ? "end" : "middle"}
                        height={series.length > 6 ? 48 : 24}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: c.tickFill }}
                        tickFormatter={(v) => formatUsdCompact(Number(v))}
                        width={40}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0]?.payload as CategoryBucketSpendRow;
                          return (
                            <div className={c.tooltipShell}>
                              <div className={c.tooltipTitle}>{row.label}</div>
                              <div className={c.tooltipBody}>
                                {formatUsd(row.spending)}
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey="spending"
                        radius={[3, 3, 0, 0]}
                        maxBarSize={28}
                        onClick={(data: { payload?: CategoryBucketSpendRow }) => {
                          const k = data?.payload?.key;
                          if (k) setSelectedKey(k);
                        }}
                      >
                        {series.map((entry) => (
                          <Cell
                            key={entry.key}
                            cursor="pointer"
                            fill={
                              entry.key === selectedKey
                                ? category.color
                                : barMuted
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSidebarTable((v) => !v)}
              className="text-left text-xs font-medium text-blue-700 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-200"
            >
              {sidebarTable ? "See chart" : "See chart as table"}
            </button>

            <Link
              href="/settings/categories"
              className="mt-auto inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700"
            >
              Categories &amp; budgets
            </Link>
          </aside>

          {/* Main list */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-50/80 p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-zinc-600">
                <span className="font-medium text-zinc-800">All accounts</span>
                <span className="text-zinc-400"> · </span>
                <span className="tabular-nums">
                  {filteredTx.length} transaction
                  {filteredTx.length === 1 ? "" : "s"}
                </span>
              </p>
            </div>

            {showRulesBanner ? (
              <div className="relative mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 pr-8 text-sm text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-100">
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => setShowRulesBanner(false)}
                  className="absolute right-2 top-2 rounded p-0.5 text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/60"
                >
                  ×
                </button>
                <p className="font-semibold">Create category rules</p>
                <p className="mt-1 text-xs text-sky-900/90 dark:text-sky-200/90">
                  Automate categorization for imports and new transactions on
                  the{" "}
                  <Link
                    href="/settings/rules"
                    className="font-medium underline hover:no-underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Rules
                  </Link>{" "}
                  page.
                </p>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/20">
              <div className="max-h-[min(520px,calc(95vh-280px))] overflow-y-auto lg:max-h-[min(640px,calc(95vh-200px))]">
                {filteredTx.length === 0 ? (
                  <p className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    No spending in this category for this time frame.
                  </p>
                ) : (
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-400">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                        <th className="w-10 px-2 py-3" aria-hidden />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {filteredTx.map((t) => {
                        const cat = t.categories;
                        return (
                          <tr
                            key={t.id}
                            tabIndex={0}
                            role="button"
                            aria-label={`Edit transaction ${t.raw_description.slice(0, 40)}`}
                            className="cursor-pointer hover:bg-zinc-50/80 focus-visible:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-400 dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800 dark:focus-visible:outline-zinc-500"
                            onClick={() => setEditingTx(t)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setEditingTx(t);
                              }
                            }}
                          >
                            <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-600 dark:text-zinc-400">
                              {t.occurred_on}
                            </td>
                            <td className="max-w-[220px] px-4 py-3">
                              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {t.raw_description}
                              </span>
                              {t.notes ? (
                                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                  {t.notes}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-4 py-3">
                              {cat ? (
                                <span className="inline-flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                                  <span
                                    className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/10"
                                    style={{
                                      backgroundColor: cat.color || "#94a3b8",
                                    }}
                                    aria-hidden
                                  />
                                  {cat.name}
                                </span>
                              ) : (
                                <span className="text-zinc-400 dark:text-zinc-500">—</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                              {formatUsd(t.amount < 0 ? -t.amount : t.amount)}
                            </td>
                            <td className="px-2 py-3 text-zinc-400 dark:text-zinc-500">›</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              {filteredTx.length > 0 ? (
                <p className="border-t border-zinc-100 px-4 py-2 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  End of list
                </p>
              ) : null}
            </div>

            <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
              <span className="text-zinc-600 dark:text-zinc-400">Click a row to edit.</span>{" "}
              <Link
                href="/transactions"
                className="font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-200"
              >
                Open full ledger
              </Link>{" "}
              for bulk work.
            </p>
          </main>
        </div>
      </div>

      {editingTx ? (
        <TransactionEditModal
          transaction={editingTx}
          householdId={householdId}
          categories={categories}
          matchCount={editMatchCount}
          onClose={() => setEditingTx(null)}
          onSaved={() => {
            setEditingTx(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
