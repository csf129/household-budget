import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getHouseholdForUser } from "@/lib/household";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);
const BUCKET = "receipts";

export async function POST(req: Request) {
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const transactionId = form.get("transaction_id");
  const file = form.get("file");

  if (!transactionId || typeof transactionId !== "string") {
    return NextResponse.json({ error: "Missing transaction_id" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "File type not allowed. Use JPEG, PNG, WEBP, HEIC, or PDF." },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File exceeds 20 MB limit." },
      { status: 400 },
    );
  }

  // Verify the transaction belongs to this household
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .select("id")
    .eq("id", transactionId)
    .eq("household_id", household.householdId)
    .single();

  if (txErr || !tx) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  const ext = file.name.split(".").pop() ?? "";
  const uuid = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = `${household.householdId}/${transactionId}/${uuid}-${safeName}`;

  const adminClient = createSupabaseAdminClient();
  const bytes = await file.arrayBuffer();

  const { error: storageErr } = await adminClient.storage
    .from(BUCKET)
    .upload(filePath, bytes, {
      contentType: file.type,
      upsert: false,
    });

  if (storageErr) {
    return NextResponse.json(
      { error: `Storage upload failed: ${storageErr.message}` },
      { status: 500 },
    );
  }

  const { data: receipt, error: dbErr } = await supabase
    .from("transaction_receipts")
    .insert({
      household_id: household.householdId,
      transaction_id: transactionId,
      file_path: filePath,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      uploaded_by: user.id,
    })
    .select("id, transaction_id, file_path, file_name, file_size, mime_type, created_at")
    .single();

  if (dbErr || !receipt) {
    // Roll back the storage file if DB insert fails
    await adminClient.storage.from(BUCKET).remove([filePath]);
    return NextResponse.json(
      { error: `Database insert failed: ${dbErr?.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ receipt }, { status: 201 });
}
