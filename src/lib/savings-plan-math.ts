import type { SavingsIncrementPeriod } from "@/types/finance";
import {
  countInstallmentsThroughDate,
  parseISODateLocal,
  startOfDayLocal,
} from "@/lib/savings-plan-schedule";

function daysInclusiveSpan(start: Date, end: Date): number {
  const a = startOfDayLocal(start).getTime();
  const b = startOfDayLocal(end).getTime();
  if (b < a) return 0;
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** Whole calendar days from start (inclusive) to end (exclusive), floored. */
export function daysBetweenStartAndEndExclusive(start: Date, end: Date): number {
  const a = startOfDayLocal(start).getTime();
  const b = startOfDayLocal(end).getTime();
  return Math.floor((b - a) / 86_400_000);
}

/**
 * How much you’d expect to have set aside by `asOf` if you stayed on pace.
 * Recurring: one installment on the start date and every period after that.
 * Otherwise linear over the full date span (inclusive).
 */
export function expectedSavedByDate(
  targetAmount: number,
  startDateIso: string,
  targetDateIso: string,
  incrementAmount: number | null,
  incrementPeriod: SavingsIncrementPeriod | null,
  asOf: Date = new Date(),
): number {
  const start = parseISODateLocal(startDateIso);
  const end = parseISODateLocal(targetDateIso);
  const today = startOfDayLocal(asOf);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (today < start) return 0;
  const horizon = today < end ? today : end;
  if (
    incrementAmount != null &&
    incrementPeriod != null &&
    incrementAmount > 0
  ) {
    const periods = countInstallmentsThroughDate(
      startDateIso,
      incrementPeriod,
      horizon,
    );
    return Math.min(targetAmount, periods * incrementAmount);
  }
  const totalInclusive = Math.max(1, daysInclusiveSpan(start, end));
  const elapsedInclusive = Math.max(0, daysInclusiveSpan(start, horizon));
  const pace = Math.min(1, elapsedInclusive / totalInclusive);
  return Math.min(targetAmount, targetAmount * pace);
}

export function formatPlanDateRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const a = parseISODateLocal(startIso);
  const b = parseISODateLocal(endIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "—";
  return `${a.toLocaleDateString("en-US", opts)} → ${b.toLocaleDateString("en-US", opts)}`;
}
