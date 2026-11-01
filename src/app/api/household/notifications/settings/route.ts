import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser, isHead } from "@/lib/household";
import { getViewContext } from "@/lib/view-as";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from "@/types/notifications";

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function rowToSettings(row: Record<string, unknown>): NotificationSettings {
  return {
    notifyWebPush: Boolean(row.notify_web_push ?? true),
    notifyInApp: Boolean(row.notify_in_app ?? true),
    notifyEmail: Boolean(row.notify_email ?? false),
    emailRecipients: Array.isArray(row.email_recipients)
      ? (row.email_recipients as string[])
      : [],
    priceChangeEnabled: Boolean(row.price_change_enabled ?? true),
    billPaidEnabled: Boolean(row.bill_paid_enabled ?? true),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
  };
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return NextResponse.json({ error: "No household" }, { status: 403 });

  const { data } = await supabase
    .from("notification_settings")
    .select("*")
    .eq("household_id", household.householdId)
    .maybeSingle();

  return NextResponse.json(
    data ? rowToSettings(data as Record<string, unknown>) : DEFAULT_NOTIFICATION_SETTINGS,
  );
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return NextResponse.json({ error: "No household" }, { status: 403 });
  const view = await getViewContext(supabase, household.role);
  if (!isHead(view.effectiveRole)) {
    return NextResponse.json(
      { error: "Only a household head can change settings." },
      { status: 403 },
    );
  }

  let body: Partial<NotificationSettings> = {};
  try {
    body = (await req.json()) as Partial<NotificationSettings>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let recipients: string[] = [];
  if (body.emailRecipients !== undefined) {
    if (!Array.isArray(body.emailRecipients)) {
      return NextResponse.json({ error: "emailRecipients must be an array" }, { status: 400 });
    }
    recipients = body.emailRecipients.map((e) => String(e).trim()).filter(Boolean);
    if (recipients.some((e) => !isValidEmail(e))) {
      return NextResponse.json({ error: "Invalid email in recipients" }, { status: 400 });
    }
  }

  const upsertRow = {
    household_id: household.householdId,
    notify_web_push: body.notifyWebPush ?? true,
    notify_in_app: body.notifyInApp ?? true,
    notify_email: body.notifyEmail ?? false,
    email_recipients: recipients,
    price_change_enabled: body.priceChangeEnabled ?? true,
    bill_paid_enabled: body.billPaidEnabled ?? true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("notification_settings")
    .upsert(upsertRow, { onConflict: "household_id" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(rowToSettings(data as Record<string, unknown>));
}
