/**
 * Detect and deliver notification events for one household.
 *
 * Reads the household's notification settings, auto-detects recurring
 * merchants, derives new price-change / bill-paid events (deduped against
 * what's already stored), records them, and fans them out to the enabled
 * channels (web push, email; in-app is the stored row itself).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resend } from "resend";
import type { NotificationEvent, NotificationSettings } from "@/types/notifications";
import { fetchRecurringCharges } from "@/lib/fetch-recurring-charges";
import { detectRecurringMerchants } from "@/lib/recurring-merchants";
import { detectNotificationEvents } from "@/lib/detect-notification-events";
import { sendPushToHousehold } from "@/lib/send-web-push";
import {
  eventTitle,
  eventBody,
  buildNotificationEmail,
} from "@/lib/notification-messages";

export type DispatchDeps = {
  admin: SupabaseClient;
  resend?: Resend | null;
  fromAddress?: string;
};

export type DispatchResult = {
  householdId: string;
  detected: number;
  pushSent: number;
  emailSent: boolean;
};

function settingsFromRow(row: Record<string, unknown>): NotificationSettings {
  return {
    notifyWebPush: Boolean(row.notify_web_push ?? true),
    notifyInApp: Boolean(row.notify_in_app ?? true),
    notifyEmail: Boolean(row.notify_email ?? false),
    emailRecipients: Array.isArray(row.email_recipients) ? (row.email_recipients as string[]) : [],
    priceChangeEnabled: Boolean(row.price_change_enabled ?? true),
    billPaidEnabled: Boolean(row.bill_paid_enabled ?? true),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
  };
}

export async function dispatchHouseholdNotifications(
  deps: DispatchDeps,
  householdId: string,
  householdName: string,
  settingsRow: Record<string, unknown>,
): Promise<DispatchResult> {
  const { admin, resend, fromAddress } = deps;
  const settings = settingsFromRow(settingsRow);
  const empty: DispatchResult = { householdId, detected: 0, pushSent: 0, emailSent: false };

  // Nothing to detect if both event types are off.
  if (!settings.priceChangeEnabled && !settings.billPaidEnabled) {
    await touchLastRun(admin, householdId);
    return empty;
  }

  const charges = await fetchRecurringCharges(admin, householdId);
  const merchants = detectRecurringMerchants(charges);

  const { data: existing } = await admin
    .from("notification_events")
    .select("dedup_key")
    .eq("household_id", householdId);
  const existingDedupKeys = new Set(
    (existing ?? []).map((r) => String((r as { dedup_key: unknown }).dedup_key)),
  );

  const events = detectNotificationEvents(merchants, {
    priceChangeEnabled: settings.priceChangeEnabled,
    billPaidEnabled: settings.billPaidEnabled,
    existingDedupKeys,
    today: new Date(),
  });

  if (events.length === 0) {
    await touchLastRun(admin, householdId);
    return empty;
  }

  // Record events first (idempotent) so a delivery failure can't drop them.
  await admin.from("notification_events").upsert(
    events.map((e) => ({
      household_id: householdId,
      type: e.type,
      dedup_key: e.dedupKey,
      merchant: e.merchant,
      merchant_label: e.merchantLabel,
      amount: e.amount,
      previous_amount: e.previousAmount,
      occurred_on: e.occurredOn,
      category_id: e.categoryId,
    })),
    { onConflict: "household_id,dedup_key", ignoreDuplicates: true },
  );

  const pushSent = settings.notifyWebPush ? await deliverPush(admin, householdId, events) : 0;
  const emailSent =
    settings.notifyEmail && settings.emailRecipients.length > 0
      ? await deliverEmail(resend, fromAddress, householdName, settings.emailRecipients, events)
      : false;

  if (pushSent > 0 || emailSent) {
    await admin
      .from("notification_events")
      .update({
        delivered_web_push: pushSent > 0,
        delivered_email: emailSent,
      })
      .eq("household_id", householdId)
      .in("dedup_key", events.map((e) => e.dedupKey));
  }

  await touchLastRun(admin, householdId);
  return { householdId, detected: events.length, pushSent, emailSent };
}

async function touchLastRun(admin: SupabaseClient, householdId: string) {
  await admin
    .from("notification_settings")
    .update({ last_run_at: new Date().toISOString() })
    .eq("household_id", householdId);
}

async function deliverPush(
  admin: SupabaseClient,
  householdId: string,
  events: NotificationEvent[],
): Promise<number> {
  // One push per event when few; a single summary when many, to avoid spam.
  if (events.length <= 3) {
    let total = 0;
    for (const e of events) {
      const res = await sendPushToHousehold(admin, householdId, {
        title: eventTitle(e),
        body: eventBody(e),
        url: "/alerts",
        tag: e.dedupKey,
      });
      total += res.sent;
    }
    return total;
  }
  const res = await sendPushToHousehold(admin, householdId, {
    title: `${events.length} new budget notifications`,
    body: "Open Steward to review price changes and bills paid.",
    url: "/alerts",
    tag: "notifications-summary",
  });
  return res.sent;
}

async function deliverEmail(
  resend: Resend | null | undefined,
  fromAddress: string | undefined,
  householdName: string,
  recipients: string[],
  events: NotificationEvent[],
): Promise<boolean> {
  if (!resend || !fromAddress) return false;
  try {
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: recipients,
      subject: `${householdName} — ${events.length} new notification${events.length === 1 ? "" : "s"}`,
      html: buildNotificationEmail(householdName, events),
    });
    return !error;
  } catch {
    return false;
  }
}
