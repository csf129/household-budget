import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createHearthAdminClient } from "@/lib/hearth-client";
import { computeHearthRollup } from "@/lib/hearth-rollup";
import { pushHearthRollup } from "@/lib/push-hearth-rollup";
import { createPlaidClient } from "@/lib/plaid-server";
import { syncAllActivePlaidConnectionsForHousehold } from "@/lib/plaid-sync";
import { autoCategorizeUncategorizedForHousehold } from "@/lib/auto-categorize-household";
import { getHouseholdAiModel } from "@/lib/get-household-ai-model";

/**
 * Daily maintenance: refresh Plaid transactions, then push the budget rollup
 * into the family's Hearth calendar.
 *
 * Runs once a day on a Vercel Cron (see vercel.json) and can be invoked by hand
 * with the same `CRON_SECRET` bearer token. It first runs a safety-net Plaid
 * sync for this household's active connections (the webhook is the primary
 * trigger; this backfills dropped/rejected deliveries), then reads categories
 * and transactions with the service-role client, derives the aggregate rollup
 * (computeHearthRollup — the only thing that leaves this app), and writes it
 * into Hearth with Hearth's service-role client.
 *
 * Which household maps to which is one pair of env vars:
 *   BUDGET_HOUSEHOLD_ID  — the household here to summarise
 *   HEARTH_HOUSEHOLD_ID  — the Hearth household to write it to
 * Nothing but the aggregate rollup ever leaves for Hearth: the Plaid sync only
 * writes into this app's own tables; no accounts or transactions go to Hearth.
 */
export const maxDuration = 120;

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

    // Safety net: the Plaid webhook is the primary sync trigger, but if a
    // delivery is dropped or rejected, transactions would silently stop
    // arriving. Backfill active connections once a day here so the rollup below
    // reflects fresh data. Non-fatal — a Plaid failure must not block Hearth.
    let plaidSync: Awaited<
      ReturnType<typeof syncAllActivePlaidConnectionsForHousehold>
    > | null = null;
    try {
      const plaid = createPlaidClient();
      plaidSync = await syncAllActivePlaidConnectionsForHousehold(
        admin,
        plaid,
        budgetHouseholdId,
        // Leave headroom under the 60s function cap for the Hearth rollup+push
        // below; any remaining backfill resumes on the next run.
        { deadlineMs: 40_000 },
      );
    } catch (e) {
      console.error("[cron] hearth-sync: Plaid safety-net sync failed", e);
    }

    // AI-categorize anything still uncategorized (e.g. rows imported overnight
    // by a Plaid webhook, which does not run the categorizer itself). Runs
    // before the rollup so the summary reflects fresh categories. Best-effort:
    // a missing AI key or model error must not block the Hearth push below.
    let categorized = 0;
    try {
      const modelId = await getHouseholdAiModel(admin, budgetHouseholdId);
      const r = await autoCategorizeUncategorizedForHousehold(
        admin,
        budgetHouseholdId,
        modelId,
      );
      categorized = r.updated;
    } catch (e) {
      console.warn("[cron] hearth-sync: auto-categorize failed (non-fatal)", e);
    }

    const rollup = await computeHearthRollup(admin, budgetHouseholdId);

    const hearth = createHearthAdminClient();
    await pushHearthRollup(hearth, hearthHouseholdId, rollup);

    return NextResponse.json({
      ok: true,
      plaid_sync: plaidSync,
      categorized,
      as_of: rollup.as_of,
      week: { budget: rollup.week.budget, spent: rollup.week.spent },
      month: { budget: rollup.month.budget, spent: rollup.month.spent },
      categories: rollup.categories.length,
      trend_months: rollup.trend.length,
      accounts: rollup.accounts.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
