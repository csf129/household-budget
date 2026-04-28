import Link from "next/link";
import { formatPlanDateRange } from "@/lib/savings-plan-math";
import { formatSavingsCadence } from "@/lib/savings-plan-cadence";
import { formatUsd } from "@/lib/money";
import type { ProjectionLine } from "@/lib/savings-plan-projection";
import type { SavingsPlanWithProgress } from "@/types/finance";

function kindLabel(kind: SavingsPlanWithProgress["plan_kind"]): string {
  return kind === "vacation" ? "Vacation" : "Project";
}

export function DashboardPlansSummary({
  plans,
  monthProjection,
}: {
  plans: SavingsPlanWithProgress[];
  /** Optional next few months, monthly buckets only (computed on the server). */
  monthProjection?: ProjectionLine[];
}) {
  if (plans.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Plans &amp; savings
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Track projects and vacations: target amount, timeline, installment
              cadence, and what you&apos;ve set aside.
            </p>
          </div>
          <Link
            href="/plans"
            className="shrink-0 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-900 hover:bg-violet-100 dark:border-violet-900/50 dark:bg-violet-950/50 dark:text-violet-100 dark:hover:bg-violet-950/80"
          >
            Add a plan
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
      <div className="flex flex-col gap-3 border-b border-zinc-100 px-6 py-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Plans &amp; savings
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Installment cadence, planned pace vs saved, and projected contributions
            (plans included in projection only).
          </p>
        </div>
        <Link
          href="/plans"
          className="shrink-0 text-sm font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-300"
        >
          Manage plans →
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-zinc-100 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/70 dark:text-zinc-400">
            <tr>
              <th className="px-6 py-3">Plan</th>
              <th className="px-6 py-3">Type</th>
              <th className="px-6 py-3">Cadence</th>
              <th className="px-6 py-3">Target</th>
              <th className="px-6 py-3">Timeline</th>
              <th className="px-6 py-3">Planned by now</th>
              <th className="px-6 py-3">Saved</th>
              <th className="px-6 py-3">Gap</th>
              <th className="px-6 py-3">In proj.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {plans.map((plan) => {
              const gap = plan.total_saved - plan.expected_by_today;
              const remaining = Math.max(0, plan.target_amount - plan.total_saved);
              return (
                <tr
                  key={plan.id}
                  className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40"
                >
                  <td className="px-6 py-3">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {plan.title}
                    </span>
                    {remaining > 0 && remaining < plan.target_amount ? (
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {formatUsd(remaining)} left to fund
                      </p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-zinc-600 dark:text-zinc-400">
                    {kindLabel(plan.plan_kind)}
                  </td>
                  <td className="max-w-[200px] px-6 py-3 text-xs text-zinc-700 dark:text-zinc-300">
                    {formatSavingsCadence(
                      plan.increment_amount,
                      plan.increment_period,
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 tabular-nums text-zinc-800 dark:text-zinc-200">
                    {formatUsd(plan.target_amount)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-zinc-600 dark:text-zinc-400">
                    {formatPlanDateRange(plan.start_date, plan.target_date)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 tabular-nums text-zinc-700 dark:text-zinc-300">
                    {formatUsd(plan.expected_by_today)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                    {formatUsd(plan.total_saved)}
                  </td>
                  <td
                    className={
                      gap >= 0
                        ? "whitespace-nowrap px-6 py-3 tabular-nums font-medium text-emerald-700 dark:text-emerald-400"
                        : "whitespace-nowrap px-6 py-3 tabular-nums font-medium text-amber-800 dark:text-amber-200"
                    }
                  >
                    {formatUsd(gap)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-center text-xs text-zinc-600 dark:text-zinc-400">
                    {plan.include_in_projection ? "Yes" : "No"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {monthProjection && monthProjection.length > 0 ? (
        <div className="border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Projected contributions (monthly, next 6 months)
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[360px] text-left text-sm">
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {monthProjection.map((row) => (
                  <tr key={row.bucketKey}>
                    <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                      {row.bucketLabel}
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                      {formatUsd(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 font-semibold dark:border-zinc-700">
                  <td className="py-2 text-zinc-800 dark:text-zinc-200">
                    Total
                  </td>
                  <td className="py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatUsd(monthProjection.reduce((s, r) => s + r.total, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
