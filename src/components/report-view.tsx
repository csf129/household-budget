"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd, formatUsdCompact } from "@/lib/money";
import type { ReportCategorySeries, ReportData } from "@/types/report";

const INCOME_COLOR = "#16a34a";
const SPENDING_COLOR = "#7c3aed";
const NET_COLOR = "#0ea5e9";

const BILL_HINTS = [
  "electric",
  "gas",
  "propane",
  "water",
  "power",
  "utility",
  "utilities",
  "internet",
  "phone",
  "cable",
  "insurance",
  "subscription",
  "streaming",
  "membership",
];
const CAR_HINTS = ["gas", "fuel", "auto", "car", "vehicle", "insurance", "dmv", "registration"];

const matchesAny = (name: string, hints: string[]) => {
  const n = name.toLowerCase();
  return hints.some((h) => n.includes(h));
};

const MONTH_OPTIONS = [3, 6, 12];

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {title}
        </h2>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DirectionBadge({ direction }: { direction: ReportCategorySeries["direction"] }) {
  const map = {
    up: { label: "↑ up", cls: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" },
    down: {
      label: "↓ down",
      cls: "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300",
    },
    flat: { label: "→ flat", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  } as const;
  const { label, cls } = map[direction];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
      {sub ? <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div> : null}
    </div>
  );
}

function deltaSub(current: number, avg: number): React.ReactNode {
  if (avg <= 0) return null;
  const pct = Math.round(((current - avg) / avg) * 100);
  const up = pct > 0;
  const cls = up ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400";
  if (pct === 0) return <span className="text-zinc-500">vs avg {formatUsd(avg)}</span>;
  return (
    <span className={cls}>
      {up ? "↑" : "↓"} {Math.abs(pct)}% vs avg {formatUsd(avg)}
    </span>
  );
}

function CategoryList({ rows }: { rows: ReportCategorySeries[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No matching spending.</p>;
  }
  const max = Math.max(...rows.map((r) => r.current), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.name}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{r.name}</span>
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-zinc-900 dark:text-zinc-100">{formatUsd(r.current)}</span>
              <DirectionBadge direction={r.direction} />
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full"
                style={{ width: `${(r.current / max) * 100}%`, backgroundColor: r.color }}
              />
            </div>
            <span className="w-28 text-right text-xs text-zinc-500 dark:text-zinc-400">
              {r.trailingAvg > 0 ? `avg ${formatUsd(r.trailingAvg)}` : "no history"}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReportView({ householdName }: { householdName: string }) {
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [insights, setInsights] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  // Switching the window resets view state here (an event handler, not an
  // effect) so the fetch effect below never calls setState synchronously.
  const changeMonths = useCallback((next: number) => {
    setMonths(next);
    setLoading(true);
    setError(null);
    setData(null);
    setInsights(null);
    setInsightsError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/household/report?months=${months}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
        return json as ReportData;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [months]);

  const runInsights = useCallback(() => {
    setInsightsLoading(true);
    setInsightsError(null);
    fetch(`/api/household/report/insights?months=${months}`, { method: "POST" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
        return json as { insights: string };
      })
      .then((json) => setInsights(json.insights))
      .catch((err: unknown) =>
        setInsightsError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setInsightsLoading(false));
  }, [months]);

  const chartData = useMemo(
    () =>
      (data?.months ?? []).map((m) => ({
        label: m.label.replace(/ \d{4}$/, ""),
        income: Math.round(m.income),
        spending: Math.round(m.spending),
        net: Math.round(m.net),
      })),
    [data],
  );

  const bills = useMemo(
    () => (data?.categories ?? []).filter((c) => matchesAny(c.name, BILL_HINTS)),
    [data],
  );
  const cars = useMemo(
    () => (data?.categories ?? []).filter((c) => matchesAny(c.name, CAR_HINTS)),
    [data],
  );
  const topCategories = useMemo(() => (data?.categories ?? []).slice(0, 10), [data]);

  const monthPicker = (
    <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      History
      <select
        value={months}
        onChange={(e) => changeMonths(Number(e.target.value))}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      >
        {MONTH_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m} months
          </option>
        ))}
      </select>
    </label>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading {householdName}&apos;s report…</p>
        {monthPicker}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm dark:border-red-900/40 dark:bg-red-950/40">
        <p className="font-medium text-red-700 dark:text-red-300" role="alert">
          Could not load the report: {error}
        </p>
        <div className="mt-3">{monthPicker}</div>
      </div>
    );
  }

  if (!data) return null;

  const cur = data.months[data.currentIndex];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">{monthPicker}</div>

      {/* Overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={`Income — ${cur?.label ?? ""}`}
          value={formatUsd(cur?.income ?? 0)}
          sub={deltaSub(cur?.income ?? 0, data.totals.avgIncome)}
        />
        <Stat
          label="Spending"
          value={formatUsd(cur?.spending ?? 0)}
          sub={deltaSub(cur?.spending ?? 0, data.totals.avgSpending)}
        />
        <Stat
          label="Net"
          value={formatUsd(cur?.net ?? 0)}
          sub={
            <span className={(cur?.net ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              {(cur?.net ?? 0) >= 0 ? "surplus" : "deficit"}
            </span>
          }
        />
        <Stat
          label="Avg monthly spend"
          value={formatUsd(data.totals.avgSpending)}
          sub={<span className="text-zinc-500">over prior {data.months.length - 1} mo</span>}
        />
      </div>

      {/* Income vs spending trend */}
      <Card title="Income vs spending">
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => formatUsdCompact(Number(v))} tick={{ fontSize: 12 }} width={56} />
              <Tooltip formatter={(v) => formatUsd(Number(v))} />
              <Legend />
              <Bar dataKey="income" name="Income" fill={INCOME_COLOR} radius={[3, 3, 0, 0]} />
              <Bar dataKey="spending" name="Spending" fill={SPENDING_COLOR} radius={[3, 3, 0, 0]} />
              <Line dataKey="net" name="Net" stroke={NET_COLOR} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Where the money goes */}
      <Card title="Where the money goes (top categories)">
        <CategoryList rows={topCategories} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Bills — up or down">
          <CategoryList rows={bills} />
        </Card>
        <Card title="Cars">
          <CategoryList rows={cars} />
        </Card>
      </div>

      {/* Credit cards */}
      <Card title="Credit cards">
        {data.creditCards.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No linked credit cards.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {data.creditCards.map((c) => {
              const util = c.utilization;
              const high = util != null && util > 0.3;
              return (
                <div
                  key={`${c.name}-${c.mask ?? ""}`}
                  className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {c.name}
                      {c.mask ? <span className="text-zinc-400"> ·•••{c.mask}</span> : null}
                    </span>
                    <span className="text-sm text-zinc-900 dark:text-zinc-100">
                      {c.balance != null ? formatUsd(c.balance) : "—"}
                    </span>
                  </div>
                  {util != null ? (
                    <div className="mt-2">
                      <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div
                          className={`h-full rounded-full ${high ? "bg-red-500" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(100, Math.round(util * 100))}%` }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {Math.round(util * 100)}% utilization{high ? " — high" : ""}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {c.paymentDueDay ? <span>Due day {c.paymentDueDay}</span> : null}
                    {c.annualFee ? <span>{formatUsd(c.annualFee)} annual fee</span> : null}
                    {c.pointsBalance != null ? (
                      <span>
                        {c.pointsBalance.toLocaleString()} {c.pointsProgram ?? "points"}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Savings */}
      <Card title="Savings plans">
        {data.savingsPlans.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No active savings plans.</p>
        ) : (
          <ul className="space-y-3">
            {data.savingsPlans.map((p) => {
              const pct = Math.min(100, Math.round(p.progress * 100));
              const behind = p.pace < 0;
              return (
                <li key={p.title}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">{p.title}</span>
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {formatUsd(p.saved)} / {formatUsd(p.target)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 text-xs">
                    <span className={behind ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                      {behind ? `behind pace by ${formatUsd(-p.pace)}` : "on or ahead of pace"}
                    </span>
                    <span className="text-zinc-400"> · target {p.targetDate}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* AI savings deep-dive */}
      <Card
        title="Where to save the most — easiest first"
        right={
          <button
            type="button"
            onClick={runInsights}
            disabled={insightsLoading}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-60"
          >
            {insightsLoading ? "Analyzing…" : insights ? "Regenerate" : "Generate savings analysis"}
          </button>
        }
      >
        {insightsError ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {insightsError}
          </p>
        ) : insights ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {insights}
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Run your household&apos;s AI assistant over this report to get a prioritized,
            plain-English plan for where to cut spending first.
          </p>
        )}
      </Card>
    </div>
  );
}
