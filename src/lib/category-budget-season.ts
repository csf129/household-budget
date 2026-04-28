import type { CategoryRow } from "@/types/finance";

function parseIsoDateParts(iso: string): { y: number; m: number; d: number } {
  const [ys, ms, ds] = iso
    .slice(0, 10)
    .split("-")
    .map((x) => Number.parseInt(x, 10));
  return { y: ys, m: ms, d: ds };
}

function daysInCalendarMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function compareIso(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Month/day as a single comparable key within a synthetic year (not for cross-year ordering of seasons). */
function mdKey(m: number, d: number): number {
  return m * 100 + d;
}

export function hasAnnualSeasonMonthDayBounds(c: CategoryRow): boolean {
  return (
    c.budget_active_from_month != null &&
    c.budget_active_from_day != null &&
    c.budget_active_to_month != null &&
    c.budget_active_to_day != null
  );
}

/**
 * Whether `iso` (YYYY-MM-DD) falls in the annual month/day window (supports ranges that wrap the year, e.g. Sep–May).
 */
export function isDateInAnnualBudgetSeason(
  iso: string,
  fromMonth: number,
  fromDay: number,
  toMonth: number,
  toDay: number,
): boolean {
  const { m, d } = parseIsoDateParts(iso);
  const cur = mdKey(m, d);
  const start = mdKey(fromMonth, fromDay);
  const end = mdKey(toMonth, toDay);
  if (start <= end) {
    return cur >= start && cur <= end;
  }
  return cur >= start || cur <= end;
}

function isDateInOneTimeBudgetPeriod(
  iso: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end) return true;
  return compareIso(iso, start) >= 0 && compareIso(iso, end) <= 0;
}

/**
 * True when the category's budget applies on this calendar day (ignores monthly_budget amount).
 */
export function isCategoryBudgetActiveOnDate(c: CategoryRow, iso: string): boolean {
  if (c.budget_repeats_annually === false) {
    const start = c.budget_period_start?.trim() ?? null;
    const end = c.budget_period_end?.trim() ?? null;
    if (start && end) {
      return isDateInOneTimeBudgetPeriod(iso, start, end);
    }
    if (hasAnnualSeasonMonthDayBounds(c)) {
      return isDateInAnnualBudgetSeason(
        iso,
        c.budget_active_from_month!,
        c.budget_active_from_day!,
        c.budget_active_to_month!,
        c.budget_active_to_day!,
      );
    }
    return true;
  }

  if (hasAnnualSeasonMonthDayBounds(c)) {
    return isDateInAnnualBudgetSeason(
      iso,
      c.budget_active_from_month!,
      c.budget_active_from_day!,
      c.budget_active_to_month!,
      c.budget_active_to_day!,
    );
  }
  return true;
}

/**
 * Budget allocation for one calendar day when the category is in-season.
 * Monthly: amount ÷ days in month. Weekly: amount ÷ 7. Year: annual amount ÷ days in payment month only.
 */
export function budgetDailyPortionForDate(c: CategoryRow, iso: string): number {
  const mb = c.monthly_budget;
  if (mb == null || !Number.isFinite(mb) || mb <= 0) return 0;
  if (!isCategoryBudgetActiveOnDate(c, iso)) return 0;
  if (c.budget_amount_period === "week") {
    return mb / 7;
  }
  if (c.budget_amount_period === "year") {
    const pm = c.budget_annual_payment_month;
    if (pm == null || pm < 1 || pm > 12) return 0;
    const { y, m } = parseIsoDateParts(iso);
    if (m !== pm) return 0;
    const ddim = daysInCalendarMonth(y, m);
    if (ddim <= 0) return 0;
    return mb / ddim;
  }
  const { y, m } = parseIsoDateParts(iso);
  const ddim = daysInCalendarMonth(y, m);
  if (ddim <= 0) return 0;
  return mb / ddim;
}

/**
 * Expected budget for this category in a calendar month (sum of daily portions), or null if none.
 */
export function effectiveMonthlyBudgetForCalendarMonth(
  c: CategoryRow,
  year: number,
  month: number,
): number | null {
  const mb = c.monthly_budget;
  if (mb == null || !Number.isFinite(mb) || mb <= 0) return null;
  const dim = daysInCalendarMonth(year, month);
  let sum = 0;
  for (let d = 1; d <= dim; d++) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    sum += budgetDailyPortionForDate(c, iso);
  }
  return sum > 0 ? sum : null;
}

/** Sum of `monthly_budget` for categories that have any active day in this calendar month. */
export function totalEffectiveMonthlyBudgetForCalendarMonth(
  categories: CategoryRow[],
  year: number,
  month: number,
): number {
  let s = 0;
  for (const c of categories) {
    const v = effectiveMonthlyBudgetForCalendarMonth(c, year, month);
    if (v != null && Number.isFinite(v)) s += v;
  }
  return s;
}

/**
 * Sum of prorated monthly budgets for each calendar month from `rangeStart` through `rangeEnd` (inclusive).
 */
export function effectiveMonthlyBudgetForDateRange(
  c: CategoryRow,
  rangeStart: string,
  rangeEnd: string,
): number | null {
  const mb = c.monthly_budget;
  if (mb == null || !Number.isFinite(mb)) return null;

  const { y: ys, m: ms } = parseIsoDateParts(rangeStart);
  const { y: ye, m: me } = parseIsoDateParts(rangeEnd);

  let y = ys;
  let m = ms;
  let total = 0;
  let any = false;

  for (;;) {
    const part = effectiveMonthlyBudgetForCalendarMonth(c, y, m);
    if (part != null) {
      total += part;
      any = true;
    }
    if (y === ye && m === me) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  return any ? total : null;
}
