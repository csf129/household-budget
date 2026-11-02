import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assembleReportData } from "@/lib/report-data";

/**
 * GET /api/report — full household budget report as JSON.
 *
 * Auth: the cron/automation secret (Authorization: Bearer <CRON_SECRET>), same
 * as the other server-to-server routes. Fails CLOSED when the secret is unset.
 * This runs with the service-role client, so it is never exposed to a user JWT.
 *
 * Query params:
 *   months       2..12 complete months of history (default 6).
 *   householdId  which household; optional when exactly one household exists.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const url = new URL(req.url);
  const monthsParam = Number(url.searchParams.get("months"));
  const months = Number.isFinite(monthsParam) && monthsParam > 0 ? monthsParam : 6;
  const requestedHousehold = url.searchParams.get("householdId")?.trim() || null;

  const admin = createSupabaseAdminClient();

  const { data: households, error } = await admin.from("households").select("id,name");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const list = (households ?? []).map((h) => ({
    id: String(h.id),
    name: String(h.name ?? "Household"),
  }));

  const target = requestedHousehold
    ? list.find((h) => h.id === requestedHousehold)
    : list.length === 1
      ? list[0]
      : undefined;

  if (!target) {
    return NextResponse.json(
      {
        error: requestedHousehold
          ? "Household not found"
          : "Multiple households found; pass ?householdId=",
        households: list,
      },
      { status: 400 },
    );
  }

  const data = await assembleReportData(admin, target.id, target.name, { months });
  return NextResponse.json(data);
}
