import { NextResponse } from "next/server";
import {
  clampMaxCalendarDayGap,
  planLedgerDuplicateDeletions,
  type DedupeLedgerRow,
} from "@/lib/dedupe-plaid-vs-manual";
import { getHouseholdForUser } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";
import {
  ledgerArchiveColumnExists,
  withActiveLedgerOnly,
} from "@/lib/ledger-archive-schema";
import { addCalendarDays } from "@/lib/weekly-spending-budget";

type Body = {
  /** Inclusive ISO date YYYY-MM-DD */
  rangeStart?: string;
  /** Inclusive ISO date YYYY-MM-DD */
  rangeEnd?: string;
  /** When true, delete planned rows. Default false = preview only. */
  execute?: boolean;
  /** Max calendar days between manual and Plaid `occurred_on` (0–7). */
  maxCalendarDayGap?: number;
};

function mapRow(r: Record<string, unknown>): DedupeLedgerRow {
  const amt = r.amount;
  const n = typeof amt === "string" ? Number.parseFloat(amt) : Number(amt);
  return {
    id: String(r.id),
    occurred_on: String(r.occurred_on ?? ""),
    amount: Number.isFinite(n) ? n : 0,
    raw_description: String(r.raw_description ?? ""),
    normalized_description: String(r.normalized_description ?? ""),
    plaid_transaction_id:
      r.plaid_transaction_id != null &&
      String(r.plaid_transaction_id).trim() !== ""
        ? String(r.plaid_transaction_id)
        : null,
  };
}

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const execute = body.execute === true;
  const maxCalendarDayGap = clampMaxCalendarDayGap(body.maxCalendarDayGap);

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

  const hasLedgerArchive = await ledgerArchiveColumnExists(supabase);

  let q = withActiveLedgerOnly(
    supabase
      .from("transactions")
      .select(
        "id, occurred_on, amount, raw_description, normalized_description, plaid_transaction_id",
      )
      .eq("household_id", household.householdId),
    hasLedgerArchive,
  );

  const rs = body.rangeStart?.trim();
  const re = body.rangeEnd?.trim();
  if (rs) {
    q = q.gte("occurred_on", addCalendarDays(rs, -maxCalendarDayGap));
  }
  if (re) {
    q = q.lte("occurred_on", addCalendarDays(re, maxCalendarDayGap));
  }

  const { data: rawRows, error: qErr } = await q;
  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  const rows = (rawRows ?? []).map((r) =>
    mapRow(r as Record<string, unknown>),
  );
  const plan = planLedgerDuplicateDeletions(rows, {
    maxCalendarDayGap,
  });
  const deleteIds = [...new Set(plan.map((p) => p.deleteId))];

  if (!execute) {
    return NextResponse.json({
      execute: false,
      scanned: rows.length,
      deleteCount: deleteIds.length,
      maxCalendarDayGap,
      items: plan,
    });
  }

  if (deleteIds.length === 0) {
    return NextResponse.json({
      execute: true,
      deleted: 0,
      scanned: rows.length,
    });
  }

  const chunkSize = 40;
  let deleted = 0;
  for (let i = 0; i < deleteIds.length; i += chunkSize) {
    const chunk = deleteIds.slice(i, i + chunkSize);
    const { error: delErr } = await supabase
      .from("transactions")
      .delete()
      .eq("household_id", household.householdId)
      .in("id", chunk);
    if (delErr) {
      return NextResponse.json(
        { error: delErr.message, deleted },
        { status: 500 },
      );
    }
    deleted += chunk.length;
  }

  return NextResponse.json({
    execute: true,
    deleted,
    scanned: rows.length,
  });
}
