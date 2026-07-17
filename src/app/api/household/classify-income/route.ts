import { NextResponse } from "next/server";
import {
  fetchIncomeClassificationsFromOpenAI,
  validateIncomeAssignments,
  type IncomeTxContext,
} from "@/lib/auto-classify-income-openai";
import { getHouseholdForUser } from "@/lib/household";
import {
  ledgerArchiveColumnExists,
  withActiveLedgerOnly,
} from "@/lib/ledger-archive-schema";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdAiModel } from "@/lib/get-household-ai-model";

export const maxDuration = 60;

const MAX_TRANSACTIONS = 100;

type Body = {
  transactionIds?: string[];
  /** When true (default), only rows with income_treatment null. */
  onlyUnset?: boolean;
};

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
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

  const [hasLedgerArchive, modelId] = await Promise.all([
    ledgerArchiveColumnExists(supabase),
    getHouseholdAiModel(supabase, household.householdId),
  ]);

  const idsInput = Array.isArray(body.transactionIds)
    ? body.transactionIds.filter((id) => typeof id === "string" && id.length > 0)
    : [];

  let query = withActiveLedgerOnly(
    supabase
      .from("transactions")
      .select(
        "id, raw_description, normalized_description, amount, income_treatment",
      )
      .eq("household_id", household.householdId)
      .gt("amount", 0)
      .limit(MAX_TRANSACTIONS),
    hasLedgerArchive,
  );

  if (idsInput.length > 0) {
    const unique = [...new Set(idsInput)].slice(0, MAX_TRANSACTIONS);
    query = query.in("id", unique);
  }

  if (body.onlyUnset !== false) {
    query = query.is("income_treatment", null);
  }

  const { data: txRows, error: txErr } = await query;

  if (txErr) {
    return NextResponse.json({ error: txErr.message }, { status: 500 });
  }

  const rows = txRows ?? [];
  if (rows.length === 0) {
    return NextResponse.json({
      updated: 0,
      message: "No positive transactions to classify.",
    });
  }

  if (idsInput.length > 0) {
    const requested = new Set(idsInput);
    const found = new Set(rows.map((r) => String(r.id)));
    for (const id of requested) {
      if (!found.has(id)) {
        return NextResponse.json(
          {
            error:
              "Some transaction ids were not found, are not in your household, are not credits, or already have an income override.",
          },
          { status: 400 },
        );
      }
    }
  }

  const txContexts: IncomeTxContext[] = rows.map((r) => ({
    id: String(r.id),
    raw_description: String(r.raw_description ?? ""),
    normalized_description: String(r.normalized_description ?? ""),
    amount:
      typeof r.amount === "string"
        ? Number.parseFloat(r.amount)
        : Number(r.amount),
  }));

  const allowedTxIds = new Set(txContexts.map((t) => t.id));

  let assignments;
  try {
    assignments = await fetchIncomeClassificationsFromOpenAI(
      "",
      txContexts,
      modelId,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI error.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const toApply = validateIncomeAssignments(assignments, allowedTxIds);

  let updated = 0;
  for (const [transactionId, treatment] of toApply) {
    const { error: upErr, data: updatedRows } = await supabase
      .from("transactions")
      .update({ income_treatment: treatment })
      .eq("id", transactionId)
      .eq("household_id", household.householdId)
      .select("id");

    if (upErr) {
      return NextResponse.json(
        { error: upErr.message, updated },
        { status: 500 },
      );
    }
    if (updatedRows && updatedRows.length > 0) updated += 1;
  }

  return NextResponse.json({
    updated,
    considered: rows.length,
    message:
      updated === 0
        ? "No rows updated (model returned neutral for all, or nothing to change)."
        : `Tagged ${updated} transaction${updated === 1 ? "" : "s"} for overview income.`,
  });
}
