import { NextResponse } from "next/server";
import { CountryCode } from "plaid";
import {
  assertPlaidEncryptionKeyConfigured,
  encryptPlaidAccessToken,
} from "@/lib/plaid-token-crypto";
import { getHouseholdForUser } from "@/lib/household";
import { createPlaidClient } from "@/lib/plaid-server";
import { syncPlaidTransactionsForConnection } from "@/lib/plaid-sync";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

type Body = {
  public_token?: string;
  bank_connection_id?: string;
};

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const publicToken =
    typeof body.public_token === "string" ? body.public_token.trim() : "";
  const relinkConnectionId =
    typeof body.bank_connection_id === "string"
      ? body.bank_connection_id.trim()
      : "";
  if (!publicToken) {
    return NextResponse.json({ error: "Missing public_token." }, { status: 400 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server misconfiguration.";
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  try {
    assertPlaidEncryptionKeyConfigured();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Encryption key missing.";
    return NextResponse.json({ error: msg }, { status: 503 });
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
    return NextResponse.json(
      { error: "Join or create a household first." },
      { status: 403 },
    );
  }

  const plaid = createPlaidClient();

  let accessToken: string;
  let itemId: string;
  try {
    const ex = await plaid.itemPublicTokenExchange({ public_token: publicToken });
    accessToken = ex.data.access_token;
    itemId = ex.data.item_id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Plaid exchange failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const { data: existing } = await admin
    .from("bank_connections")
    .select("id, household_id")
    .eq("plaid_item_id", itemId)
    .maybeSingle();

  if (existing?.id && !relinkConnectionId) {
    return NextResponse.json(
      {
        error:
          "This Plaid Item is already linked. Remove it first or use Plaid update mode.",
      },
      { status: 409 },
    );
  }

  if (existing?.id && relinkConnectionId && existing.id !== relinkConnectionId) {
    return NextResponse.json(
      {
        error:
          "This Plaid Item is linked to a different connection. Re-link the matching institution row.",
      },
      { status: 409 },
    );
  }

  let institutionId: string | null = null;
  let institutionName: string | null = null;
  try {
    const itemRes = await plaid.itemGet({ access_token: accessToken });
    institutionId = itemRes.data.item.institution_id ?? null;
    if (institutionId) {
      const inst = await plaid.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = inst.data.institution.name ?? null;
    }
  } catch {
    /* optional metadata */
  }

  let accounts;
  try {
    const acctRes = await plaid.accountsGet({ access_token: accessToken });
    accounts = acctRes.data.accounts;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load accounts.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  let connectionId = "";
  if (existing?.id && relinkConnectionId) {
    const { data: owned } = await admin
      .from("bank_connections")
      .select("id")
      .eq("id", existing.id)
      .eq("household_id", household.householdId)
      .maybeSingle();
    if (!owned?.id) {
      return NextResponse.json({ error: "Connection not found." }, { status: 404 });
    }
    connectionId = existing.id;
    const { error: upConnErr } = await admin
      .from("bank_connections")
      .update({
        institution_id: institutionId,
        institution_name: institutionName,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);
    if (upConnErr) {
      return NextResponse.json({ error: upConnErr.message }, { status: 500 });
    }
    const { error: upSecErr } = await admin
      .from("bank_connection_secrets")
      .upsert(
        {
          bank_connection_id: connectionId,
          plaid_access_token_ciphertext: encryptPlaidAccessToken(accessToken),
        },
        { onConflict: "bank_connection_id" },
      );
    if (upSecErr) {
      return NextResponse.json({ error: upSecErr.message }, { status: 500 });
    }
    await admin.from("plaid_sync_state").upsert(
      {
        bank_connection_id: connectionId,
        transactions_cursor: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "bank_connection_id" },
    );
  } else {
    const { data: conn, error: connErr } = await admin
      .from("bank_connections")
      .insert({
        household_id: household.householdId,
        linked_by_user_id: user.id,
        plaid_item_id: itemId,
        institution_id: institutionId,
        institution_name: institutionName,
        status: "active",
      })
      .select("id")
      .single();

    if (connErr || !conn) {
      return NextResponse.json(
        { error: connErr?.message ?? "Could not save bank connection." },
        { status: 500 },
      );
    }

    connectionId = conn.id as string;

    const { error: secErr } = await admin.from("bank_connection_secrets").insert({
      bank_connection_id: connectionId,
      plaid_access_token_ciphertext: encryptPlaidAccessToken(accessToken),
    });

    if (secErr) {
      await admin.from("bank_connections").delete().eq("id", connectionId);
      return NextResponse.json({ error: secErr.message }, { status: 500 });
    }
  }

  const accountRows = accounts.map((a) => ({
    household_id: household.householdId,
    bank_connection_id: connectionId,
    plaid_account_id: a.account_id,
    name: a.name,
    official_name: a.official_name ?? null,
    mask: a.mask ?? null,
    type: a.type ?? null,
    subtype: a.subtype ?? null,
    current_balance:
      a.balances.current != null ? Number(a.balances.current) : null,
    available_balance:
      a.balances.available != null ? Number(a.balances.available) : null,
    iso_currency_code: a.balances.iso_currency_code ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error: acctInsErr } = await admin
    .from("bank_accounts")
    .upsert(accountRows, { onConflict: "plaid_account_id" });

  if (acctInsErr) {
    await admin.from("bank_connection_secrets").delete().eq("bank_connection_id", connectionId);
    await admin.from("bank_connections").delete().eq("id", connectionId);
    return NextResponse.json({ error: acctInsErr.message }, { status: 500 });
  }

  await admin.from("plaid_sync_state").upsert(
    {
      bank_connection_id: connectionId,
      transactions_cursor: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "bank_connection_id" },
  );

  let syncResult = { upserted: 0, removed: 0 };
  try {
    syncResult = await syncPlaidTransactionsForConnection(
      admin,
      plaid,
      connectionId,
      household.householdId,
    );
  } catch (e) {
    console.error("Initial Plaid sync failed:", e);
  }

  return NextResponse.json({
    bank_connection_id: connectionId,
    accounts: accounts.length,
    ...syncResult,
  });
}
