import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import { assembleReportData } from "@/lib/report-data";

export const maxDuration = 60;

/**
 * GET /api/household/report — the in-app budget report as JSON, scoped to the
 * signed-in user's household and read under their RLS context (no cron secret,
 * no service-role client). Any household member may read it. `?months=` sets
 * the history window (2..12 complete months, default 6).
 */
export async function GET(req: Request) {
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

  const monthsParam = Number(new URL(req.url).searchParams.get("months"));
  const months = Number.isFinite(monthsParam) && monthsParam > 0 ? monthsParam : 6;

  try {
    const data = await assembleReportData(
      supabase,
      household.householdId,
      household.name,
      { months },
    );
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
