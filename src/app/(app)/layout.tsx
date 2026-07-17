import { redirect } from "next/navigation";
import { AiAssistantWidget } from "@/components/ai-assistant-widget";
import { AppSidebar } from "@/components/app-sidebar";
import { ViewAsBanner } from "@/components/view-as-banner";
import { createClient } from "@/lib/supabase/server";
import { fetchHouseholdMembers, getHouseholdForUser, isHead } from "@/lib/household";
import { getViewContext } from "@/lib/view-as";
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

  const view = await getViewContext(supabase, household.role);

  const [alertCount, cardReminderCount, members] = await Promise.all([
    fetchHouseholdAlertCount(supabase, household.householdId),
    fetchCreditCardReminderCount(supabase, household.householdId),
    view.canSwitchViews ? fetchHouseholdMembers(supabase) : Promise.resolve([]),
  ]);

  return (
    <div className="relative flex min-h-screen w-full min-w-0 flex-row font-sans">
      <AppSidebar
        householdName={household.name}
        userEmail={user.email ?? ""}
        isHead={isHead(view.effectiveRole)}
        effectiveRole={view.effectiveRole}
        effectiveLabel={view.viewingAs?.label || null}
        canSwitchViews={view.canSwitchViews}
        realRole={view.realRole}
        viewingAsMemberId={view.viewingAs?.memberId ?? null}
        members={members}
        badgeCounts={{ "/alerts": alertCount, "/credit-cards": cardReminderCount }}
      />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col overflow-x-hidden bg-zinc-50 dark:bg-zinc-950">
        {view.viewingAs ? (
          <ViewAsBanner role={view.viewingAs.role} label={view.viewingAs.label} />
        ) : null}
        <div className="px-4 py-8">{children}</div>
      </div>
      <AiAssistantWidget />
    </div>
  );
}
