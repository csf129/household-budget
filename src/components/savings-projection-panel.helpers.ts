import type { ProjectionGranularity } from "@/lib/savings-plan-projection";

/**
 * Pure helpers extracted from savings-projection-panel.tsx. No React, no state.
 */

export const GRANULARITY_OPTIONS: { value: ProjectionGranularity; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annually" },
];

/** Inclusive start/end dates (YYYY-MM-DD) for a projection bucket key. */
export function bucketKeyToDateRange(
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
