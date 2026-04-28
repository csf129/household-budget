import { SettingsGeneralPanel } from "@/components/settings-general-panel";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import type { AccountRow } from "@/types/finance";

export default async function SettingsGeneralPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return null;

  const { data: accountsRaw, error } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("household_id", household.householdId)
    .order("name", { ascending: true });

  if (error) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        Could not load accounts: {error.message}
      </p>
    );
  }

  const accounts: AccountRow[] = (accountsRaw ?? []).map((a) => ({
    id: String(a.id),
    name: String(a.name ?? ""),
  }));

  return (
    <SettingsGeneralPanel
      householdId={household.householdId}
      householdName={household.name}
      isOwner={household.role === "owner"}
      initialAccounts={accounts}
    />
  );
}
