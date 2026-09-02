import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createHearthAdminClient } from "@/lib/hearth-client";
import { computeHearthRollup } from "@/lib/hearth-rollup";
import { pushHearthRollup } from "@/lib/push-hearth-rollup";

/**
 * Push the budget rollup into the family's Hearth calendar.
 *
 * Runs on a Vercel Cron a few times a day (see vercel.json) and can be invoked
 * by hand with the same `CRON_SECRET` bearer token. It reads this household's
 * categories and transactions with the service-role client, derives the
 * aggregate rollup (computeHearthRollup — the only thing that leaves this app),
 * and writes it into Hearth with Hearth's service-role client.
 *
 * Which household maps to which is one pair of env vars:
 *   BUDGET_HOUSEHOLD_ID  — the household here to summarise
 *   HEARTH_HOUSEHOLD_ID  — the Hearth household to write it to
 * Everything else stays out of Hearth: no accounts, no Plaid, no transactions.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const budgetHouseholdId = process.env.BUDGET_HOUSEHOLD_ID?.trim();
  const hearthHouseholdId = process.env.HEARTH_HOUSEHOLD_ID?.trim();
  if (!budgetHouseholdId || !hearthHouseholdId) {
    return NextResponse.json(
      { error: "Set BUDGET_HOUSEHOLD_ID and HEARTH_HOUSEHOLD_ID." },
      { status: 500 },
    );
  }

  try {
    const admin = createSupabaseAdminClient();
    const rollup = await computeHearthRollup(admin, budgetHouseholdId);

    const hearth = createHearthAdminClient();
    await pushHearthRollup(hearth, hearthHouseholdId, rollup);

    return NextResponse.json({
      ok: true,
      as_of: rollup.as_of,
      week: { budget: rollup.week.budget, spent: rollup.week.spent },
      month: { budget: rollup.month.budget, spent: rollup.month.spent },
      categories: rollup.categories.length,
      trend_months: rollup.trend.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
