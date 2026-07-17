import { redirect } from "next/navigation";
import { AiAssistantWidget } from "@/components/ai-assistant-widget";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import { fetchHouseholdAlertCount } from "@/lib/alerts";
import { fetchCreditCardReminderCount } from "@/lib/fetch-credit-cards";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) {
    redirect("/setup");
  }

  const [alertCount, cardReminderCount] = await Promise.all([
    fetchHouseholdAlertCount(supabase, household.householdId),
    fetchCreditCardReminderCount(supabase, household.householdId),
  ]);

  return (
    <div className="relative flex min-h-screen w-full min-w-0 flex-row font-sans">
      <AppSidebar
        householdName={household.name}
        userEmail={user.email ?? ""}
        badgeCounts={{ "/alerts": alertCount, "/credit-cards": cardReminderCount }}
      />
      <div className="min-h-screen min-w-0 flex-1 overflow-x-hidden bg-zinc-50 dark:bg-zinc-950">
        <div className="px-4 py-8">{children}</div>
      </div>
      <AiAssistantWidget />
    </div>
  );
}
