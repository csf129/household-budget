import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { decryptPlaidAccessToken } from "@/lib/plaid-token-crypto";
import { getHouseholdForUser } from "@/lib/household";
import { createPlaidClient, getPlaidWebhookUrl } from "@/lib/plaid-server";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

type Body = { bank_connection_id?: string };

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const connectionId =
    typeof body.bank_connection_id === "string" ? body.bank_connection_id.trim() : "";
  if (!connectionId) {
    return NextResponse.json(
      { error: "Missing bank_connection_id." },
      { status: 400 },
    );
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

  const admin = createSupabaseAdminClient();
  const { data: conn, error: connErr } = await admin
    .from("bank_connections")
    .select("id")
    .eq("id", connectionId)
    .eq("household_id", household.householdId)
    .maybeSingle();

  if (connErr || !conn) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  const { data: sec, error: secErr } = await admin
    .from("bank_connection_secrets")
    .select("plaid_access_token_ciphertext")
    .eq("bank_connection_id", connectionId)
    .maybeSingle();

  if (secErr || !sec?.plaid_access_token_ciphertext) {
    return NextResponse.json(
      { error: "Could not load Plaid secret for this connection." },
      { status: 404 },
    );
  }

  const accessToken = decryptPlaidAccessToken(sec.plaid_access_token_ciphertext);
  const plaid = createPlaidClient();
  const webhook = getPlaidWebhookUrl();

  try {
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "Household Budget",
      language: "en",
      country_codes: [CountryCode.Us],
      products: [Products.Transactions],
      access_token: accessToken,
      transactions: { days_requested: 730 },
      ...(webhook ? { webhook } : {}),
    });

    return NextResponse.json({
      link_token: res.data.link_token,
      expiration: res.data.expiration,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not start relink.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

