import { NextResponse } from "next/server";
import { requireHouseholdMember } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { assembleReportTransactions } from "@/lib/report-data";

export const maxDuration = 60;

/**
 * GET /api/household/report/transactions — the individual spending
 * transactions behind the report's per-category/month bars, for the
 * "Individual" tab drill-down. Scoped to the signed-in user's household and
 * read under their RLS context. `?months=` matches the report window
 * (2..12 complete months, default 6).
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const auth = await requireHouseholdMember(supabase);
  if (auth instanceof NextResponse) return auth;
  const { household } = auth;

  const monthsParam = Number(new URL(req.url).searchParams.get("months"));
  const months = Number.isFinite(monthsParam) && monthsParam > 0 ? monthsParam : 6;

  try {
    const payload = await assembleReportTransactions(supabase, household.householdId, {
      months,
    });
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
