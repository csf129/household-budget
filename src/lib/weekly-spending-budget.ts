import type { CategoryRow } from "@/types/finance";
import { budgetDailyPortionForDate } from "@/lib/category-budget-season";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toIsoDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function parseIsoDateParts(iso: string): {
  y: number;
  m: number;
  d: number;
} {
  const [ys, ms, ds] = iso
    .slice(0, 10)
    .split("-")
    .map((x) => Number.parseInt(x, 10));
  return { y: ys, m: ms, d: ds };
}

export function addCalendarDays(iso: string, delta: number): string {
  const { y, m, d } = parseIsoDateParts(iso);
  const dt = new Date(y, m - 1, d + delta);
  return toIsoDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

export function compareIso(a: string, b: string): number {
  return a.localeCompare(b);
}

export function daysInCalendarMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/**
 * First day of the budget week that contains `iso` (local calendar).
 * `weekStartsOn`: 0 = Sunday … 6 = Saturday (same as `Date#getDay()`).
 */
export function startOfWeekContaining(
  iso: string,
  weekStartsOn: number,
): string {
  const { y, m, d } = parseIsoDateParts(iso);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  const offset = (dow - weekStartsOn + 7) % 7;
  return addCalendarDays(iso, -offset);
}

function formatWeekRangeLabel(start: string, end: string): string {
  const a = parseIsoDateParts(start);
  const b = parseIsoDateParts(end);
  const ds = new Date(a.y, a.m - 1, a.d);
  const de = new Date(b.y, b.m - 1, b.d);
  const left = ds.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const right = de.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${left} – ${right}`;
}

/** True when [start,end] is exactly one calendar month (start = 1st, end = last day). */
export function isSingleCalendarMonthRange(
  start: string,
  end: string,
): boolean {
  const { y: ys, m: ms, d: ds } = parseIsoDateParts(start);
  const { y: ye, m: me, d: de } = parseIsoDateParts(end);
  if (ys !== ye || ms !== me) return false;
  if (ds !== 1) return false;
  const last = daysInCalendarMonth(ys, ms);
  return de === last;
}

/** Rough sum of entered targets as approximate monthly equivalents. */
export function totalMonthlyCategoryBudget(categories: CategoryRow[]): number {
  let s = 0;
  for (const c of categories) {
    if (c.monthly_budget == null || !Number.isFinite(c.monthly_budget)) continue;
    if (c.budget_amount_period === "week") {
      s += (c.monthly_budget * 52) / 12;
    } else if (c.budget_amount_period === "year") {
      s += c.monthly_budget / 12;
    } else {
      s += c.monthly_budget;
    }
  }
  return s;
}

export type WeekSliceMeta = {
  weekStart: string;
  weekEnd: string;
  label: string;
};

/**
 * Mon–Sun (or custom week start) slices that overlap a calendar month.
 */
export function listWeekSlicesInMonth(
  monthStartIso: string,
  monthEndIso: string,
  weekStartsOn: number,
): WeekSliceMeta[] {
  const rows: WeekSliceMeta[] = [];
  let ws = startOfWeekContaining(monthStartIso, weekStartsOn);

  while (true) {
    const we = addCalendarDays(ws, 6);
    if (compareIso(we, monthStartIso) < 0) {
      ws = addCalendarDays(ws, 7);
      continue;
    }
    if (compareIso(ws, monthEndIso) > 0) break;

    rows.push({
      weekStart: ws,
      weekEnd: we,
      label: formatWeekRangeLabel(ws, we),
    });

    ws = addCalendarDays(ws, 7);
    if (compareIso(ws, monthEndIso) > 0) break;
  }

  return rows;
}

/** Today's calendar date in local time as `YYYY-MM-DD`. */
export function getTodayIsoDateLocal(): string {
  const n = new Date();
  return toIsoDate(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/**
 * Prefer the week slice that contains `todayIso`; if today falls outside the
 * month’s slices (e.g. viewing another month), use the first or last slice as a boundary fallback.
 */
export function pickDefaultWeekSliceForToday(
  weekSlices: WeekSliceMeta[],
  todayIso: string,
): string | null {
  if (weekSlices.length === 0) return null;
  const containing = weekSlices.find(
    (w) =>
      compareIso(w.weekStart, todayIso) <= 0 &&
      compareIso(todayIso, w.weekEnd) <= 0,
  );
  if (containing) return containing.weekStart;

  const first = weekSlices[0]!;
  const last = weekSlices[weekSlices.length - 1]!;
  if (compareIso(todayIso, first.weekStart) < 0) return first.weekStart;
  if (compareIso(todayIso, last.weekEnd) > 0) return last.weekStart;

  return last.weekStart;
}

/**
 * Full 7-day budget for one category for the week beginning `weekStart`.
 * Each calendar day uses that day’s month length: monthlyBudget / daysInMonth(day).
 */
export function budgetPortionForCategoryFullWeek(
  categoryMonthlyBudget: number,
  weekStart: string,
): number {
  if (!Number.isFinite(categoryMonthlyBudget) || categoryMonthlyBudget <= 0) {
    return 0;
  }
  let portion = 0;
  for (let i = 0; i < 7; i++) {
    const day = addCalendarDays(weekStart, i);
    const { y: dy, m: dm } = parseIsoDateParts(day);
    const ddim = daysInCalendarMonth(dy, dm);
    if (ddim > 0) {
      portion += categoryMonthlyBudget / ddim;
    }
  }
  return portion;
}

/** Like `budgetPortionForCategoryFullWeek`, but skips days outside the category’s budget timeframe. */
export function budgetPortionForCategoryFullWeekWithSeason(
  cat: CategoryRow,
  weekStart: string,
): number {
  let portion = 0;
  for (let i = 0; i < 7; i++) {
    const day = addCalendarDays(weekStart, i);
    portion += budgetDailyPortionForDate(cat, day);
  }
  return portion;
}
