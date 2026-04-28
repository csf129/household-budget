import { NextResponse } from "next/server";
import { createPlaidClient } from "@/lib/plaid-server";
import { syncPlaidTransactionsForConnection } from "@/lib/plaid-sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

/**
 * Plaid webhooks (e.g. SYNC_UPDATES_AVAILABLE). No JWT: verify Plaid-Signature in production.
 * @see https://plaid.com/docs/api/webhooks/webhook-verification/
 */
export async function POST(request: Request) {
  let payload: { item_id?: string; webhook_type?: string; webhook_code?: string };
  try {
    payload = (await request.json()) as typeof payload;
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
    const plaid = createPlaidClient();
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
