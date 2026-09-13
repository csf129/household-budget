import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getHouseholdForUser, isHead, type UserHousehold } from "@/lib/household";
import { getViewContext } from "@/lib/view-as";

/**
 * Shared authorization guards for route handlers.
 *
 * Every mutating API route must gate on one of these — RLS keeps data
 * household-scoped, but the head-only restriction that the UI enforces is NOT
 * expressed in RLS (any member can write). Routes that back a head-only screen
 * must therefore call requireHouseholdHead so the restriction cannot be
 * bypassed by calling the endpoint directly.
 */

export type AuthContext = { user: User; household: UserHousehold };

/** Authenticated + belongs to a household. Returns an error response otherwise. */
export async function requireHouseholdMember(
  supabase: SupabaseClient,
): Promise<AuthContext | NextResponse> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) {
    return NextResponse.json({ error: "No household." }, { status: 403 });
  }
  return { user, household };
}

/**
 * Authenticated + a head (or creator) of their household. Uses the effective
 * (view-as) role, so a creator previewing a family member is blocked exactly as
 * that member would be — matching the settings screens. effectiveRole is always
 * <= realRole, so this only ever fails closed.
 */
export async function requireHouseholdHead(
  supabase: SupabaseClient,
): Promise<AuthContext | NextResponse> {
  const ctx = await requireHouseholdMember(supabase);
  if (ctx instanceof NextResponse) return ctx;

  const view = await getViewContext(supabase, ctx.household.role);
  if (!isHead(view.effectiveRole)) {
    return NextResponse.json(
      { error: "Only a household head can change settings." },
      { status: 403 },
    );
  }
  return ctx;
}
