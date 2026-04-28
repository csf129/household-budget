import { daysBetweenStartAndEndExclusive } from "@/lib/savings-plan-math";
import {
  addDays,
  parseISODateLocal,
  startOfDayLocal,
} from "@/lib/savings-plan-schedule";

/**
 * Even split of remaining balance across full weeks until target date (per plan).
 * Overdue plans (target in the past) return the full remaining amount as urgency.
 */
export function weeklyPaceNeededUsd(plan: {
  target_amount: number;
  total_saved: number;
  target_date: string;
  is_archived: boolean;
}): number {
  if (plan.is_archived) return 0;
  const left = Math.max(0, plan.target_amount - plan.total_saved);
  if (left <= 0) return 0;
  const today = startOfDayLocal(new Date());
  const end = startOfDayLocal(parseISODateLocal(plan.target_date));
  const days = daysBetweenStartAndEndExclusive(today, end);
  if (days <= 0) return left;
  const weeks = Math.max(1, Math.ceil(days / 7));
  return left / weeks;
}

export function totalSuggestedWeeklyPaceUsd(
  plans: ReadonlyArray<{
    target_amount: number;
    total_saved: number;
    target_date: string;
    is_archived: boolean;
  }>,
): number {
  return plans
    .filter((p) => !p.is_archived)
    .reduce((s, p) => s + weeklyPaceNeededUsd(p), 0);
}

/** Sum of contribution amounts with `contributed_on` in the last `numDays` calendar days (inclusive of today). */
export function contributionsTotalInRollingDays(
  contributions: ReadonlyArray<{ amount: number; contributed_on: string }>,
  numDays: number,
): number {
  if (numDays < 1) return 0;
  const today = startOfDayLocal(new Date());
  const start = addDays(today, -(numDays - 1));
  let sum = 0;
  for (const c of contributions) {
    const cd = startOfDayLocal(parseISODateLocal(c.contributed_on));
    if (cd >= start && cd <= today) sum += c.amount;
  }
  return sum;
}
