import { NextResponse } from "next/server";
import { getHouseholdForUser } from "@/lib/household";
import { parseBudgetSpreadsheetBuffer } from "@/lib/parse-budget-spreadsheet";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 6 * 1024 * 1024;

export async function POST(request: Request) {
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field." }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 6 MB)." },
      { status: 400 },
    );
  }

  const name = file.name.toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
    return NextResponse.json(
      { error: "Upload an Excel file (.xlsx or .xls)." },
      { status: 400 },
    );
  }

  const buf = await file.arrayBuffer();
  let lineItems;
  try {
    lineItems = parseBudgetSpreadsheetBuffer(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not read spreadsheet.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { error: upErr } = await supabase.from("household_budget_reference").upsert(
    {
      household_id: household.householdId,
      source_filename: file.name,
      line_items: lineItems,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id" },
  );

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({
    lineCount: lineItems.length,
    lineItems,
    sourceFilename: file.name,
  });
}
