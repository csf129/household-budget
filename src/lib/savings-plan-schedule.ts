import type { SavingsIncrementPeriod } from "@/types/finance";

export function parseISODateLocal(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map((x) => Number.parseInt(x, 10));
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

export function startOfDayLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const x = startOfDayLocal(d);
  x.setDate(x.getDate() + n);
  return startOfDayLocal(x);
}

/** Add calendar months preserving day-of-month when possible (e.g. Jan 31 → Feb 28). */
export function addCalendarMonths(d: Date, delta: number): Date {
  let x = startOfDayLocal(d);
  const step = delta >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(delta); i++) {
    const y = x.getFullYear();
    const m = x.getMonth();
    const day = x.getDate();
    const nm = m + step;
    const ny = y + Math.floor(nm / 12);
    const mm = ((nm % 12) + 12) % 12;
    const last = new Date(ny, mm + 1, 0).getDate();
    x = new Date(ny, mm, Math.min(day, last));
  }
  return startOfDayLocal(x);
}

export function addCalendarYears(d: Date, delta: number): Date {
  return addCalendarMonths(d, 12 * delta);
}

/** Nth installment date (0 = first payment on plan start date). */
export function nthInstallmentDate(
  planStart: Date,
  period: SavingsIncrementPeriod,
  n: number,
): Date {
  const base = startOfDayLocal(planStart);
  switch (period) {
    case "daily":
      return addDays(base, n);
    case "weekly":
      return addDays(base, 7 * n);
    case "biweekly":
      return addDays(base, 14 * n);
    case "monthly":
      return addCalendarMonths(base, n);
    case "annually":
      return addCalendarYears(base, n);
    default:
      return base;
  }
}

/**
 * Count installment dates from plan start through horizon (inclusive calendar days).
 */
export function countInstallmentsThroughDate(
  planStartIso: string,
  period: SavingsIncrementPeriod,
  horizon: Date,
): number {
  const start = parseISODateLocal(planStartIso);
  const h = startOfDayLocal(horizon);
  if (Number.isNaN(start.getTime()) || h < start) return 0;
  let count = 0;
  for (let n = 0; n < 200_000; n++) {
    const d = nthInstallmentDate(start, period, n);
    if (d > h) break;
    count++;
  }
  return count;
}
