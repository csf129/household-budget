import { NextResponse } from "next/server";
import { createPlaidClient } from "@/lib/plaid-server";
import { verifyPlaidWebhook } from "@/lib/plaid-webhook-verify";
import { syncPlaidTransactionsForConnection } from "@/lib/plaid-sync";
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
    await syncPlaidTransactionsForConnection(
      admin,
      plaid,
      row.id,
      row.household_id,
    );
  } catch (e) {
    console.error("plaid webhook sync", itemId, e);
  }

  return NextResponse.json({ ok: true });
}
