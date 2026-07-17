import { NextResponse } from "next/server";
import {
  fetchAssignmentsFromOpenAI,
  validateAndDedupeAssignments,
  type TransactionContext,
} from "@/lib/auto-categorize-openai";
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
  /** When true (default), only rows still uncategorized are updated. */
  onlyUncategorized?: boolean;
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

  await supabase.rpc("ensure_default_categories_for_my_household");

  const { data: categories, error: catErr } = await supabase
    .from("categories")
    .select("id, name, description")
    .eq("household_id", household.householdId)
    .order("sort_order", { ascending: true });

  if (catErr) {
    return NextResponse.json({ error: catErr.message }, { status: 500 });
  }

  const categoryList = categories ?? [];
  if (categoryList.length === 0) {
    return NextResponse.json(
      {
        error: "No categories in this household. Add categories first.",
        updated: 0,
      },
      { status: 400 },
    );
  }

  const allowedCategoryIds = new Set(categoryList.map((c) => String(c.id)));

  const idsInput = Array.isArray(body.transactionIds)
    ? body.transactionIds.filter((id) => typeof id === "string" && id.length > 0)
    : [];

  let query = withActiveLedgerOnly(
    supabase
      .from("transactions")
      .select("id, raw_description, normalized_description, amount, category_id")
      .eq("household_id", household.householdId)
      .limit(MAX_TRANSACTIONS),
    hasLedgerArchive,
  );

  if (idsInput.length > 0) {
    const unique = [...new Set(idsInput)].slice(0, MAX_TRANSACTIONS);
    query = query.in("id", unique);
  }

  if (body.onlyUncategorized !== false) {
    query = query.is("category_id", null);
  }

  const { data: txRows, error: txErr } = await query;

  if (txErr) {
    return NextResponse.json({ error: txErr.message }, { status: 500 });
  }

  const rows = txRows ?? [];
  if (rows.length === 0) {
    return NextResponse.json({
      updated: 0,
      message: "No transactions to categorize.",
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
              "Some transaction ids were not found, are not in your household, or already have a category.",
          },
          { status: 400 },
        );
      }
    }
  }

  const txContexts: TransactionContext[] = rows.map((r) => ({
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
    assignments = await fetchAssignmentsFromOpenAI(
      "",
      categoryList.map((c) => ({
        id: String(c.id),
        name: String(c.name ?? ""),
        description:
          c.description != null && String(c.description).trim() !== ""
            ? String(c.description)
            : null,
      })),
      txContexts,
      modelId,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI error.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const toApply = validateAndDedupeAssignments(
    assignments,
    allowedTxIds,
    allowedCategoryIds,
  );

  let updated = 0;
  for (const [transactionId, categoryId] of toApply) {
    const { error: upErr, data: updatedRows } = await supabase
      .from("transactions")
      .update({ category_id: categoryId })
      .eq("id", transactionId)
      .eq("household_id", household.householdId)
      .is("category_id", null)
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
        ? "No assignments applied (model returned no matching categories)."
        : `Updated ${updated} transaction${updated === 1 ? "" : "s"}.`,
  });
}
