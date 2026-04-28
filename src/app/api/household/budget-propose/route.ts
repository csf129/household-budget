import { NextResponse } from "next/server";
import type { CategoryContext } from "@/lib/auto-categorize-openai";
import { fetchCategoryBudgetsFromOpenAI } from "@/lib/budget-propose-openai";
import {
  proposalsFromRollupMap,
  rollupSpreadsheetLinesToCategoryBudgets,
} from "@/lib/budget-rollup-deterministic";
import type { ExtractedBudgetLineJson } from "@/lib/parse-budget-spreadsheet";
import { getHouseholdForUser } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

type Body = {
  /** When set, use these lines instead of the last saved import. */
  lineItems?: ExtractedBudgetLineJson[];
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "AI budget proposals require OPENAI_API_KEY in your server environment (.env.local).",
        code: "NO_AI_KEY",
      },
      { status: 503 },
    );
  }

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
      { error: "Add categories before proposing budgets." },
      { status: 400 },
    );
  }

  let lines: ExtractedBudgetLineJson[] = Array.isArray(body.lineItems)
    ? body.lineItems
    : [];

  let priorSummary: string | null = null;

  if (lines.length === 0) {
    const { data: ref, error: refErr } = await supabase
      .from("household_budget_reference")
      .select("line_items, last_ai_summary")
      .eq("household_id", household.householdId)
      .maybeSingle();

    if (refErr) {
      return NextResponse.json({ error: refErr.message }, { status: 500 });
    }

    const raw = ref?.line_items;
    if (Array.isArray(raw)) {
      lines = raw as ExtractedBudgetLineJson[];
    }
    priorSummary =
      ref?.last_ai_summary != null ? String(ref.last_ai_summary) : null;

    if (lines.length === 0) {
      return NextResponse.json(
        {
          error:
            "No imported budget found. Upload your Excel file first, then try again.",
        },
        { status: 400 },
      );
    }
  } else {
    const { data: ref } = await supabase
      .from("household_budget_reference")
      .select("last_ai_summary")
      .eq("household_id", household.householdId)
      .maybeSingle();
    priorSummary =
      ref?.last_ai_summary != null ? String(ref.last_ai_summary) : null;
  }

  const catCtx: CategoryContext[] = categoryList.map((c) => ({
    id: String(c.id),
    name: String(c.name ?? ""),
    description:
      c.description != null && String(c.description).trim() !== ""
        ? String(c.description)
        : null,
  }));

  const forLlm = lines.map((l) => ({
    description: l.description,
    sheetCategory: l.sheetCategory,
    monthlyEquivalent: l.monthlyEquivalent,
    period: l.period,
  }));

  const spreadsheetMonthlyTotal = lines.reduce(
    (s, l) => s + (Number.isFinite(l.monthlyEquivalent) ? l.monthlyEquivalent : 0),
    0,
  );

  const catIdNames = categoryList.map((c) => ({
    id: String(c.id),
    name: String(c.name ?? ""),
  }));
  const rollupMap = rollupSpreadsheetLinesToCategoryBudgets(lines, catIdNames);
  const spreadsheetProposals = proposalsFromRollupMap(catIdNames, rollupMap);

  let result;
  try {
    result = await fetchCategoryBudgetsFromOpenAI(
      apiKey,
      catCtx,
      forLlm,
      spreadsheetMonthlyTotal,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI error.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const sumAi = result.proposals.reduce((s, p) => s + p.monthlyBudget, 0);
  const diff = Math.abs(sumAi - spreadsheetMonthlyTotal);
  const tolerance = Math.max(15, spreadsheetMonthlyTotal * 0.02);
  const aiTotalsTrusted = spreadsheetMonthlyTotal <= 0 || diff <= tolerance;

  let finalProposals = result.proposals;
  let finalSummary = result.summary;
  let source: "ai" | "spreadsheet" = "ai";

  if (!aiTotalsTrusted) {
    finalProposals = spreadsheetProposals;
    finalSummary = `Used spreadsheet-accurate totals ($${spreadsheetMonthlyTotal.toFixed(2)}/mo across ${lines.length} lines). The model’s amounts were off by $${diff.toFixed(2)}, so category splits follow your sheet labels and line text instead. You can still edit every amount before saving.`;
    source = "spreadsheet";
  }

  const { data: existingRef } = await supabase
    .from("household_budget_reference")
    .select("source_filename")
    .eq("household_id", household.householdId)
    .maybeSingle();

  const { error: sumErr } = await supabase
    .from("household_budget_reference")
    .upsert(
      {
        household_id: household.householdId,
        source_filename:
          existingRef?.source_filename != null
            ? String(existingRef.source_filename)
            : null,
        line_items: lines,
        last_ai_summary: finalSummary,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id" },
    );

  if (sumErr) {
    return NextResponse.json({ error: sumErr.message }, { status: 500 });
  }

  return NextResponse.json({
    summary: finalSummary,
    proposals: finalProposals,
    lineCount: lines.length,
    spreadsheetMonthlyTotal,
    source,
  });
}
