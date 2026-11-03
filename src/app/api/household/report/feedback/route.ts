import { NextResponse } from "next/server";
import { requireHouseholdMember } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import type { ReportFeedback } from "@/types/report";

/**
 * Household notes on the budget report. These persist across report
 * regenerations and are fed back into the AI savings analysis (both the in-app
 * deep-dive and the `/budget-report` skill), so the household's own constraints
 * and corrections shape future advice.
 *
 * GET  — list the household's notes.
 * PUT  — upsert one note for a category (empty string = general note). An empty
 *        note clears (deletes) it.
 *
 * Notes are shared household context, so any member may read or write — no
 * head-only gate (unlike Settings screens).
 */

const MAX_CATEGORY_LEN = 120;
const MAX_NOTE_LEN = 1000;

function rowToFeedback(row: Record<string, unknown>): ReportFeedback {
  return {
    category: String(row.category ?? ""),
    note: String(row.note ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function GET() {
  const supabase = await createClient();
  const auth = await requireHouseholdMember(supabase);
  if (auth instanceof NextResponse) return auth;
  const { household } = auth;

  const { data, error } = await supabase
    .from("report_feedback")
    .select("category,note,updated_at")
    .eq("household_id", household.householdId)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const feedback: ReportFeedback[] = (data ?? [])
    .map((r) => rowToFeedback(r as Record<string, unknown>))
    .filter((f) => f.note.trim().length > 0);

  return NextResponse.json({ feedback });
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const auth = await requireHouseholdMember(supabase);
  if (auth instanceof NextResponse) return auth;
  const { user, household } = auth;

  let body: { category?: unknown; note?: unknown };
  try {
    body = (await req.json()) as { category?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.category !== undefined && typeof body.category !== "string") {
    return NextResponse.json({ error: "category must be a string" }, { status: 400 });
  }
  if (typeof body.note !== "string") {
    return NextResponse.json({ error: "note must be a string" }, { status: 400 });
  }

  const category = (body.category ?? "").toString().trim().slice(0, MAX_CATEGORY_LEN);
  const note = body.note.trim().slice(0, MAX_NOTE_LEN);

  // An empty note clears the row for this (household, category).
  if (!note) {
    const { error } = await supabase
      .from("report_feedback")
      .delete()
      .eq("household_id", household.householdId)
      .eq("category", category);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ feedback: null });
  }

  const { data, error } = await supabase
    .from("report_feedback")
    .upsert(
      {
        household_id: household.householdId,
        category,
        note,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id,category" },
    )
    .select("category,note,updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ feedback: rowToFeedback(data as Record<string, unknown>) });
}
