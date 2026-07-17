import {
  addCalendarMonths,
  addDays,
  nthInstallmentDate,
  parseISODateLocal,
  startOfDayLocal,
} from "@/lib/savings-plan-schedule";
import type { SavingsPlanWithProgress } from "@/types/finance";
import type { SavingsIncrementPeriod } from "@/types/finance";

export type ProjectionGranularity = "weekly" | "monthly" | "quarterly" | "annual";

export type ProjectionLine = {
  bucketKey: string;
  bucketLabel: string;
  total: number;
  byPlanId: Record<string, number>;
};

type Event = { date: Date; planId: string; amount: number };

function maxDate(a: Date, b: Date): Date {
  return a >= b ? a : b;
}

function firstOfMonth(d: Date): Date {
  return startOfDayLocal(new Date(d.getFullYear(), d.getMonth(), 1));
}

function startOfWeekSunday(d: Date): Date {
  const x = startOfDayLocal(d);
  return addDays(x, -x.getDay());
}

function monthsOverlappingRange(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  let cur = firstOfMonth(from);
  const end = startOfDayLocal(to);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = cur.getMonth();
    const monthEnd = new Date(y, m + 1, 0);
    if (monthEnd >= from && cur <= end) out.push(startOfDayLocal(cur));
    cur = addCalendarMonths(cur, 1);
  }
  return out;
}

export function bucketKeyForDate(d: Date, g: ProjectionGranularity): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (g === "annual") return String(y);
  if (g === "quarterly") {
    const q = Math.floor((m - 1) / 3) + 1;
    return `${y}-Q${q}`;
  }
  if (g === "monthly") {
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  const wk = startOfWeekSunday(d);
  return `${wk.getFullYear()}-${String(wk.getMonth() + 1).padStart(2, "0")}-${String(wk.getDate()).padStart(2, "0")}`;
}

export function formatProjectionBucketLabel(
  key: string,
  g: ProjectionGranularity,
): string {
  if (g === "annual") return key;
  if (g === "quarterly") {
    const parts = key.split("-Q");
    if (parts.length === 2) return `Q${parts[1]} ${parts[0]}`;
    return key;
  }
  if (g === "monthly") {
    const [ys, ms] = key.split("-");
    const y = Number(ys);
    const m = Number(ms);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return key;
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  const [ys, ms, ds] = key.split("-");
  const y = Number(ys);
  const mo = Number(ms);
  const day = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day))
    return key;
  const dt = new Date(y, mo - 1, day);
  return `Week of ${dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function collectRecurringEvents(
  plan: SavingsPlanWithProgress,
  planStart: Date,
  planEnd: Date,
  rangeStart: Date,
  rangeEnd: Date,
  incrementAmount: number,
  period: SavingsIncrementPeriod,
): Event[] {
  if (plan.target_amount <= 0) return [];
  const rs = startOfDayLocal(rangeStart);
  const re = startOfDayLocal(rangeEnd);
  // Track total scheduled (based on plan schedule only, not actual savings)
  let scheduled = 0;
  const events: Event[] = [];
  for (let n = 0; n < 500_000; n++) {
    const d = nthInstallmentDate(planStart, period, n);
    if (d > planEnd || d > re) break;
    if (scheduled >= plan.target_amount) break;
    const amt = Math.min(incrementAmount, plan.target_amount - scheduled);
    scheduled += amt;
    if (d >= rs) {
      events.push({ date: d, planId: plan.id, amount: amt });
    }
  }
  return events;
}

function collectLinearEvents(
  plan: SavingsPlanWithProgress,
  planStart: Date,
  planEnd: Date,
  rangeStart: Date,
  rangeEnd: Date,
): Event[] {
  if (plan.target_amount <= 0) return [];
  const rs = startOfDayLocal(rangeStart);
  const re = startOfDayLocal(rangeEnd);

  // Fixed per-month amount spread evenly across the full plan duration —
  // independent of total_saved so the projected schedule stays constant.
  const allPlanMonths = monthsOverlappingRange(planStart, planEnd);
  if (allPlanMonths.length === 0) return [];
  const perMonth = plan.target_amount / allPlanMonths.length;

  const events: Event[] = [];
  for (const ms of allPlanMonths) {
    if (ms >= rs && ms <= re) {
      events.push({ date: ms, planId: plan.id, amount: perMonth });
    }
  }
  return events;
}

function collectPlanEvents(
  plan: SavingsPlanWithProgress,
  rangeStart: Date,
  rangeEnd: Date,
): Event[] {
  if (!plan.include_in_projection || plan.is_archived) return [];

  const planStart = parseISODateLocal(plan.start_date);
  const planEnd = parseISODateLocal(plan.target_date);
  if (Number.isNaN(planStart.getTime()) || Number.isNaN(planEnd.getTime()))
    return [];

  if (
    plan.increment_amount != null &&
    plan.increment_period != null &&
    plan.increment_amount > 0
  ) {
    return collectRecurringEvents(
      plan,
      planStart,
      planEnd,
      rangeStart,
      rangeEnd,
      plan.increment_amount,
      plan.increment_period,
    );
  }

  return collectLinearEvents(
    plan,
    planStart,
    planEnd,
    rangeStart,
    rangeEnd,
  );
}

export function buildSavingsProjection(
  plans: SavingsPlanWithProgress[],
  granularity: ProjectionGranularity,
  rangeStart: Date,
  rangeEnd: Date,
): ProjectionLine[] {
  const rs = startOfDayLocal(rangeStart);
  const re = startOfDayLocal(rangeEnd);
  const all: Event[] = [];
  for (const p of plans) {
    all.push(...collectPlanEvents(p, rs, re));
  }

  const map = new Map<string, { total: number; byPlanId: Record<string, number> }>();
  for (const e of all) {
    const key = bucketKeyForDate(e.date, granularity);
    let row = map.get(key);
    if (!row) {
      row = { total: 0, byPlanId: {} };
      map.set(key, row);
    }
    row.total += e.amount;
    row.byPlanId[e.planId] = (row.byPlanId[e.planId] ?? 0) + e.amount;
  }

  const keys = [...map.keys()].sort();
  return keys.map((bucketKey) => {
    const row = map.get(bucketKey)!;
    return {
      bucketKey,
      bucketLabel: formatProjectionBucketLabel(bucketKey, granularity),
      total: row.total,
      byPlanId: row.byPlanId,
    };
  });
}
