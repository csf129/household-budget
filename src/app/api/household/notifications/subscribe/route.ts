import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";

// Registering/removing a device for push is a per-user action, so any
// household member may do it for their own browser — no head check.

type SubscribeBody = {
  subscription?: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return NextResponse.json({ error: "No household" }, { status: 403 });

  let body: SubscribeBody = {};
  try {
    body = (await req.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sub = body.subscription;
  const endpoint = sub?.endpoint?.trim();
  const p256dh = sub?.keys?.p256dh?.trim();
  const auth = sub?.keys?.auth?.trim();
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  // endpoint is globally unique; re-subscribing from the same browser updates
  // the owning household/user rather than erroring.
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      household_id: household.householdId,
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgent,
    },
    { onConflict: "endpoint" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return NextResponse.json({ error: "No household" }, { status: 403 });

  let endpoint: string | undefined;
  try {
    endpoint = ((await req.json()) as { endpoint?: string }).endpoint?.trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

  // RLS already scopes deletes to the member's household.
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
