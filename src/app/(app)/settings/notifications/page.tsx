import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser, isHead } from "@/lib/household";
import { getViewContext } from "@/lib/view-as";
import { NotificationSettingsForm } from "@/components/notification-settings-form";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from "@/types/notifications";

export default async function NotificationsSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) redirect("/");

  const view = await getViewContext(supabase, household.role);
  const canEdit = isHead(view.effectiveRole);

  const { data } = await supabase
    .from("notification_settings")
    .select("*")
    .eq("household_id", household.householdId)
    .maybeSingle();

  const initial: NotificationSettings = data
    ? {
        notifyWebPush: Boolean(data.notify_web_push ?? true),
        notifyInApp: Boolean(data.notify_in_app ?? true),
        notifyEmail: Boolean(data.notify_email ?? false),
        emailRecipients: Array.isArray(data.email_recipients) ? (data.email_recipients as string[]) : [],
        priceChangeEnabled: Boolean(data.price_change_enabled ?? true),
        billPaidEnabled: Boolean(data.bill_paid_enabled ?? true),
        lastRunAt: data.last_run_at ? String(data.last_run_at) : null,
      }
    : DEFAULT_NOTIFICATION_SETTINGS;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Notifications</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Get notified when a subscription&apos;s price changes or a recurring bill is paid. Choose
          which events to watch and how you&apos;re notified.
        </p>
      </div>
      <NotificationSettingsForm initial={initial} canEdit={canEdit} />
    </div>
  );
}
