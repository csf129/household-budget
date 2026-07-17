import { redirect } from "next/navigation";
import { SettingsNav } from "@/components/settings-nav";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser, isHead } from "@/lib/household";
import { getViewContext } from "@/lib/view-as";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) redirect("/setup");

  // Settings is head-only; family members get bounced back to the dashboard.
  // Driven off the effective level so a creator previewing a family member
  // gets bounced too, exactly as that member would be.
  const view = await getViewContext(supabase, household.role);
  if (!isHead(view.effectiveRole)) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Household preferences, members, accounts, categories, and automation rules.
        </p>
      </div>
      <SettingsNav />
      {children}
    </div>
  );
}
