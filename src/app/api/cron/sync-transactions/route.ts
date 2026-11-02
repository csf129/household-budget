import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createPlaidClient } from "@/lib/plaid-server";
import { syncAllActivePlaidConnectionsForHousehold } from "@/lib/plaid-sync";
import { autoCategorizeUncategorizedForHousehold } from "@/lib/auto-categorize-household";
import { getHouseholdAiModel } from "@/lib/get-household-ai-model";

/**
 * Daily transaction refresh for every household with an active bank
 * connection, followed by AI categorization of whatever was imported.
 *
 * The Plaid webhook is the primary, real-time sync trigger; this cron is the
 * once-a-day guarantee that transactions stay current even if webhook
 * deliveries are dropped or rejected. Unlike the Hearth cron, it is not gated
 * on any Hearth configuration and covers all households, not a single
 * BUDGET_HOUSEHOLD_ID.
 *
 * Runs on a Vercel Cron (see vercel.json) and can be invoked by hand with the
 * same CRON_SECRET bearer token. For each household it syncs all active
 * connections (cursor-based, so overlap with the webhook is a cheap no-op),
 * then AI-categorizes rows no deterministic rule already claimed. Categorizing
 * is best-effort per household: a missing AI key or model error must never
 * fail the sync — the transactions are already saved.
 */
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server misconfiguration.";
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  let plaid;
  try {
    plaid = createPlaidClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Plaid client unavailable.";
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  // Distinct households that have at least one active connection to sync.
  const { data: connRows, error: connErr } = await admin
    .from("bank_connections")
    .select("household_id")
    .eq("status", "active");
  if (connErr) {
    return NextResponse.json({ error: connErr.message }, { status: 500 });
  }

  const householdIds = Array.from(
    new Set((connRows ?? []).map((r) => String(r.household_id))),
  );

  // Split the function's time budget across households so one slow household
  // can't starve the rest; the next daily run (or the webhook) resumes any
  // remaining backfill from each connection's saved cursor.
  const startedAt = Date.now();
  const budgetMs = 100_000; // headroom under the 120s function cap
  const results: Array<Record<string, unknown>> = [];

  for (const householdId of householdIds) {
    const remaining = budgetMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      results.push({ householdId, skipped: true, reason: "time-budget" });
      continue;
    }
    const perHouseholdMs = Math.max(
      10_000,
      Math.floor(remaining / Math.max(1, householdIds.length - results.length)),
    );

    try {
      const sync = await syncAllActivePlaidConnectionsForHousehold(
        admin,
        plaid,
        householdId,
        { deadlineMs: perHouseholdMs },
      );

      // AI-categorize whatever this sync imported. Best-effort: never fail the
      // sync over a missing AI key or model error.
      let categorized = 0;
      if (sync.upserted + sync.ledger_replaced > 0) {
        try {
          const modelId = await getHouseholdAiModel(admin, householdId);
          const r = await autoCategorizeUncategorizedForHousehold(
            admin,
            householdId,
            modelId,
          );
          categorized = r.updated;
        } catch (e) {
          console.warn(
            "[cron] sync-transactions: auto-categorize failed (non-fatal)",
            householdId,
            e,
          );
        }
      }

      results.push({ householdId, ...sync, categorized });
    } catch (e) {
      console.error("[cron] sync-transactions: sync failed", householdId, e);
      results.push({
        householdId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    households: householdIds.length,
    results,
  });
}
