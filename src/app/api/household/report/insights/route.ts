import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import { enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { getHouseholdAiModel } from "@/lib/get-household-ai-model";
import { assembleReportData } from "@/lib/report-data";
import { generateSavingsInsights } from "@/lib/report-savings-insights";

export const maxDuration = 60;

/**
 * POST /api/household/report/insights — AI "where to save the most, easiest
 * first" analysis for the signed-in user's household. Re-assembles the report
 * server-side (so the narrative is grounded in real data, not client input) and
 * runs the household's configured AI model — Claude when that is what the
 * household selected. `?months=` matches the report window.
 */
export async function POST(req: Request) {
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

  const limited = await enforceAiRateLimit(supabase, household.householdId);
  if (limited) return limited;

  const monthsParam = Number(new URL(req.url).searchParams.get("months"));
  const months = Number.isFinite(monthsParam) && monthsParam > 0 ? monthsParam : 6;

  try {
    const data = await assembleReportData(
      supabase,
      household.householdId,
      household.name,
      { months },
    );
    const modelId = await getHouseholdAiModel(supabase, household.householdId);
    const insights = await generateSavingsInsights(data, modelId);
    if (!insights) {
      return NextResponse.json({ error: "AI returned no analysis." }, { status: 502 });
    }
    return NextResponse.json({ insights });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
