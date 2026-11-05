import type { CategoryRow } from "@/types/finance";

/**
 * Pure helpers extracted from budget-settings-panel.tsx — no React, no state.
 */

export function parseUsdInput(raw: string): number | null {
  const s = raw.trim().replace(/[$,]/g, "");
  if (s === "") return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function formatInput(n: number | null): string {
  if (n === null || n === undefined) return "";
  return n === 0 ? "0" : String(n);
}

export type SeasonDraft = {
  limit: boolean;
  repeatsAnnually: boolean;
  fm: number | null;
  fd: number | null;
  tm: number | null;
  td: number | null;
  periodStart: string;
  periodEnd: string;
};

export const MONTH_OPTIONS = [
  { v: 1, label: "Jan" },
  { v: 2, label: "Feb" },
  { v: 3, label: "Mar" },
  { v: 4, label: "Apr" },
  { v: 5, label: "May" },
  { v: 6, label: "Jun" },
  { v: 7, label: "Jul" },
  { v: 8, label: "Aug" },
  { v: 9, label: "Sep" },
  { v: 10, label: "Oct" },
  { v: 11, label: "Nov" },
  { v: 12, label: "Dec" },
];

export function seasonDraftFromCategory(c: CategoryRow): SeasonDraft {
  const hasMd =
    c.budget_active_from_month != null &&
    c.budget_active_from_day != null &&
    c.budget_active_to_month != null &&
    c.budget_active_to_day != null;
  const hasPeriod =
    c.budget_repeats_annually === false &&
    Boolean(c.budget_period_start?.trim()) &&
    Boolean(c.budget_period_end?.trim());
  const limit = hasMd || hasPeriod;
  return {
    limit,
    repeatsAnnually: c.budget_repeats_annually !== false,
    fm: c.budget_active_from_month ?? null,
    fd: c.budget_active_from_day ?? null,
    tm: c.budget_active_to_month ?? null,
    td: c.budget_active_to_day ?? null,
    periodStart: c.budget_period_start?.slice(0, 10) ?? "",
    periodEnd: c.budget_period_end?.slice(0, 10) ?? "",
  };
}

export function buildSeasonMap(cats: CategoryRow[]): Record<string, SeasonDraft> {
  const m: Record<string, SeasonDraft> = {};
  for (const c of cats) {
    m[c.id] = seasonDraftFromCategory(c);
  }
  return m;
}

export function seasonKeyFromCategory(c: CategoryRow): string {
  return [
    c.budget_repeats_annually !== false ? 1 : 0,
    c.budget_active_from_month ?? "",
    c.budget_active_from_day ?? "",
    c.budget_active_to_month ?? "",
    c.budget_active_to_day ?? "",
    c.budget_period_start ?? "",
    c.budget_period_end ?? "",
  ].join(":");
}

export function recurringKeyFromCategory(c: CategoryRow): string {
  return `${c.budget_recurring_payment ? 1 : 0}:${c.budget_recurring_interval ?? ""}`;
}

export function budgetsFromStrings(
  cats: CategoryRow[],
  inputs: Record<string, string>,
): Record<string, number | null> {
  const m: Record<string, number | null> = {};
  for (const c of cats) {
    const raw = inputs[c.id];
    if (raw === undefined || raw.trim() === "") {
      m[c.id] = null;
      continue;
    }
    const n = parseUsdInput(raw);
    m[c.id] = n;
  }
  return m;
}
