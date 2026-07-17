import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import { AI_MODELS, DEFAULT_AI_MODEL_ID } from "@/lib/ai-models";

const ALLOWED_MODEL_IDS = new Set(AI_MODELS.map((m) => m.id));

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return NextResponse.json({ error: "No household." }, { status: 403 });

  const { data } = await supabase
    .from("ai_settings")
    .select("model_id")
    .eq("household_id", household.householdId)
    .maybeSingle();

  return NextResponse.json({ modelId: data?.model_id ?? DEFAULT_AI_MODEL_ID });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return NextResponse.json({ error: "No household." }, { status: 403 });

  let body: { modelId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const modelId = body.modelId?.trim();
  if (!modelId || !ALLOWED_MODEL_IDS.has(modelId)) {
    return NextResponse.json({ error: "Invalid model ID." }, { status: 400 });
  }

  const { error } = await supabase.from("ai_settings").upsert(
    { household_id: household.householdId, model_id: modelId, updated_at: new Date().toISOString() },
    { onConflict: "household_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ modelId });
}
