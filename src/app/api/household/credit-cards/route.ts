import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import type { CreditCardMetadataInput, CreditCardStatus } from "@/types/credit-card";

const VALID_STATUS: CreditCardStatus[] = ["active", "review", "cancelled"];

function intInRange(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= min && i <= max ? i : null;
}

function nonNegNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function trimmedOrNull(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

export async function PUT(request: Request) {
  let body: Partial<CreditCardMetadataInput>;
  try {
    body = (await request.json()) as Partial<CreditCardMetadataInput>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const bankAccountId = typeof body.bankAccountId === "string" ? body.bankAccountId : "";
  if (!bankAccountId) {
    return NextResponse.json({ error: "bankAccountId is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return NextResponse.json({ error: "No household." }, { status: 403 });

  // Verify the bank account belongs to this household and is a credit card.
  const { data: acct, error: acctErr } = await supabase
    .from("bank_accounts")
    .select("id, type")
    .eq("id", bankAccountId)
    .eq("household_id", household.householdId)
    .maybeSingle();

  if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });
  if (!acct || acct.type !== "credit") {
    return NextResponse.json({ error: "Credit account not found." }, { status: 404 });
  }

  const status: CreditCardStatus = VALID_STATUS.includes(body.status as CreditCardStatus)
    ? (body.status as CreditCardStatus)
    : "active";

  const row = {
    household_id: household.householdId,
    bank_account_id: bankAccountId,
    annual_fee: nonNegNum(body.annualFee),
    annual_fee_month: intInRange(body.annualFeeMonth, 1, 12),
    payment_due_day: intInRange(body.paymentDueDay, 1, 31),
    points_program: trimmedOrNull(body.pointsProgram, 120),
    points_balance: body.pointsBalance == null ? null : intInRange(body.pointsBalance, 0, 1_000_000_000),
    points_updated_on: trimmedOrNull(body.pointsUpdatedOn, 10),
    reward_summary: trimmedOrNull(body.rewardSummary, 1000),
    status,
    notes: trimmedOrNull(body.notes, 2000),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("credit_cards")
    .upsert(row, { onConflict: "bank_account_id" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, card: data });
}
