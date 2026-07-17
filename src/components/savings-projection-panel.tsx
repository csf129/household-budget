"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  buildSavingsProjection,
  bucketKeyForDate,
} from "@/lib/savings-plan-projection";
import type {
  ProjectionGranularity,
  ProjectionLine,
} from "@/lib/savings-plan-projection";
import { addCalendarMonths } from "@/lib/savings-plan-schedule";
import { formatUsd } from "@/lib/money";
import type { SavingsPlanWithProgress } from "@/types/finance";

const GRANULARITY_OPTIONS: { value: ProjectionGranularity; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annually" },
];

type BucketTx = {
  id: string;
  amount: number;
  occurred_on: string;
  description: string;
  savings_plan_id: string | null;
};

type Props = {
  plans: SavingsPlanWithProgress[];
  householdId: string;
};

function bucketKeyToDateRange(
  key: string,
  g: ProjectionGranularity,
): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (g === "annual") {
    return { start: `${key}-01-01`, end: `${key}-12-31` };
  }
  if (g === "quarterly") {
    const [ys, qs] = key.split("-Q");
    const q = Number(qs);
    const y = Number(ys);
    const startM = (q - 1) * 3 + 1;
    const endM = startM + 2;
    const endDay = new Date(y, endM, 0).getDate();
    return { start: `${ys}-${pad(startM)}-01`, end: `${ys}-${pad(endM)}-${pad(endDay)}` };
  }
  if (g === "monthly") {
    const [ys, ms] = key.split("-");
    const endDay = new Date(Number(ys), Number(ms), 0).getDate();
    return { start: `${ys}-${ms}-01`, end: `${ys}-${ms}-${pad(endDay)}` };
  }
  // weekly: key is "YYYY-MM-DD" (Sunday start)
  const sun = new Date(key + "T00:00:00");
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { start: key, end: fmt(sat) };
}

export function SavingsProjectionPanel({ plans, householdId }: Props) {
  const [granularity, setGranularity] =
    useState<ProjectionGranularity>("monthly");
  const [monthsAhead, setMonthsAhead] = useState(12);

  const lines = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = addCalendarMonths(start, Math.max(1, monthsAhead) - 1);
    const end = new Date(
      lastMonthStart.getFullYear(),
      lastMonthStart.getMonth() + 1,
      0,
    );
    return buildSavingsProjection(plans, granularity, start, end);
  }, [plans, granularity, monthsAhead]);

  const included = useMemo(
    () => plans.filter((p) => !p.is_archived && p.include_in_projection),
    [plans],
  );

  const activePlans = useMemo(
    () => plans.filter((p) => !p.is_archived),
    [plans],
  );

  // ── Actual totals per bucket ────────────────────────────────────
  const [actualByBucket, setActualByBucket] = useState<Map<string, number>>(new Map());
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchActuals = useCallback(async () => {
    if (!householdId || lines.length === 0) return;
    const startRange = bucketKeyToDateRange(lines[0]!.bucketKey, granularity).start;
    const endRange = bucketKeyToDateRange(lines[lines.length - 1]!.bucketKey, granularity).end;
    const supabase = createClient();
    const { data } = await supabase
      .from("transactions")
      .select("amount, occurred_on")
      .eq("household_id", householdId)
      .not("savings_plan_id", "is", null)
      .gte("occurred_on", startRange)
      .lte("occurred_on", endRange);
    const map = new Map<string, number>();
    for (const row of data ?? []) {
      const amt = typeof row.amount === "string"
        ? Number.parseFloat(row.amount)
        : Number(row.amount);
      if (!Number.isFinite(amt)) continue;
      const key = bucketKeyForDate(
        new Date(String(row.occurred_on) + "T00:00:00"),
        granularity,
      );
      map.set(key, (map.get(key) ?? 0) + Math.abs(amt));
    }
    setActualByBucket(map);
  }, [householdId, lines, granularity, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void fetchActuals(); }, [fetchActuals]);

  // ── Row expansion / transaction picker ─────────────────────────
  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
  const [bucketTxs, setBucketTxs] = useState<BucketTx[]>([]);
  const [loadingBucket, setLoadingBucket] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [prevLinkedIds, setPrevLinkedIds] = useState<Set<string>>(new Set());
  const [linkToPlanId, setLinkToPlanId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const pickerRef = useRef<HTMLTableRowElement>(null);

  async function expandBucket(row: ProjectionLine) {
    if (expandedBucket === row.bucketKey) {
      setExpandedBucket(null);
      return;
    }
    const { start, end } = bucketKeyToDateRange(row.bucketKey, granularity);
    setExpandedBucket(row.bucketKey);
    setLoadingBucket(true);
    setBucketTxs([]);
    setSelectedIds(new Set());
    setPrevLinkedIds(new Set());

    const supabase = createClient();
    const { data } = await supabase
      .from("transactions")
      .select("id, amount, occurred_on, normalized_description, savings_plan_id")
      .eq("household_id", householdId)
      .gte("occurred_on", start)
      .lte("occurred_on", end)
      .order("occurred_on", { ascending: false })
      .order("amount", { ascending: true });

    const txs: BucketTx[] = (data ?? []).map((r) => ({
      id: String(r.id),
      amount: typeof r.amount === "string"
        ? Number.parseFloat(r.amount)
        : Number(r.amount),
      occurred_on: String(r.occurred_on),
      description: String(r.normalized_description ?? ""),
      savings_plan_id: r.savings_plan_id ? String(r.savings_plan_id) : null,
    }));

    const linked = new Set(txs.filter((t) => t.savings_plan_id).map((t) => t.id));
    setSelectedIds(new Set(linked));
    setPrevLinkedIds(new Set(linked));
    setBucketTxs(txs);
    setLoadingBucket(false);

    const firstLinkedPlanId = txs.find((t) => t.savings_plan_id)?.savings_plan_id ?? null;
    setLinkToPlanId(
      firstLinkedPlanId ?? activePlans[0]?.id ?? "",
    );

    setTimeout(() => pickerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  }

  function toggleTx(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (!linkToPlanId) return;
    setSaving(true);
    const supabase = createClient();

    const toLink = bucketTxs
      .filter((t) => selectedIds.has(t.id) && t.savings_plan_id !== linkToPlanId)
      .map((t) => t.id);
    const toUnlink = bucketTxs
      .filter((t) => !selectedIds.has(t.id) && prevLinkedIds.has(t.id))
      .map((t) => t.id);

    await Promise.all([
      toLink.length > 0
        ? supabase
            .from("transactions")
            .update({ savings_plan_id: linkToPlanId })
            .in("id", toLink)
        : Promise.resolve(),
      toUnlink.length > 0
        ? supabase
            .from("transactions")
            .update({ savings_plan_id: null })
            .in("id", toUnlink)
        : Promise.resolve(),
    ]);

    // Update local state so UI reflects changes without re-fetching
    setBucketTxs((prev) =>
      prev.map((t) => {
        if (toLink.includes(t.id)) return { ...t, savings_plan_id: linkToPlanId };
        if (toUnlink.includes(t.id)) return { ...t, savings_plan_id: null };
        return t;
      }),
    );
    const newLinked = new Set(
      bucketTxs
        .filter((t) => (selectedIds.has(t.id) && !toUnlink.includes(t.id)) || toLink.includes(t.id))
        .map((t) => t.id),
    );
    setPrevLinkedIds(newLinked);
    setSaving(false);
    setRefreshKey((k) => k + 1);
  }

  const selectedSum = useMemo(
    () =>
      bucketTxs
        .filter((t) => selectedIds.has(t.id))
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    [bucketTxs, selectedIds],
  );

  const actualTotal = useMemo(
    () => lines.reduce((s, r) => s + (actualByBucket.get(r.bucketKey) ?? 0), 0),
    [lines, actualByBucket],
  );

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Projected contributions
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Scheduled installments (recurring cadence) or an even split of what&apos;s
        left to fund (linear plans), summed by period. Only active plans marked
        &ldquo;Include in projection&rdquo; are counted ({included.length} plan
        {included.length === 1 ? "" : "s"}). Click a row to link transactions.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div>
          <label
            htmlFor="proj-granularity"
            className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
          >
            View by
          </label>
          <select
            id="proj-granularity"
            value={granularity}
            onChange={(e) => {
              setGranularity(e.target.value as ProjectionGranularity);
              setExpandedBucket(null);
            }}
            className="mt-1 block rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          >
            {GRANULARITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="proj-months"
            className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
          >
            Horizon (months from this month)
          </label>
          <input
            id="proj-months"
            type="number"
            min={1}
            max={60}
            value={monthsAhead}
            onChange={(e) =>
              setMonthsAhead(
                Math.min(60, Math.max(1, Number.parseInt(e.target.value, 10) || 1)),
              )
            }
            className="mt-1 w-24 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          No projected amounts in this range. Add plans, enable projection, or
          extend the horizon.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-zinc-100 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/70 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2">Period</th>
                <th className="px-4 py-2 text-right">Projected</th>
                <th className="px-4 py-2 text-right">Actual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {lines.map((row) => {
                const actual = actualByBucket.get(row.bucketKey) ?? 0;
                const isExpanded = expandedBucket === row.bucketKey;
                const isAhead = actual >= row.total && row.total > 0;
                const isBehind = actual < row.total && actual > 0;

                return (
                  <Fragment key={row.bucketKey}>
                    <tr
                      className="cursor-pointer hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40"
                      onClick={() => void expandBucket(row)}
                    >
                      <td className="px-4 py-2 text-zinc-800 dark:text-zinc-200">
                        <span className="flex items-center gap-2">
                          <svg
                            className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform dark:text-zinc-500 ${isExpanded ? "rotate-90" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          {row.bucketLabel}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                        {formatUsd(row.total)}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums ${
                        actual === 0
                          ? "text-zinc-400 dark:text-zinc-600"
                          : isAhead
                            ? "font-medium text-emerald-700 dark:text-emerald-400"
                            : isBehind
                              ? "font-medium text-amber-700 dark:text-amber-400"
                              : "font-medium text-zinc-900 dark:text-zinc-100"
                      }`}>
                        {actual === 0 ? "—" : formatUsd(actual)}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr ref={pickerRef} key={`${row.bucketKey}-picker`}>
                        <td colSpan={3} className="bg-zinc-50 p-4 dark:bg-zinc-800/50">
                          {loadingBucket ? (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading transactions…</p>
                          ) : bucketTxs.length === 0 ? (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">No transactions found for this period.</p>
                          ) : (
                            <div className="space-y-3">
                              {activePlans.length > 0 && (
                                <div className="flex flex-wrap items-center gap-3">
                                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                                    Link selected to plan:
                                  </label>
                                  <select
                                    value={linkToPlanId}
                                    onChange={(e) => setLinkToPlanId(e.target.value)}
                                    className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                                  >
                                    {activePlans.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.title}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                                {bucketTxs.map((tx) => {
                                  const checked = selectedIds.has(tx.id);
                                  const linkedPlan = activePlans.find((p) => p.id === tx.savings_plan_id);
                                  return (
                                    <label
                                      key={tx.id}
                                      className={`flex cursor-pointer items-center gap-3 border-b border-zinc-100 px-3 py-2.5 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${checked ? "bg-violet-50/40 dark:bg-violet-950/20" : ""}`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleTx(tx.id)}
                                        className="h-4 w-4 rounded border-zinc-400 accent-violet-600"
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm text-zinc-800 dark:text-zinc-200">
                                          {tx.description}
                                        </span>
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                          {tx.occurred_on}
                                          {linkedPlan && (
                                            <span className="ml-2 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                                              {linkedPlan.title}
                                            </span>
                                          )}
                                        </span>
                                      </span>
                                      <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                                        {formatUsd(Math.abs(tx.amount))}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                    {selectedIds.size}
                                  </span>{" "}
                                  selected · {formatUsd(selectedSum)} total
                                </p>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedBucket(null)}
                                    disabled={saving}
                                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleSave()}
                                    disabled={saving || !linkToPlanId}
                                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-700 dark:hover:bg-violet-600"
                                  >
                                    {saving ? "Saving…" : "Save"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 font-semibold dark:border-zinc-700">
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">Total</td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatUsd(lines.reduce((s, r) => s + r.total, 0))}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {actualTotal > 0 ? formatUsd(actualTotal) : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
