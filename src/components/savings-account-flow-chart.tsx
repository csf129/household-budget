"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getChartAxisTheme } from "@/lib/chart-palette";
import { formatUsd, formatUsdCompact } from "@/lib/money";

export type SavingsAccountInfo = {
  id: string;
  name: string;
  displayName: string | null;
  mask: string | null;
  subtype: string | null;
  currentBalance: number | null;
};

export type SavingsAccountMonthlyTx = {
  accountId: string;
  monthKey: string;
  transfersIn: number;
  transfersOut: number;
};

type ChartRow = {
  month: string;
  monthKey: string;
  transfersIn: number;
  transfersOut: number;
  balance: number;
};

type Props = {
  accounts: SavingsAccountInfo[];
  txByAccount: SavingsAccountMonthlyTx[];
};

const STORAGE_KEY = "savings-chart-selected-accounts";

function accountLabel(a: SavingsAccountInfo): string {
  const base = a.displayName ?? a.name;
  return a.mask ? `${base} ···${a.mask}` : base;
}

export function SavingsAccountFlowChart({ accounts, txByAccount }: Props) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const chartAxis = useMemo(() => getChartAxisTheme(isDark), [isDark]);

  // Default selection: accounts with subtype "savings"; fall back to all accounts
  const defaultIds = useMemo(() => {
    const savingsIds = accounts.filter((a) => a.subtype === "savings").map((a) => a.id);
    return savingsIds.length > 0 ? savingsIds : accounts.map((a) => a.id);
  }, [accounts]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(defaultIds));
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // On mount, restore from localStorage; fall back to defaults if nothing stored or no overlap
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        const validIds = parsed.filter((id) => accounts.some((a) => a.id === id));
        if (validIds.length > 0) {
          setSelectedIds(new Set(validIds));
          return;
        }
      }
    } catch { /* ignore */ }
    setSelectedIds(new Set(defaultIds));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggleAccount(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size === 1) return prev; // keep at least one
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch { /* ignore */ }
      return next;
    });
  }

  // Aggregate filtered accounts by month
  // Sum of Plaid's current_balance for selected accounts — the authoritative figure
  const totalCurrentBalance = useMemo(() => {
    return accounts
      .filter((a) => selectedIds.has(a.id) && a.currentBalance !== null)
      .reduce((sum, a) => sum + (a.currentBalance ?? 0), 0);
  }, [accounts, selectedIds]);

  const chartData: ChartRow[] = useMemo(() => {
    const byMonth = new Map<string, { inflow: number; outflow: number }>();
    for (const tx of txByAccount) {
      if (!selectedIds.has(tx.accountId)) continue;
      if (!byMonth.has(tx.monthKey)) byMonth.set(tx.monthKey, { inflow: 0, outflow: 0 });
      const m = byMonth.get(tx.monthKey)!;
      m.inflow += tx.transfersIn;
      m.outflow += tx.transfersOut;
    }
    const months = Array.from(byMonth.keys()).sort();

    // Build rows with flows first (balance filled below)
    const rows: ChartRow[] = months.map((key) => {
      const { inflow, outflow } = byMonth.get(key)!;
      const [y, mo] = key.split("-");
      const month = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });
      return {
        month,
        monthKey: key,
        transfersIn: Math.round(inflow * 100) / 100,
        transfersOut: Math.round(outflow * 100) / 100,
        balance: 0,
      };
    });

    // Reconstruct historical balance by working backwards from Plaid's current balance.
    // balance[i] is the estimated balance at the end of month i.
    // balance[i-1] = balance[i] - netFlow[i]
    let balance = totalCurrentBalance;
    for (let i = rows.length - 1; i >= 0; i--) {
      rows[i].balance = Math.round(balance * 100) / 100;
      balance -= rows[i].transfersIn + rows[i].transfersOut;
    }

    return rows;
  }, [txByAccount, selectedIds, totalCurrentBalance]);

  const selectedLabel = useMemo(() => {
    const sel = accounts.filter((a) => selectedIds.has(a.id));
    if (sel.length === 0) return "No accounts";
    if (sel.length === 1) return accountLabel(sel[0]);
    return `${sel.length} accounts`;
  }, [accounts, selectedIds]);

  if (accounts.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Savings account activity
        </h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          No bank accounts connected. Link one in{" "}
          <a href="/settings/bank" className="text-violet-600 hover:underline dark:text-violet-400">
            Settings → Bank
          </a>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Savings account activity
          </h2>
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
            Monthly transfers in and out of selected accounts
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Running total */}
          {totalCurrentBalance !== 0 && (
            <div className="text-right">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Current balance</p>
              <p
                className={`text-lg font-semibold tabular-nums ${
                  totalCurrentBalance >= 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {formatUsd(totalCurrentBalance)}
              </p>
            </div>
          )}

          {/* Account selector dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <span>{selectedLabel}</span>
              <svg
                className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full z-20 mt-1.5 min-w-[220px] rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Include in chart
                </p>
                {accounts.map((a) => (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(a.id)}
                      onChange={() => toggleAccount(a.id)}
                      className="h-3.5 w-3.5 rounded border-zinc-300 text-violet-600 dark:border-zinc-600"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                        {a.displayName ?? a.name}
                        {a.mask ? ` ···${a.mask}` : ""}
                      </p>
                      {a.subtype && (
                        <p className="text-[10px] capitalize text-zinc-400">{a.subtype}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chart */}
      {chartData.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          No transactions found for the selected accounts.
        </p>
      ) : (
        <>
          <div className="mt-4 h-[260px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 56, left: 4, bottom: 8 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke={chartAxis.gridStroke}
                />
                <ReferenceLine
                  yAxisId="bars"
                  y={0}
                  stroke={chartAxis.gridStroke}
                  strokeWidth={1.5}
                />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: chartAxis.tickFill }} />
                <YAxis
                  yAxisId="bars"
                  tickFormatter={(v) => formatUsdCompact(Number(v))}
                  tick={{ fontSize: 11, fill: chartAxis.tickFill }}
                  width={56}
                />
                <YAxis
                  yAxisId="balance"
                  orientation="right"
                  tickFormatter={(v) => formatUsdCompact(Number(v))}
                  tick={{ fontSize: 11, fill: chartAxis.tickFill }}
                  width={56}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as ChartRow;
                    return (
                      <div className={chartAxis.tooltipShell}>
                        <div className={chartAxis.tooltipTitle}>{label}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                          <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />
                          In: {formatUsd(row.transfersIn)}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                          <span className="inline-block h-2 w-2 rounded-sm bg-red-500" />
                          Out: {formatUsd(Math.abs(row.transfersOut))}
                        </div>
                        <div className={chartAxis.tooltipFooter}>
                          Est. balance: {formatUsd(row.balance)}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  yAxisId="bars"
                  dataKey="transfersIn"
                  name="In"
                  fill={isDark ? "#22c55e" : "#16a34a"}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
                <Bar
                  yAxisId="bars"
                  dataKey="transfersOut"
                  name="Out"
                  fill={isDark ? "#f87171" : "#dc2626"}
                  radius={[0, 0, 4, 4]}
                  maxBarSize={40}
                />
                <Line
                  yAxisId="balance"
                  dataKey="balance"
                  name="Running total"
                  stroke={isDark ? "#818cf8" : "#4f46e5"}
                  strokeWidth={2}
                  dot={{ r: 3, fill: isDark ? "#818cf8" : "#4f46e5", strokeWidth: 0 }}
                  type="monotone"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />
              Transfers in
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-red-500" />
              Transfers out
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
              Est. balance (right axis)
            </span>
          </div>
        </>
      )}
    </section>
  );
}
