"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser, isCreator, parseHouseholdRole } from "@/lib/household";
import { VIEW_AS_COOKIE } from "@/lib/view-as";

/**
 * Sets the "view as" override. Re-checks creator status here rather than
 * trusting the caller, so a non-creator can never plant the cookie.
 */
export async function setViewAs(input: {
  role?: string;
  memberId?: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return { error: "No household." };
  if (!isCreator(household.role)) return { error: "Only a creator can switch views." };

  const cookieStore = await cookies();

  const memberId = input.memberId?.trim();
  if (memberId) {
    cookieStore.set({
      name: VIEW_AS_COOKIE,
      value: JSON.stringify({ memberId }),
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    revalidatePath("/", "layout");
    return {};
  }

  const role = parseHouseholdRole(input.role);
  if (!role) return { error: "Unknown level." };

  // Selecting your own level just clears the override.
  if (role === household.role) {
    cookieStore.delete(VIEW_AS_COOKIE);
    revalidatePath("/", "layout");
    return {};
  }

  cookieStore.set({
    name: VIEW_AS_COOKIE,
    value: JSON.stringify({ role }),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  revalidatePath("/", "layout");
  return {};
}

export async function clearViewAs(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(VIEW_AS_COOKIE);
  revalidatePath("/", "layout");
}
