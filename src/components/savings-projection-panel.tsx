"use client";

import { useMemo, useState } from "react";
import { buildSavingsProjection } from "@/lib/savings-plan-projection";
import type { ProjectionGranularity } from "@/lib/savings-plan-projection";
import { addCalendarMonths } from "@/lib/savings-plan-schedule";
import { formatUsd } from "@/lib/money";
import type { SavingsPlanWithProgress } from "@/types/finance";

const GRANULARITY_OPTIONS: { value: ProjectionGranularity; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annually" },
];

type Props = {
  plans: SavingsPlanWithProgress[];
};

export function SavingsProjectionPanel({ plans }: Props) {
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

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Projected contributions
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Scheduled installments (recurring cadence) or an even split of what’s
        left to fund (linear plans), summed by period. Only active plans marked
        “Include in projection” are counted ({included.length} plan
        {included.length === 1 ? "" : "s"}).
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
            onChange={(e) =>
              setGranularity(e.target.value as ProjectionGranularity)
            }
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
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="border-b border-zinc-100 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/70 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2">Period</th>
                <th className="px-4 py-2 text-right">Projected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {lines.map((row) => (
                <tr key={row.bucketKey} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40">
                  <td className="px-4 py-2 text-zinc-800 dark:text-zinc-200">
                    {row.bucketLabel}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatUsd(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 font-semibold dark:border-zinc-700">
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">
                  Total
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatUsd(lines.reduce((s, r) => s + r.total, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
