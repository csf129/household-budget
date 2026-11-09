import type React from "react";
import { formatUsd } from "@/lib/money";
import type { ReportCategorySeries } from "@/types/report";

/**
 * Small presentational building blocks for the report view. Each is pure
 * (props in, JSX out — no hooks, no state), extracted from report-view.tsx.
 */

export function Card({
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

export function DirectionBadge({
  direction,
}: {
  direction: ReportCategorySeries["direction"];
}) {
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

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
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

export function deltaSub(current: number, avg: number): React.ReactNode {
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

export function CategoryList({ rows }: { rows: ReportCategorySeries[] }) {
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
