import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stored role values are 'creator'/'owner'/'member'; the UI calls them
 * Creator / Head / Family member.
 */
export type HouseholdRole = "creator" | "owner" | "member";

export const HOUSEHOLD_ROLE_LABELS: Record<HouseholdRole, string> = {
  creator: "Creator",
  owner: "Head",
  member: "Family member",
};

/** Higher rank = more access. Used to keep "view as" a downgrade-only operation. */
export const HOUSEHOLD_ROLE_RANK: Record<HouseholdRole, number> = {
  creator: 2,
  owner: 1,
  member: 0,
};

/** Levels a head may assign; creator is granted in SQL only. */
export const ASSIGNABLE_ROLES: HouseholdRole[] = ["owner", "member"];

export function parseHouseholdRole(value: unknown): HouseholdRole | null {
  return value === "creator" || value === "owner" || value === "member"
    ? value
    : null;
}

export function isCreator(role: HouseholdRole): boolean {
  return role === "creator";
}

export type UserHousehold = {
  householdId: string;
  name: string;
  role: HouseholdRole;
  inviteCode: string | null;
};

/** Heads can reach every part of the app; family members cannot open settings. */
export function isHead(role: HouseholdRole): boolean {
  return role === "owner" || role === "creator";
}

export type HouseholdMember = {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: HouseholdRole;
  createdAt: string;
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
    role: parseHouseholdRole(member.role) ?? "member",
    inviteCode: row.invite_code,
  };
}

/**
 * Members of the caller's household, heads first. Emails come from auth.users via RPC.
 */
export async function fetchHouseholdMembers(
  supabase: SupabaseClient,
): Promise<HouseholdMember[]> {
  const { data, error } = await supabase.rpc("list_household_members");
  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    email: String(row.email ?? ""),
    displayName: row.display_name ? String(row.display_name) : null,
    role: parseHouseholdRole(row.role) ?? "member",
    createdAt: String(row.created_at ?? ""),
  }));
}
