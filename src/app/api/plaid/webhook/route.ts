import { NextResponse } from "next/server";
import { createPlaidClient } from "@/lib/plaid-server";
import { verifyPlaidWebhook } from "@/lib/plaid-webhook-verify";
import { syncPlaidTransactionsForConnection } from "@/lib/plaid-sync";
import { autoCategorizeUncategorizedForHousehold } from "@/lib/auto-categorize-household";
import { getHouseholdAiModel } from "@/lib/get-household-ai-model";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

/**
 * Plaid webhooks (e.g. SYNC_UPDATES_AVAILABLE). Authenticated via the signed
 * `Plaid-Verification` JWT — we read the raw body, verify the signature and the
 * body hash, and reject anything unverified before doing any work.
 * @see https://plaid.com/docs/api/webhooks/webhook-verification/
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  let plaid;
  try {
    plaid = createPlaidClient();
  } catch (e) {
    console.error("plaid webhook: client init", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const verified = await verifyPlaidWebhook(
    plaid,
    request.headers.get("plaid-verification"),
    rawBody,
  );
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: { item_id?: string; webhook_type?: string; webhook_code?: string };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const itemId = typeof payload.item_id === "string" ? payload.item_id : null;
  if (!itemId) {
    return NextResponse.json({ ok: true });
  }

  if (payload.webhook_type !== "TRANSACTIONS") {
    return NextResponse.json({ ok: true });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    console.error("plaid webhook: admin client", e);
    return NextResponse.json({ ok: true });
  }

  const { data: row } = await admin
    .from("bank_connections")
    .select("id, household_id")
    .eq("plaid_item_id", itemId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await syncPlaidTransactionsForConnection(
      admin,
      plaid,
      row.id,
      row.household_id,
      // Stay under the platform timeout; Plaid re-delivers/So the next webhook
      // (or the daily cron) resumes any remaining backfill from the saved cursor.
      { deadlineMs: 50_000 },
    );

    // AI-categorize the rows this sync just imported (only those no
    // deterministic rule already claimed), so transactions arrive already
    // categorized rather than waiting for the daily cron. Best-effort: a
    // missing AI key or model error must never fail the webhook — the
    // transactions are already saved.
    if (result.upserted + result.ledger_replaced > 0) {
      try {
        const modelId = await getHouseholdAiModel(admin, row.household_id);
        await autoCategorizeUncategorizedForHousehold(
          admin,
          row.household_id,
          modelId,
        );
      } catch (e) {
        console.warn("[plaid] webhook auto-categorize (non-fatal)", itemId, e);
      }
    }
  } catch (e) {
    console.error("plaid webhook sync", itemId, e);
  }

  return NextResponse.json({ ok: true });
}
