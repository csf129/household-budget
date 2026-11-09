import type { BudgetChange, ReportCategorySeries, ReportFeedback } from "@/types/report";

/**
 * Pure helpers, constants, and small types extracted from report-view.tsx.
 * No React, no JSX — safe to unit-test in isolation.
 */

/** Props Recharts passes to a custom `dot` renderer (only the bits we use). */
export type DotRenderProps = {
  cx?: number;
  cy?: number;
  index?: number;
  [k: string]: unknown;
};

export const BILL_HINTS = [
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
export const CAR_HINTS = ["gas", "fuel", "auto", "car", "vehicle", "insurance", "dmv", "registration"];

export const matchesAny = (name: string, hints: string[]) => {
  const n = name.toLowerCase();
  return hints.some((h) => n.includes(h));
};

export const MONTH_OPTIONS = [3, 6, 12];

export function notesFromFeedback(
  feedback: ReportFeedback[] | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of feedback ?? []) {
    const note = f.note.trim();
    if (note) map[f.category] = note;
  }
  return map;
}

export type RevertItem = { categoryId: string; monthlyBudget: number | null };

export function fmtBudgetDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Per category in a day group, the revert target = the OLD amount of that
 * category's EARLIEST change that day (restores the pre-day state). Skips
 * categories that have since been deleted. `items` are newest-first. */
export function groupRevertTargets(items: BudgetChange[]): RevertItem[] {
  const map = new Map<string, number | null>();
  for (const ch of items) {
    if (ch.categoryId == null) continue;
    map.set(ch.categoryId, ch.oldAmount); // older rows overwrite → earliest wins
  }
  return [...map.entries()].map(([categoryId, monthlyBudget]) => ({ categoryId, monthlyBudget }));
}

/** Mean of a per-month series (the same "avg" the plots show). */
export function categoryWindowAverage(series: number[]): number {
  if (series.length === 0) return 0;
  return series.reduce((a, b) => a + b, 0) / series.length;
}

/** Sum of every category's monthly budget (null counts as 0). */
export function sumCategoryBudgets(categories: ReportCategorySeries[]): number {
  return categories.reduce((s, c) => s + (c.monthlyBudget ?? 0), 0);
}

export type BudgetStatusRow = {
  name: string;
  /** Window-average monthly spend. */
  avg: number;
  /** Monthly budget. */
  budget: number;
  /** avg − budget (> 0). */
  over: number;
  /** over / budget. */
  pct: number;
};

/**
 * Categories whose window-average monthly spend exceeds their monthly budget,
 * worst (largest overage) first. Uses the same window average the plots show,
 * so the list agrees with each plot's "avg" versus its budget line.
 */
export function overBudgetCategories(categories: ReportCategorySeries[]): BudgetStatusRow[] {
  const rows: BudgetStatusRow[] = [];
  for (const c of categories) {
    const budget = c.monthlyBudget;
    if (budget == null || budget <= 0) continue;
    const avg = categoryWindowAverage(c.series);
    const over = avg - budget;
    if (over > 0.005) {
      rows.push({ name: c.name, avg, budget, over, pct: over / budget });
    }
  }
  rows.sort((a, b) => b.over - a.over);
  return rows;
}
