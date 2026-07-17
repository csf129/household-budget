import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HOUSEHOLD_ROLE_RANK,
  fetchHouseholdMembers,
  isCreator,
  parseHouseholdRole,
  type HouseholdMember,
  type HouseholdRole,
} from "@/lib/household";

export const VIEW_AS_COOKIE = "view_as";

/** Cookie payload: either a bare level, or a specific member of the household. */
type ViewAsCookie = {
  role?: HouseholdRole;
  memberId?: string;
};

export type ViewContext = {
  /** The level actually stored for this user. Permission decisions outside the app UI use this. */
  realRole: HouseholdRole;
  /** What the UI should render as. Never higher than realRole. */
  effectiveRole: HouseholdRole;
  /** Only creators get the switcher. */
  canSwitchViews: boolean;
  /** Set when a view override is active, for the banner + sidebar identity. */
  viewingAs: {
    role: HouseholdRole;
    memberId: string | null;
    label: string;
  } | null;
};

function parseCookie(raw: string | undefined): ViewAsCookie | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { role, memberId } = parsed as Record<string, unknown>;
    return {
      role: parseHouseholdRole(role) ?? undefined,
      memberId: typeof memberId === "string" ? memberId : undefined,
    };
  } catch {
    return null;
  }
}

function memberLabel(member: HouseholdMember): string {
  return member.displayName ?? member.email;
}

/**
 * Resolves what the current request should render as.
 *
 * The override is advisory UI state, so it is only ever trusted to *reduce*
 * access: the cookie is ignored unless the user really is a creator, and the
 * result is clamped to the real level's rank. A forged cookie can therefore
 * only ever show someone less than they already have.
 */
export async function getViewContext(
  supabase: SupabaseClient,
  realRole: HouseholdRole,
): Promise<ViewContext> {
  const base: ViewContext = {
    realRole,
    effectiveRole: realRole,
    canSwitchViews: isCreator(realRole),
    viewingAs: null,
  };

  if (!isCreator(realRole)) return base;

  const cookieStore = await cookies();
  const parsed = parseCookie(cookieStore.get(VIEW_AS_COOKIE)?.value);
  if (!parsed) return base;

  let role: HouseholdRole | null = null;
  let memberId: string | null = null;
  let label = "";

  if (parsed.memberId) {
    // The RPC only returns members of the caller's household, so an unknown or
    // out-of-household id simply resolves to nothing.
    const members = await fetchHouseholdMembers(supabase);
    const target = members.find((m) => m.id === parsed.memberId);
    if (!target) return base;
    role = target.role;
    memberId = target.id;
    label = memberLabel(target);
  } else if (parsed.role) {
    role = parsed.role;
    label = "";
  }

  if (!role) return base;

  // Downgrade-only. Selecting your own level is not an override.
  if (HOUSEHOLD_ROLE_RANK[role] > HOUSEHOLD_ROLE_RANK[realRole]) return base;
  if (!memberId && role === realRole) return base;

  return {
    ...base,
    effectiveRole: role,
    viewingAs: { role, memberId, label },
  };
}
