import { NextResponse } from "next/server";
import { getHouseholdForUser } from "@/lib/household";
import { createPlaidClient } from "@/lib/plaid-server";
import { syncPlaidTransactionsForConnection } from "@/lib/plaid-sync";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

type Body = {
  bank_connection_id?: string;
};

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server misconfiguration.";
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
    return NextResponse.json({ error: "No household." }, { status: 403 });
  }

  const connectionId =
    typeof body.bank_connection_id === "string"
      ? body.bank_connection_id.trim()
      : "";

  const plaid = createPlaidClient();

  if (connectionId) {
    const { data: row, error } = await supabase
      .from("bank_connections")
      .select("id, household_id")
      .eq("id", connectionId)
      .eq("household_id", household.householdId)
      .maybeSingle();

    if (error || !row) {
      return NextResponse.json(
        { error: "Connection not found." },
        { status: 404 },
      );
    }

    try {
      const result = await syncPlaidTransactionsForConnection(
        admin,
        plaid,
        row.id,
        row.household_id,
      );
      return NextResponse.json({ connections: 1, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sync failed.";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  const { data: conns, error: listErr } = await supabase
    .from("bank_connections")
    .select("id, household_id")
    .eq("household_id", household.householdId)
    .eq("status", "active");

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  let upserted = 0;
  let removed = 0;
  let ledger_replaced = 0;
  for (const c of conns ?? []) {
    try {
      const r = await syncPlaidTransactionsForConnection(
        admin,
        plaid,
        c.id,
        c.household_id,
      );
      upserted += r.upserted;
      removed += r.removed;
      ledger_replaced += r.ledger_replaced;
    } catch (e) {
      console.error("Plaid sync connection", c.id, e);
    }
  }

  return NextResponse.json({
    connections: (conns ?? []).length,
    upserted,
    removed,
    ledger_replaced,
  });
}
