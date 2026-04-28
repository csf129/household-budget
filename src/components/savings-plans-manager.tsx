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
import { createClient } from "@/lib/supabase/client";
import { mapSavingsContribution, mapSavingsPlan } from "@/lib/map-savings-plan";
import { SavingsProjectionPanel } from "@/components/savings-projection-panel";
import { getChartAxisTheme } from "@/lib/chart-palette";
import {
  formatSavingsCadence,
  SAVINGS_INCREMENT_OPTIONS,
} from "@/lib/savings-plan-cadence";
import { expectedSavedByDate, formatPlanDateRange } from "@/lib/savings-plan-math";
import {
  contributionsTotalInRollingDays,
  totalSuggestedWeeklyPaceUsd,
} from "@/lib/savings-weekly-pace";
import { formatUsd, formatUsdCompact } from "@/lib/money";
import type {
  SavingsIncrementPeriod,
  SavingsPlanContributionRow,
  SavingsPlanKind,
  SavingsPlanRow,
  SavingsPlanWithProgress,
} from "@/types/finance";

type Props = {
  householdId: string;
  initialPlans: SavingsPlanWithProgress[];
  initialContributions: SavingsPlanContributionRow[];
};

function kindLabel(k: SavingsPlanKind) {
  return k === "vacation" ? "Vacation" : "Project";
}

const INCLUDE_PROJECTION_MIGRATION_FILE =
  "20260412100000_savings_plans_cadence_projection.sql";

function isMissingIncludeInProjectionError(message: string): boolean {
  return message.toLowerCase().includes("include_in_projection");
}

type PlanSavePayload = {
  household_id: string;
  title: string;
  plan_kind: SavingsPlanKind;
  target_amount: number;
  start_date: string;
  target_date: string;
  increment_amount: number | null;
  increment_period: SavingsIncrementPeriod | null;
  include_in_projection: boolean;
  notes: string | null;
};

function withoutIncludeInProjection(
  p: PlanSavePayload,
): Omit<PlanSavePayload, "include_in_projection"> {
  const { include_in_projection: _i, ...rest } = p;
  return rest;
}

export function SavingsPlansManager({
  householdId,
  initialPlans,
  initialContributions,
}: Props) {
  const router = useRouter();
  const [plans, setPlans] = useState(initialPlans);
  const [contributions, setContributions] = useState(initialContributions);
  const [showArchived, setShowArchived] = useState(false);

  const [title, setTitle] = useState("");
  const [planKind, setPlanKind] = useState<SavingsPlanKind>("project");
  const [targetStr, setTargetStr] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [useIncrement, setUseIncrement] = useState(false);
  const [incrementStr, setIncrementStr] = useState("");
  const [incrementPeriod, setIncrementPeriod] =
    useState<SavingsIncrementPeriod>("monthly");
  const [notes, setNotes] = useState("");
  const [includeInProjection, setIncludeInProjection] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Shown after a successful save that omitted include_in_projection (DB not migrated). */
  const [projectionSchemaNote, setProjectionSchemaNote] = useState<string | null>(
    null,
  );

  const [contribPlanId, setContribPlanId] = useState<string | null>(null);
  const [contribAmount, setContribAmount] = useState("");
  const [contribOn, setContribOn] = useState("");
  const [contribNote, setContribNote] = useState("");
  const [planModalOpen, setPlanModalOpen] = useState(false);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const chartAxis = useMemo(() => getChartAxisTheme(isDark), [isDark]);

  const suggestedWeeklyTotal = useMemo(
    () => totalSuggestedWeeklyPaceUsd(plans),
    [plans],
  );
  const contributionsLast7Days = useMemo(
    () => contributionsTotalInRollingDays(contributions, 7),
    [contributions],
  );
  const weeklyPaceChartData = useMemo(
    () => [
      { label: "Target pace / week", value: suggestedWeeklyTotal },
      { label: "Saved last 7 days", value: contributionsLast7Days },
    ],
    [suggestedWeeklyTotal, contributionsLast7Days],
  );

  useEffect(() => {
    setPlans(initialPlans);
  }, [initialPlans]);

  useEffect(() => {
    setContributions(initialContributions);
  }, [initialContributions]);

  const contribsByPlan = useMemo(() => {
    const m = new Map<string, SavingsPlanContributionRow[]>();
    for (const c of contributions) {
      const list = m.get(c.savings_plan_id) ?? [];
      list.push(c);
      m.set(c.savings_plan_id, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => b.contributed_on.localeCompare(a.contributed_on));
    }
    return m;
  }, [contributions]);

  const visiblePlans = useMemo(
    () => (showArchived ? plans : plans.filter((p) => !p.is_archived)),
    [plans, showArchived],
  );

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setPlanKind("project");
    setTargetStr("");
    setStartDate("");
    setTargetDate("");
    setUseIncrement(false);
    setIncrementStr("");
    setIncrementPeriod("monthly");
    setNotes("");
    setIncludeInProjection(true);
    setError(null);
  }

  /** Close after successful save; keeps migration hint if set. */
  function finishPlanModal() {
    setPlanModalOpen(false);
    resetForm();
  }

  /** Close from cancel / Escape / backdrop; clears migration hint. */
  function dismissPlanModal() {
    setPlanModalOpen(false);
    resetForm();
    setProjectionSchemaNote(null);
  }

  function openAddPlanModal() {
    resetForm();
    setProjectionSchemaNote(null);
    setPlanModalOpen(true);
  }

  function startEdit(p: SavingsPlanRow) {
    setEditingId(p.id);
    setTitle(p.title);
    setPlanKind(p.plan_kind);
    setTargetStr(String(p.target_amount));
    setStartDate(p.start_date);
    setTargetDate(p.target_date);
    const hasInc = p.increment_amount != null && p.increment_period != null;
    setUseIncrement(hasInc);
    setIncrementStr(hasInc ? String(p.increment_amount) : "");
    setIncrementPeriod(p.increment_period ?? "monthly");
    setNotes(p.notes ?? "");
    setIncludeInProjection(p.include_in_projection);
    setError(null);
    setProjectionSchemaNote(null);
    setPlanModalOpen(true);
  }

  useEffect(() => {
    if (!planModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissPlanModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [planModalOpen]);

  function recomputeProgressForPlan(plan: SavingsPlanRow): SavingsPlanWithProgress {
    const total_saved = (contributions ?? [])
      .filter((c) => c.savings_plan_id === plan.id)
      .reduce((s, c) => s + c.amount, 0);
    const expected_by_today = expectedSavedByDate(
      plan.target_amount,
      plan.start_date,
      plan.target_date,
      plan.increment_amount,
      plan.increment_period,
    );
    return { ...plan, total_saved, expected_by_today };
  }

  async function setPlanIncludeInProjection(planId: string, include: boolean) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: upErr } = await supabase
      .from("savings_plans")
      .update({ include_in_projection: include })
      .eq("id", planId)
      .eq("household_id", householdId)
      .select("*")
      .single();
    setBusy(false);
    if (upErr) {
      if (isMissingIncludeInProjectionError(upErr.message)) {
        setError(
          `This toggle needs the include_in_projection column. In the Supabase SQL Editor, run ${INCLUDE_PROJECTION_MIGRATION_FILE} from this project’s supabase/migrations folder, then reload.`,
        );
      } else {
        setError(upErr.message);
      }
      return;
    }
    if (data) {
      const mapped = mapSavingsPlan(data);
      setPlans((prev) =>
        prev.map((x) =>
          x.id === planId ? recomputeProgressForPlan(mapped) : x,
        ),
      );
    }
    router.refresh();
  }

  async function handlePlanSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setProjectionSchemaNote(null);
    const target = Number.parseFloat(targetStr);
    if (!title.trim()) {
      setError("Enter a plan title.");
      return;
    }
    if (!Number.isFinite(target) || target <= 0) {
      setError("Target amount must be a positive number.");
      return;
    }
    if (!startDate || !targetDate) {
      setError("Choose start and target dates.");
      return;
    }
    if (startDate > targetDate) {
      setError("Target date must be on or after the start date.");
      return;
    }
    let increment_amount: number | null = null;
    let increment_period: SavingsIncrementPeriod | null = null;
    if (useIncrement) {
      const inc = Number.parseFloat(incrementStr);
      if (!Number.isFinite(inc) || inc <= 0) {
        setError("Contribution increment must be a positive number.");
        return;
      }
      increment_amount = inc;
      increment_period = incrementPeriod;
    }

    setBusy(true);
    const supabase = createClient();
    try {
      const payload: PlanSavePayload = {
        household_id: householdId,
        title: title.trim(),
        plan_kind: planKind,
        target_amount: target,
        start_date: startDate,
        target_date: targetDate,
        increment_amount,
        increment_period,
        include_in_projection: includeInProjection,
        notes: notes.trim() || null,
      };

      if (editingId) {
        let { data, error: upErr } = await supabase
          .from("savings_plans")
          .update(payload)
          .eq("id", editingId)
          .eq("household_id", householdId)
          .select("*")
          .single();
        if (
          upErr &&
          isMissingIncludeInProjectionError(upErr.message)
        ) {
          const retry = await supabase
            .from("savings_plans")
            .update(withoutIncludeInProjection(payload))
            .eq("id", editingId)
            .eq("household_id", householdId)
            .select("*")
            .single();
          data = retry.data;
          upErr = retry.error;
          if (!upErr) {
            setProjectionSchemaNote(
              `Plan updated. To persist “Include in projected contributions,” run ${INCLUDE_PROJECTION_MIGRATION_FILE} in the Supabase SQL Editor, then reload.`,
            );
          }
        }
        if (upErr) {
          setError(upErr.message);
          return;
        }
        if (data) {
          const mapped = mapSavingsPlan(data);
          setPlans((prev) =>
            prev.map((x) =>
              x.id === editingId ? recomputeProgressForPlan(mapped) : x,
            ),
          );
        }
        finishPlanModal();
      } else {
        let { data, error: insErr } = await supabase
          .from("savings_plans")
          .insert({ ...payload, is_archived: false })
          .select("*")
          .single();
        if (
          insErr &&
          isMissingIncludeInProjectionError(insErr.message)
        ) {
          const retry = await supabase
            .from("savings_plans")
            .insert({
              ...withoutIncludeInProjection(payload),
              is_archived: false,
            })
            .select("*")
            .single();
          data = retry.data;
          insErr = retry.error;
          if (!insErr) {
            setProjectionSchemaNote(
              `Plan saved. To use “Include in projected contributions,” run ${INCLUDE_PROJECTION_MIGRATION_FILE} in the Supabase SQL Editor, then reload.`,
            );
          }
        }
        if (insErr) {
          setError(insErr.message);
          return;
        }
        if (data) {
          const mapped = mapSavingsPlan(data);
          setPlans((prev) => [recomputeProgressForPlan(mapped), ...prev]);
        }
        finishPlanModal();
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchived(p: SavingsPlanWithProgress) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: upErr } = await supabase
      .from("savings_plans")
      .update({ is_archived: !p.is_archived })
      .eq("id", p.id)
      .eq("household_id", householdId)
      .select("*")
      .single();
    setBusy(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    if (data) {
      const mapped = mapSavingsPlan(data);
      setPlans((prev) =>
        prev.map((x) =>
          x.id === p.id ? recomputeProgressForPlan(mapped) : x,
        ),
      );
    }
    router.refresh();
  }

  async function handleDeletePlan(id: string) {
    if (
      !window.confirm(
        "Delete this plan and all contribution records? This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from("savings_plans")
      .delete()
      .eq("id", id)
      .eq("household_id", householdId);
    setBusy(false);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setPlans((prev) => prev.filter((p) => p.id !== id));
    setContributions((prev) => prev.filter((c) => c.savings_plan_id !== id));
    if (editingId === id) dismissPlanModal();
    router.refresh();
  }

  async function handleAddContribution(e: React.FormEvent, planId: string) {
    e.preventDefault();
    setError(null);
    const amt = Number.parseFloat(contribAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Contribution must be a positive amount.");
      return;
    }
    const on = contribOn.trim() || new Date().toISOString().slice(0, 10);

    setBusy(true);
    const supabase = createClient();
    const { data, error: insErr } = await supabase
      .from("savings_plan_contributions")
      .insert({
        savings_plan_id: planId,
        household_id: householdId,
        amount: amt,
        contributed_on: on,
        note: contribNote.trim() || null,
      })
      .select("*")
      .single();
    setBusy(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    if (data) {
      const row = mapSavingsContribution(data);
      setContributions((prev) => [row, ...prev]);
      setPlans((prev) =>
        prev.map((p) => {
          if (p.id !== planId) return p;
          return {
            ...p,
            total_saved: p.total_saved + row.amount,
          };
        }),
      );
    }
    setContribPlanId(null);
    setContribAmount("");
    setContribOn("");
    setContribNote("");
    router.refresh();
  }

  async function deleteContribution(id: string, planId: string, amount: number) {
    if (!window.confirm("Remove this contribution?")) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from("savings_plan_contributions")
      .delete()
      .eq("id", id)
      .eq("household_id", householdId);
    setBusy(false);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setContributions((prev) => prev.filter((c) => c.id !== id));
    setPlans((prev) =>
      prev.map((p) =>
        p.id === planId ? { ...p, total_saved: p.total_saved - amount } : p,
      ),
    );
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm">
            <Link
              href="/dashboard"
              className="font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-300"
            >
              ← Overview
            </Link>
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Plans &amp; savings
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Budget for home projects, trips, or other goals. Set a target and
            timeline, optionally a recurring contribution pace, then log what you
            actually save. The overview compares planned pace to your running
            total.
          </p>
        </div>
        <button
          type="button"
          onClick={openAddPlanModal}
          disabled={busy}
          className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Add plan
        </button>
      </div>

      {projectionSchemaNote ? (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          {projectionSchemaNote}
        </p>
      ) : null}

      {error && !planModalOpen ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <SavingsProjectionPanel plans={plans} />

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Weekly savings pace
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Combined target divides what you still need on each active plan by the
          full weeks left until that plan&apos;s end date (overdue plans count the
          full remainder as urgent). Compare that to total contributions logged in
          the last 7 days.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            Target pace:{" "}
            <span className="tabular-nums">{formatUsd(suggestedWeeklyTotal)}</span>
            <span className="font-normal text-zinc-500 dark:text-zinc-400">
              {" "}
              / week
            </span>
          </span>
          <span className="text-zinc-700 dark:text-zinc-300">
            Last 7 days saved:{" "}
            <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatUsd(contributionsLast7Days)}
            </span>
          </span>
        </div>
        <div className="mt-4 h-[220px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={weeklyPaceChartData}
              margin={{ top: 8, right: 12, left: 4, bottom: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke={chartAxis.gridStroke}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: chartAxis.tickFill }}
                interval={0}
                height={56}
              />
              <YAxis
                tick={{ fontSize: 11, fill: chartAxis.tickFill }}
                tickFormatter={(v) => formatUsdCompact(Number(v))}
                width={56}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as {
                    label: string;
                    value: number;
                  };
                  return (
                    <div className={chartAxis.tooltipShell}>
                      <div className={chartAxis.tooltipTitle}>{row.label}</div>
                      <div className={chartAxis.tooltipBody}>
                        {formatUsd(row.value)}
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]} maxBarSize={56}>
                {weeklyPaceChartData.map((_, i) => (
                  <Cell
                    key={i}
                    fill={
                      i === 0
                        ? isDark
                          ? "#818cf8"
                          : "#4f46e5"
                        : isDark
                          ? "#34d399"
                          : "#059669"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
          className="rounded border-zinc-400 dark:border-zinc-600"
        />
        Show archived plans
      </label>

      {visiblePlans.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
          <div className="border-b border-zinc-100 px-6 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Plans at a glance
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Installment cadence and whether each plan feeds the projection totals.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/70 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Cadence</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Timeline</th>
                  <th className="px-4 py-3">Saved</th>
                  <th className="px-4 py-3">Left</th>
                  <th className="px-4 py-3 text-center">In projection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {visiblePlans.map((plan) => {
                  const left = Math.max(0, plan.target_amount - plan.total_saved);
                  return (
                    <tr
                      key={`tbl-${plan.id}`}
                      className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                        {plan.title}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">
                        {kindLabel(plan.plan_kind)}
                      </td>
                      <td className="max-w-[200px] px-4 py-3 text-xs text-zinc-700 dark:text-zinc-300">
                        {formatSavingsCadence(
                          plan.increment_amount,
                          plan.increment_period,
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-800 dark:text-zinc-200">
                        {formatUsd(plan.target_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                        {formatPlanDateRange(plan.start_date, plan.target_date)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-800 dark:text-zinc-200">
                        {formatUsd(plan.total_saved)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-700 dark:text-zinc-300">
                        {formatUsd(left)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={plan.include_in_projection}
                          disabled={busy || plan.is_archived}
                          onChange={(e) =>
                            void setPlanIncludeInProjection(
                              plan.id,
                              e.target.checked,
                            )
                          }
                          aria-label={`Include ${plan.title} in projection`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="space-y-6">
        {visiblePlans.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {showArchived
              ? "No plans yet."
              : "No active plans. Use Add plan, or show archived."}
          </p>
        ) : (
          visiblePlans.map((plan) => {
            const savedPct = Math.min(
              100,
              (plan.total_saved / plan.target_amount) * 100,
            );
            const expectedPct = Math.min(
              100,
              (plan.expected_by_today / plan.target_amount) * 100,
            );
            const gap = plan.total_saved - plan.expected_by_today;
            const planContribs = contribsByPlan.get(plan.id) ?? [];

            return (
              <article
                key={plan.id}
                className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        {plan.title}
                      </h3>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {kindLabel(plan.plan_kind)}
                      </span>
                      {plan.is_archived ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                          Archived
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                      {formatPlanDateRange(plan.start_date, plan.target_date)}
                      <span className="text-zinc-400 dark:text-zinc-600"> · </span>
                      Goal {formatUsd(plan.target_amount)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(plan)}
                      disabled={busy}
                      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleArchived(plan)}
                      disabled={busy}
                      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {plan.is_archived ? "Restore" : "Archive"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeletePlan(plan.id)}
                      disabled={busy}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                    <span>Saved plan vs goal</span>
                    <span className="tabular-nums">
                      {formatUsd(plan.total_saved)} / {formatUsd(plan.target_amount)}{" "}
                      ({savedPct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="relative mt-1 h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-zinc-300 dark:bg-zinc-600"
                      style={{ width: `${expectedPct}%` }}
                      title="Planned pace (target)"
                    />
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-violet-600 dark:bg-violet-500"
                      style={{ width: `${savedPct}%` }}
                      title="Saved so far"
                    />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="inline-block h-2 w-2 rounded-full bg-zinc-400 align-middle dark:bg-zinc-500" />{" "}
                    Planned by today {formatUsd(plan.expected_by_today)}
                    <span className="mx-2 text-zinc-400">·</span>
                    <span className="inline-block h-2 w-2 rounded-full bg-violet-600 align-middle dark:bg-violet-500" />{" "}
                    Saved {formatUsd(plan.total_saved)}
                    <span className="mx-2 text-zinc-400">·</span>
                    Gap {formatUsd(gap)}
                  </p>
                </div>

                {plan.notes ? (
                  <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                    {plan.notes}
                  </p>
                ) : null}

                <div className="mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Contributions
                    </h4>
                    {contribPlanId === plan.id ? (
                      <button
                        type="button"
                        onClick={() => setContribPlanId(null)}
                        className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      >
                        Close form
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setContribPlanId(plan.id);
                          setContribOn(new Date().toISOString().slice(0, 10));
                          setContribAmount("");
                          setContribNote("");
                          setError(null);
                        }}
                        className="rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        Log contribution
                      </button>
                    )}
                  </div>

                  {contribPlanId === plan.id ? (
                    <form
                      className="mt-3 flex flex-wrap items-end gap-3"
                      onSubmit={(e) => void handleAddContribution(e, plan.id)}
                    >
                      <div>
                        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          Amount
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={contribAmount}
                          onChange={(e) => setContribAmount(e.target.value)}
                          className="mt-1 w-32 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          Date
                        </label>
                        <input
                          type="date"
                          value={contribOn}
                          onChange={(e) => setContribOn(e.target.value)}
                          className="mt-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                        />
                      </div>
                      <div className="min-w-[120px] flex-1">
                        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          Note (optional)
                        </label>
                        <input
                          value={contribNote}
                          onChange={(e) => setContribNote(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={busy}
                        className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                      >
                        Add
                      </button>
                    </form>
                  ) : null}

                  {planContribs.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      No contributions logged yet.
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
                      {planContribs.map((c) => (
                        <li
                          key={c.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                        >
                          <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                            {formatUsd(c.amount)}
                          </span>
                          <span className="text-zinc-500 dark:text-zinc-400">
                            {c.contributed_on}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">
                            {c.note ?? "—"}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void deleteContribution(c.id, plan.id, c.amount)
                            }
                            disabled={busy}
                            className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      {planModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={() => dismissPlanModal()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-modal-title"
            className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                id="plan-modal-title"
                className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
              >
                {editingId ? "Edit plan" : "New plan"}
              </h2>
              <button
                type="button"
                onClick={() => dismissPlanModal()}
                className="rounded-md px-2 py-1 text-lg leading-none text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={(e) => void handlePlanSubmit(e)}
              className="mt-4 space-y-4"
            >
              {error ? (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Title
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                    placeholder="e.g. Kitchen remodel, Japan trip"
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Type
                  </label>
                  <select
                    value={planKind}
                    onChange={(e) =>
                      setPlanKind(e.target.value as SavingsPlanKind)
                    }
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                  >
                    <option value="project">Project</option>
                    <option value="vacation">Vacation</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Target amount
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={targetStr}
                    onChange={(e) => setTargetStr(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Target / trip end date
                  </label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={useIncrement}
                      onChange={(e) => setUseIncrement(e.target.checked)}
                      className="mt-1 rounded border-zinc-400 dark:border-zinc-600"
                    />
                    <span>
                      <span className="font-medium">Recurring contribution target</span>
                      <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                        Otherwise pace is assumed smooth (linear) across the timeline.
                      </span>
                    </span>
                  </label>
                </div>
                {useIncrement ? (
                  <>
                    <div>
                      <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        Amount per period
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={incrementStr}
                        onChange={(e) => setIncrementStr(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        Period
                      </label>
                      <select
                        value={incrementPeriod}
                        onChange={(e) =>
                          setIncrementPeriod(
                            e.target.value as SavingsIncrementPeriod,
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                      >
                        {SAVINGS_INCREMENT_OPTIONS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : null}
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Notes (optional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    maxLength={1000}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={includeInProjection}
                      onChange={(e) => setIncludeInProjection(e.target.checked)}
                      className="mt-1 rounded border-zinc-400 dark:border-zinc-600"
                    />
                    <span>
                      <span className="font-medium">Include in projected contributions</span>
                      <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                        Count this plan in the future spending / savings schedule on the
                        overview and below.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  {busy ? "Saving…" : editingId ? "Update plan" : "Add plan"}
                </button>
                <button
                  type="button"
                  onClick={() => dismissPlanModal()}
                  disabled={busy}
                  className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
