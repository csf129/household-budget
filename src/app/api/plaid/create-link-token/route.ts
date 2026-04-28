import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { getHouseholdForUser } from "@/lib/household";
import { createPlaidClient, getPlaidWebhookUrl } from "@/lib/plaid-server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

export async function POST() {
  try {
    createPlaidClient();
  } catch (e) {
    console.error("create-link-token: Plaid client init failed:", e);
    return NextResponse.json(
      {
        error:
          "Plaid is not configured. Set PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV in .env.local.",
        code: "PLAID_NOT_CONFIGURED",
      },
      { status: 503 },
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

  const plaid = createPlaidClient();
  const webhook = getPlaidWebhookUrl();

  try {
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "Household Budget",
      products: [Products.Transactions],
      transactions: {
        // Request the maximum history Plaid supports (institution-dependent).
        days_requested: 730,
      },
      country_codes: [CountryCode.Us],
      language: "en",
      ...(webhook ? { webhook } : {}),
    });

    const token = res.data.link_token;
    if (!token) {
      return NextResponse.json(
        { error: "Plaid did not return a link token." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      link_token: token,
      expiration: res.data.expiration,
    });
  } catch (e) {
    console.error("create-link-token: Plaid linkTokenCreate failed:", e);
    const err = e as {
      response?: {
        status?: number;
        data?: { error_code?: string; error_message?: string };
      };
    };
    const data = err.response?.data;
    const code = data?.error_code;
    const message =
      data?.error_message ||
      (e instanceof Error ? e.message : "Plaid request failed.");
    const hint =
      code === "INVALID_API_KEYS"
        ? "Copy the Sandbox client ID and Sandbox secret from Plaid Dashboard → Developers → Keys. They must match PLAID_ENV=sandbox (no extra spaces or quotes)."
        : undefined;
    return NextResponse.json(
      { error: message, plaid_error_code: code, hint },
      { status: 502 },
    );
  }
}
