import { NextResponse } from "next/server";
import { Resend } from "resend";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchHouseholdNotifications } from "@/lib/dispatch-notifications";

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  // Every household that watches at least one event type. In-app recording
  // still needs detection to run even when push/email are off.
  const { data: rows, error } = await admin
    .from("notification_settings")
    .select("*, households(id, name)")
    .or("price_change_enabled.eq.true,bill_paid_enabled.eq.true");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const resendKey = process.env.RESEND_API_KEY;
  const resend = resendKey ? new Resend(resendKey) : null;
  const fromAddress = process.env.RESEND_FROM_EMAIL ?? "summaries@resend.dev";

  const results = [];
  for (const row of rows ?? []) {
    const householdId = String(row.household_id);
    const household = row.households as { id: string; name: string } | null;
    const householdName = household?.name ?? "Household";
    try {
      const result = await dispatchHouseholdNotifications(
        { admin, resend, fromAddress },
        householdId,
        householdName,
        row as Record<string, unknown>,
      );
      results.push(result);
    } catch (err) {
      results.push({
        householdId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}
