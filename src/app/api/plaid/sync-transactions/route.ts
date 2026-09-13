import { NextResponse } from "next/server";
import { getHouseholdForUser } from "@/lib/household";
import { createPlaidClient } from "@/lib/plaid-server";
import { syncPlaidTransactionsForConnection } from "@/lib/plaid-sync";
import { autoCategorizeUncategorizedForHousehold } from "@/lib/auto-categorize-household";
import { getHouseholdAiModel } from "@/lib/get-household-ai-model";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

/**
 * Background auto-sync (the sidebar fires this on app open) skips if every
 * active connection was synced within this window, so repeated page opens and
 * client-router refreshes don't hammer Plaid. The manual "Sync" button omits
 * `auto` and always syncs.
 */
const AUTO_SYNC_MIN_INTERVAL_MS = 3 * 60 * 1000;

type Body = {
  bank_connection_id?: string;
  /** True when fired automatically in the background (throttled, see above). */
  auto?: boolean;
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

  // Background auto-sync throttle: if everything was synced very recently, do
  // nothing rather than re-hitting Plaid on every page open. Manual syncs
  // (auto !== true) always proceed.
  if (body.auto === true && !connectionId) {
    const { data: recent } = await supabase
      .from("bank_connections")
      .select("last_sync_at")
      .eq("household_id", household.householdId)
      .eq("status", "active")
      .order("last_sync_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastSyncMs = recent?.last_sync_at
      ? new Date(recent.last_sync_at as string).getTime()
      : 0;
    if (
      Number.isFinite(lastSyncMs) &&
      Date.now() - lastSyncMs < AUTO_SYNC_MIN_INTERVAL_MS
    ) {
      return NextResponse.json({ skipped: true, reason: "recently-synced" });
    }
  }

  const plaid = createPlaidClient();

  // AI-categorize the rows this sync just imported (only those no deterministic
  // category rule already claimed). Best-effort: a missing AI key or model error
  // must never fail the sync — the transactions are already saved.
  async function categorizeIfImported(importedChanges: number): Promise<number> {
    if (importedChanges <= 0) return 0;
    try {
      const modelId = await getHouseholdAiModel(
        supabase,
        household!.householdId,
      );
      const { updated } = await autoCategorizeUncategorizedForHousehold(
        admin!,
        household!.householdId,
        modelId,
      );
      return updated;
    } catch (e) {
      console.warn("[plaid] auto-categorize after sync (non-fatal)", e);
      return 0;
    }
  }

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
        { deadlineMs: 50_000 },
      );
      const categorized = await categorizeIfImported(
        result.upserted + result.ledger_replaced,
      );
      return NextResponse.json({ connections: 1, ...result, categorized });
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
  let has_more = false;
  const startedAt = Date.now();
  const budgetMs = 50_000; // stay under the platform function timeout
  for (const c of conns ?? []) {
    const remaining = budgetMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      has_more = true;
      break;
    }
    try {
      const r = await syncPlaidTransactionsForConnection(
        admin,
        plaid,
        c.id,
        c.household_id,
        { deadlineMs: remaining },
      );
      upserted += r.upserted;
      removed += r.removed;
      ledger_replaced += r.ledger_replaced;
      if (r.has_more) has_more = true;
    } catch (e) {
      console.error("Plaid sync connection", c.id, e);
    }
  }

  const categorized = await categorizeIfImported(upserted + ledger_replaced);

  return NextResponse.json({
    connections: (conns ?? []).length,
    upserted,
    removed,
    ledger_replaced,
    has_more,
    categorized,
  });
}
