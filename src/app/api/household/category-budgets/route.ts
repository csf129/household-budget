import { NextResponse } from "next/server";
import { getHouseholdForUser } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";
import type { BudgetRecurringInterval } from "@/types/finance";

const RECURRING_INTERVALS = new Set<BudgetRecurringInterval>([
  "weekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
]);

type UpdateRow = {
  categoryId?: string;
  monthlyBudget?: number | null;
  budgetAmountPeriod?: "month" | "week" | "year";
  budgetAnnualPaymentMonth?: number | null;
  budgetRepeatsAnnually?: boolean;
  budgetActiveFromMonth?: number | null;
  budgetActiveFromDay?: number | null;
  budgetActiveToMonth?: number | null;
  budgetActiveToDay?: number | null;
  budgetPeriodStart?: string | null;
  budgetPeriodEnd?: string | null;
  budgetRecurringPayment?: boolean;
  budgetRecurringInterval?: BudgetRecurringInterval | null;
};

type Body = {
  updates?: UpdateRow[];
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function normMonth(n: unknown): number | null {
  if (n === null || n === undefined || n === "") return null;
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isInteger(v) || v < 1 || v > 12) return null;
  return v;
}

function normDay(n: unknown): number | null {
  if (n === null || n === undefined || n === "") return null;
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isInteger(v) || v < 1 || v > 31) return null;
  return v;
}

function normIsoDate(s: unknown): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

export async function PATCH(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates = Array.isArray(body.updates) ? body.updates : [];
  if (updates.length === 0) {
    return NextResponse.json({ error: "No updates provided." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) {
    return NextResponse.json({ error: "No household." }, { status: 403 });
  }

  const { data: cats, error: catErr } = await supabase
    .from("categories")
    .select("id")
    .eq("household_id", household.householdId);

  if (catErr) {
    return NextResponse.json({ error: catErr.message }, { status: 500 });
  }

  const allowed = new Set((cats ?? []).map((c) => String(c.id)));

  for (const u of updates) {
    const id =
      typeof u.categoryId === "string" ? u.categoryId.trim() : "";
    if (!id || !allowed.has(id)) {
      return NextResponse.json(
        { error: "Invalid or unknown categoryId in updates." },
        { status: 400 },
      );
    }

    let value: number | null = null;
    if (u.monthlyBudget === null || u.monthlyBudget === undefined) {
      value = null;
    } else if (typeof u.monthlyBudget === "number" && Number.isFinite(u.monthlyBudget)) {
      value = u.monthlyBudget < 0 ? 0 : roundMoney(u.monthlyBudget);
    } else {
      return NextResponse.json(
        { error: "monthlyBudget must be a number or null." },
        { status: 400 },
      );
    }

    const patch: Record<string, unknown> = {
      monthly_budget: value,
    };

    if (
      u.budgetAmountPeriod === "month" ||
      u.budgetAmountPeriod === "week" ||
      u.budgetAmountPeriod === "year"
    ) {
      patch.budget_amount_period = u.budgetAmountPeriod;
    } else if (u.budgetAmountPeriod !== undefined) {
      return NextResponse.json(
        {
          error:
            "budgetAmountPeriod must be 'month', 'week', or 'year'.",
        },
        { status: 400 },
      );
    }

    if (u.budgetAnnualPaymentMonth !== undefined) {
      const am = normMonth(u.budgetAnnualPaymentMonth);
      patch.budget_annual_payment_month = am;
    }

    if (patch.budget_amount_period === "year" && value != null) {
      const am = patch.budget_annual_payment_month as number | null | undefined;
      if (typeof am !== "number" || am < 1 || am > 12) {
        return NextResponse.json(
          {
            error:
              "Annual budgets require budgetAnnualPaymentMonth (1–12) when a yearly amount is set.",
          },
          { status: 400 },
        );
      }
    }

    const hasSeasonPayload =
      u.budgetRepeatsAnnually !== undefined ||
      u.budgetActiveFromMonth !== undefined ||
      u.budgetActiveFromDay !== undefined ||
      u.budgetActiveToMonth !== undefined ||
      u.budgetActiveToDay !== undefined ||
      u.budgetPeriodStart !== undefined ||
      u.budgetPeriodEnd !== undefined;

    if (hasSeasonPayload) {
      const repeats =
        u.budgetRepeatsAnnually === undefined ? true : Boolean(u.budgetRepeatsAnnually);
      patch.budget_repeats_annually = repeats;

      const fm = normMonth(u.budgetActiveFromMonth);
      const fd = normDay(u.budgetActiveFromDay);
      const tm = normMonth(u.budgetActiveToMonth);
      const td = normDay(u.budgetActiveToDay);

      const mdCount = [fm, fd, tm, td].filter((x) => x != null).length;
      if (mdCount !== 0 && mdCount !== 4) {
        return NextResponse.json(
          {
            error:
              "Seasonal budget requires all four: start month/day and end month/day (or leave all blank for no annual season).",
          },
          { status: 400 },
        );
      }

      if (mdCount === 4 && (fm == null || fd == null || tm == null || td == null)) {
        return NextResponse.json(
          { error: "Invalid month/day for seasonal budget." },
          { status: 400 },
        );
      }

      patch.budget_active_from_month = fm;
      patch.budget_active_from_day = fd;
      patch.budget_active_to_month = tm;
      patch.budget_active_to_day = td;

      const ps = normIsoDate(u.budgetPeriodStart);
      const pe = normIsoDate(u.budgetPeriodEnd);
      if (ps && pe && ps.localeCompare(pe) > 0) {
        return NextResponse.json(
          { error: "budgetPeriodStart must be on or before budgetPeriodEnd." },
          { status: 400 },
        );
      }
      patch.budget_period_start = ps;
      patch.budget_period_end = pe;

      if (!repeats) {
        const hasPeriod = Boolean(ps && pe);
        const hasAnnualMd = mdCount === 4;
        if (!hasPeriod && !hasAnnualMd) {
          return NextResponse.json(
            {
              error:
                "Non-repeating budgets need a one-time start and end date, or a full month/day window.",
            },
            { status: 400 },
          );
        }
      }
    }

    if (u.budgetRecurringInterval !== undefined && u.budgetRecurringPayment === undefined) {
      return NextResponse.json(
        {
          error:
            "budgetRecurringInterval cannot be set without budgetRecurringPayment.",
        },
        { status: 400 },
      );
    }

    if (u.budgetRecurringPayment !== undefined) {
      const enabled = Boolean(u.budgetRecurringPayment);
      patch.budget_recurring_payment = enabled;
      if (!enabled) {
        patch.budget_recurring_interval = null;
      } else {
        const iv = u.budgetRecurringInterval;
        if (
          iv === null ||
          iv === undefined ||
          !RECURRING_INTERVALS.has(iv as BudgetRecurringInterval)
        ) {
          return NextResponse.json(
            {
              error:
                "When recurring payment is enabled, budgetRecurringInterval must be weekly, monthly, quarterly, semiannual, or annual.",
            },
            { status: 400 },
          );
        }
        patch.budget_recurring_interval = iv;
      }
    }

    const { error: upErr } = await supabase
      .from("categories")
      .update(patch)
      .eq("id", id)
      .eq("household_id", household.householdId);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ saved: updates.length });
}
