import type { ReportCategorySeries, SeriesStats } from "@/types/report";

/**
 * Pure month-over-month / trend math for the budget report. Kept free of any
 * runtime `@/` imports (only the type-only import above, which is erased) so it
 * can be unit-tested under vitest without a path-alias config.
 */

/** Below this fractional change versus the trailing average, a series is "flat". */
export const FLAT_BAND = 0.05;

/**
 * Summarize a per-month series (oldest → newest). The last value is "current",
 * the one before it is "previous", and the trailing average is the mean of all
 * earlier values. Direction compares current to the trailing average (falling
 * back to previous when there is no trailing history) with a small flat band.
 */
export function summarizeSeries(series: number[]): SeriesStats {
  const n = series.length;
  const current = n > 0 ? series[n - 1] : 0;
  const previous = n > 1 ? series[n - 2] : 0;
  const priors = n > 1 ? series.slice(0, n - 1) : [];
  const trailingAvg =
    priors.length > 0 ? priors.reduce((a, b) => a + b, 0) / priors.length : 0;

  const momDelta = current - previous;
  const momPct = previous > 0 ? momDelta / previous : null;
  const trendDelta = current - trailingAvg;

  const base = trailingAvg > 0 ? trailingAvg : previous;
  let direction: SeriesStats["direction"] = "flat";
  if (base > 0) {
    const pct = (current - base) / base;
    if (pct > FLAT_BAND) direction = "up";
    else if (pct < -FLAT_BAND) direction = "down";
  } else if (current > 0) {
    // No prior history but money this month: treat as a new/rising cost.
    direction = "up";
  }

  return { current, previous, trailingAvg, momDelta, momPct, trendDelta, direction };
}

/**
 * Build one `ReportCategorySeries` per category that appears in any bucket.
 * `perBucketCat` is one map (category display name → { amount, color }) per
 * month, aligned oldest → newest. Rows are sorted by current-month spend desc.
 */
export function buildCategorySeries(
  perBucketCat: Map<string, { amount: number; color: string }>[],
): ReportCategorySeries[] {
  const names = new Set<string>();
  for (const bucket of perBucketCat) {
    for (const name of bucket.keys()) names.add(name);
  }

  const out: ReportCategorySeries[] = [];
  for (const name of names) {
    const series = perBucketCat.map((bucket) => bucket.get(name)?.amount ?? 0);
    const color =
      perBucketCat
        .map((bucket) => bucket.get(name)?.color)
        .find((c): c is string => Boolean(c)) ?? "#9ca3af";
    out.push({ name, color, series, ...summarizeSeries(series) });
  }

  out.sort((a, b) => b.current - a.current);
  return out;
}
