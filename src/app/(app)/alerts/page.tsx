import { AlertsInbox } from "@/components/alerts-inbox";
import { fetchHouseholdAlerts } from "@/lib/alerts";
import { getHouseholdForUser } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";

export default async function AlertsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return null;

  const alerts = await fetchHouseholdAlerts(supabase, household.householdId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Alerts &amp; Messages
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Action items and notifications for your household.
        </p>
      </div>
      <AlertsInbox alerts={alerts} householdId={household.householdId} />
    </div>
  );
}
