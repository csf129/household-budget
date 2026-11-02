import { NextResponse } from "next/server";
import { decryptPlaidAccessToken } from "@/lib/plaid-token-crypto";
import { requireHouseholdHead } from "@/lib/api-auth";
import { createPlaidClient } from "@/lib/plaid-server";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

type Body = { bank_connection_id?: string };

/**
 * Soft-remove a bank connection: mark it `removed` so sync skips it and revoke
 * the Plaid item. This is NOT a hard delete — bank_accounts and the imported
 * transactions both cascade-delete from bank_connections, so deleting the row
 * would wipe the household's history. We keep all of that and only stop syncing.
 */
export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const connectionId =
    typeof body.bank_connection_id === "string"
      ? body.bank_connection_id.trim()
      : "";
  if (!connectionId) {
    return NextResponse.json(
      { error: "Missing bank_connection_id." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const auth = await requireHouseholdHead(supabase);
  if (auth instanceof NextResponse) return auth;
  const { household } = auth;

  const admin = createSupabaseAdminClient();

  // Scope to the caller's household before touching anything (RLS does not
  // cover the admin client).
  const { data: conn, error: connErr } = await admin
    .from("bank_connections")
    .select("id")
    .eq("id", connectionId)
    .eq("household_id", household.householdId)
    .maybeSingle();

  if (connErr || !conn) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  // Best-effort: revoke the Plaid item so Plaid stops tracking (and billing) it.
  // A dead item (e.g. INSTITUTION_NO_LONGER_SUPPORTED) may reject this — never
  // let that block the removal.
  const { data: sec } = await admin
    .from("bank_connection_secrets")
    .select("plaid_access_token_ciphertext")
    .eq("bank_connection_id", connectionId)
    .maybeSingle();

  if (sec?.plaid_access_token_ciphertext) {
    try {
      const accessToken = decryptPlaidAccessToken(
        String(sec.plaid_access_token_ciphertext),
      );
      await createPlaidClient().itemRemove({ access_token: accessToken });
    } catch (e) {
      console.warn("[plaid] itemRemove on connection removal (non-fatal)", e);
    }
  }

  // Mark removed so the all-connections sync (status = 'active') skips it.
  const { error: upErr } = await admin
    .from("bank_connections")
    .update({ status: "removed", updated_at: new Date().toISOString() })
    .eq("id", connectionId)
    .eq("household_id", household.householdId);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Drop the stored access token — it is dead and no longer needed. Keeps the
  // encrypted secret from lingering for a connection we no longer sync.
  await admin
    .from("bank_connection_secrets")
    .delete()
    .eq("bank_connection_id", connectionId);

  return NextResponse.json({ ok: true });
}
