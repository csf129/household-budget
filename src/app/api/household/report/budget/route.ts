import { NextResponse } from "next/server";
import { requireHouseholdHead, requireHouseholdMember } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import type { BudgetChange } from "@/types/report";

/**
 * Adjust a category's monthly budget from the report's per-category plots, and
 * read the history of such changes.
 *
 * PUT  — head-only. Sets the category's monthly budget (a plain monthly amount)
 *        and records the change in the audit trail. Offered inline only for
 *        simple monthly budgets; seasonal / annual / recurring budgets stay on
 *        the Settings screen.
 * GET  — any member. Returns recent budget changes for the household.
 */

const HISTORY_LIMIT = 50;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function toAmount(value: unknown): number | null {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? Number(value) : null;
}

export async function GET() {
  const supabase = await createClient();
  const auth = await requireHouseholdMember(supabase);
  if (auth instanceof NextResponse) return auth;
  const { user, household } = auth;

  const { data, error } = await supabase
    .from("category_budget_changes")
    .select("id,category_name,old_amount,new_amount,source,created_at,changed_by")
    .eq("household_id", household.householdId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const changes: BudgetChange[] = (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      categoryName: String(row.category_name ?? ""),
      oldAmount: toAmount(row.old_amount),
      newAmount: toAmount(row.new_amount),
      source: row.source === "settings" ? "settings" : "report",
      createdAt: String(row.created_at ?? ""),
      changedByMe: row.changed_by === user.id,
    };
  });

  return NextResponse.json({ changes });
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const auth = await requireHouseholdHead(supabase);
  if (auth instanceof NextResponse) return auth;
  const { user, household } = auth;

  let body: { categoryId?: unknown; monthlyBudget?: unknown };
  try {
    body = (await req.json()) as { categoryId?: unknown; monthlyBudget?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const categoryId = typeof body.categoryId === "string" ? body.categoryId.trim() : "";
  if (!categoryId) {
    return NextResponse.json({ error: "categoryId is required." }, { status: 400 });
  }

  let newValue: number | null;
  if (body.monthlyBudget === null || body.monthlyBudget === undefined) {
    newValue = null;
  } else if (typeof body.monthlyBudget === "number" && Number.isFinite(body.monthlyBudget)) {
    newValue = body.monthlyBudget < 0 ? 0 : roundMoney(body.monthlyBudget);
  } else {
    return NextResponse.json(
      { error: "monthlyBudget must be a number or null." },
      { status: 400 },
    );
  }

  // Confirm the category belongs to this household, and read its current budget
  // + display name for the audit snapshot.
  const { data: cat, error: catErr } = await supabase
    .from("categories")
    .select("id,name,parent_category_id,monthly_budget")
    .eq("id", categoryId)
    .eq("household_id", household.householdId)
    .maybeSingle();

  if (catErr) return NextResponse.json({ error: catErr.message }, { status: 500 });
  if (!cat) {
    return NextResponse.json({ error: "Unknown category." }, { status: 400 });
  }

  const catRow = cat as Record<string, unknown>;
  let categoryName = String(catRow.name ?? "");
  const parentId = catRow.parent_category_id ? String(catRow.parent_category_id) : null;
  if (parentId) {
    const { data: parent } = await supabase
      .from("categories")
      .select("name")
      .eq("id", parentId)
      .eq("household_id", household.householdId)
      .maybeSingle();
    const parentName = parent ? String((parent as Record<string, unknown>).name ?? "") : "";
    if (parentName) categoryName = `${parentName} › ${categoryName}`;
  }

  const oldValue = toAmount(catRow.monthly_budget);

  const { error: upErr } = await supabase
    .from("categories")
    .update({ monthly_budget: newValue, budget_amount_period: "month" })
    .eq("id", categoryId)
    .eq("household_id", household.householdId);

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Record the change (best-effort — the budget update already succeeded).
  if (oldValue !== newValue) {
    await supabase.from("category_budget_changes").insert({
      household_id: household.householdId,
      category_id: categoryId,
      category_name: categoryName,
      old_amount: oldValue,
      new_amount: newValue,
      changed_by: user.id,
      source: "report",
    });
  }

  return NextResponse.json({ monthlyBudget: newValue });
}
