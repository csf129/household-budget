import type { BudgetChange, ReportFeedback } from "@/types/report";

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
