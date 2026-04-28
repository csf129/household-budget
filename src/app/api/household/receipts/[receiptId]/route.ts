import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getHouseholdForUser } from "@/lib/household";

const BUCKET = "receipts";
const SIGNED_URL_TTL = 60 * 60; // 1 hour

type Params = { params: Promise<{ receiptId: string }> };

/** GET /api/household/receipts/[receiptId] — returns a short-lived signed URL.
 *  Pass ?download=1 to get a URL with Content-Disposition: attachment. */
export async function GET(req: Request, { params }: Params) {
  const { receiptId } = await params;
  const forceDownload = new URL(req.url).searchParams.get("download") === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) {
    return NextResponse.json({ error: "No household" }, { status: 403 });
  }

  const { data: receipt, error } = await supabase
    .from("transaction_receipts")
    .select("id, file_path, file_name, mime_type")
    .eq("id", receiptId)
    .eq("household_id", household.householdId)
    .single();

  if (error || !receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  const adminClient = createSupabaseAdminClient();
  const { data: signedData, error: signErr } = await adminClient.storage
    .from(BUCKET)
    .createSignedUrl(receipt.file_path, SIGNED_URL_TTL, {
      download: forceDownload ? receipt.file_name : false,
    });

  if (signErr || !signedData) {
    return NextResponse.json(
      { error: `Could not generate URL: ${signErr?.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: signedData.signedUrl, file_name: receipt.file_name });
}

/** DELETE /api/household/receipts/[receiptId] — removes file from storage and DB */
export async function DELETE(_req: Request, { params }: Params) {
  const { receiptId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) {
    return NextResponse.json({ error: "No household" }, { status: 403 });
  }

  const { data: receipt, error } = await supabase
    .from("transaction_receipts")
    .select("id, file_path")
    .eq("id", receiptId)
    .eq("household_id", household.householdId)
    .single();

  if (error || !receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  const adminClient = createSupabaseAdminClient();
  await adminClient.storage.from(BUCKET).remove([receipt.file_path]);

  await supabase
    .from("transaction_receipts")
    .delete()
    .eq("id", receiptId)
    .eq("household_id", household.householdId);

  return NextResponse.json({ ok: true });
}
