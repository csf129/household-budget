import type { SupabaseClient } from "@supabase/supabase-js";

export type UserHousehold = {
  householdId: string;
  name: string;
  role: "owner" | "member";
  inviteCode: string | null;
};

/**
 * Loads the household the user belongs to, if any (two queries; avoids embed naming issues).
 */
export async function getHouseholdForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserHousehold | null> {
  const { data: member, error: memberError } = await supabase
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError || !member?.household_id) return null;

  const { data: row, error: householdError } = await supabase
    .from("households")
    .select("id, name, invite_code")
    .eq("id", member.household_id)
    .maybeSingle();

  if (householdError || !row) return null;

  return {
    householdId: row.id,
    name: row.name,
    role: member.role as UserHousehold["role"],
    inviteCode: row.invite_code,
  };
}
