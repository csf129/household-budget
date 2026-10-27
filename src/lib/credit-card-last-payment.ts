import type { SupabaseClient } from "@supabase/supabase-js";

/** The most recent payment made toward one credit card. */
export type CardLastPayment = {
  /** Positive dollars paid. */
  amount: number;
  /** ISO date (YYYY-MM-DD) the payment posted. */
  on: string;
};

type FeedRow = {
  bank_account_id: string;
  amount: number | string;
  name: string | null;
  category: unknown;
  posted_date: string | null;
  authorized_date: string | null;
};

const PAYMENT_NAME = /\b(payment|autopay|thank\s*you)\b/i;

/**
 * Plaid reports a credit to a card (money coming in) as a negative amount. Both
 * a payment and a refund look like that, so a row counts as a payment only when
 * Plaid files it under loan payments or its description reads like one.
 */
export function isCardPaymentRow(row: Pick<FeedRow, "amount" | "name" | "category">): boolean {
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount >= 0) return false;
  const cat = (row.category ?? {}) as { primary?: unknown; detailed?: unknown };
  const primary = String(cat.primary ?? "").toUpperCase();
  const detailed = String(cat.detailed ?? "").toUpperCase();
  if (primary === "LOAN_PAYMENTS" || detailed.includes("CREDIT_CARD_PAYMENT")) return true;
  return PAYMENT_NAME.test(String(row.name ?? ""));
}

/**
 * Latest posted payment per credit account, keyed by bank_accounts.id. Accounts
 * with no payment in the synced history are simply absent.
 */
export async function fetchLastCardPayments(
  supabase: SupabaseClient,
  householdId: string,
  creditAccountIds: string[],
): Promise<Map<string, CardLastPayment>> {
  const out = new Map<string, CardLastPayment>();
  if (creditAccountIds.length === 0) return out;

  const { data, error } = await supabase
    .from("plaid_transactions")
    .select("bank_account_id, amount, name, category, posted_date, authorized_date")
    .eq("household_id", householdId)
    .in("bank_account_id", creditAccountIds)
    .eq("pending", false)
    .lt("amount", 0)
    .order("posted_date", { ascending: false, nullsFirst: false })
    .limit(1000);
  if (error) {
    console.warn("[credit-cards] last payment lookup failed", error.message);
    return out;
  }

  // Rows arrive newest first, so the first payment seen per account is the latest.
  for (const row of (data ?? []) as FeedRow[]) {
    const id = String(row.bank_account_id);
    if (out.has(id) || !isCardPaymentRow(row)) continue;
    const on = row.posted_date ?? row.authorized_date;
    if (!on) continue;
    out.set(id, { amount: Math.round(Math.abs(Number(row.amount)) * 100) / 100, on: String(on).slice(0, 10) });
  }
  return out;
}
