/** localStorage key for week start (0 = Sunday … 6 = Saturday). */
export const BUDGET_WEEK_START_STORAGE_KEY = "household-budget-week-starts-on";

/** Default: Monday-start weeks (Mon–Sun). */
export const DEFAULT_BUDGET_WEEK_START_DAY = 1;

export function clampWeekStartDay(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_BUDGET_WEEK_START_DAY;
  const x = Math.floor(n);
  if (x < 0 || x > 6) return DEFAULT_BUDGET_WEEK_START_DAY;
  return x;
}

export const WEEK_START_DAY_LABELS: { value: number; label: string }[] = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];
