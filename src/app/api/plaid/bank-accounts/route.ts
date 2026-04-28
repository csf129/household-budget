import { NextResponse } from "next/server";
import { getHouseholdForUser } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";

type Body = {
  bank_account_id?: string;
  display_name?: string | null;
};

export async function PATCH(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const bankAccountId =
    typeof body.bank_account_id === "string" ? body.bank_account_id.trim() : "";
  if (!bankAccountId) {
    return NextResponse.json(
      { error: "bank_account_id is required." },
      { status: 400 },
    );
  }

  let displayName: string | null = null;
  if (typeof body.display_name === "string") {
    const trimmed = body.display_name.trim();
    displayName = trimmed.length > 0 ? trimmed.slice(0, 80) : null;
  } else if (body.display_name == null) {
    displayName = null;
  } else {
    return NextResponse.json(
      { error: "display_name must be a string or null." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
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

  const { data, error } = await supabase
    .from("bank_accounts")
    .update({ display_name: displayName })
    .eq("id", bankAccountId)
    .eq("household_id", household.householdId)
    .select("id, display_name")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Bank account not found." }, { status: 404 });
  }

  return NextResponse.json({
    id: String(data.id),
    display_name:
      data.display_name != null && String(data.display_name).trim() !== ""
        ? String(data.display_name)
        : null,
  });
}

