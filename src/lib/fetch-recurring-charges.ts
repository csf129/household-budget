/**
 * Load a household's recent expense charges as `MerchantCharge[]` for recurring
 * detection. Pulls the reconciled ledger (`transactions`), not the raw Plaid
 * feed, so it reflects what the household actually sees.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MerchantCharge } from "@/lib/recurring-merchants";

/** Trailing window to inspect. Wide enough for stable monthly/weekly baselines. */
export const RECURRING_LOOKBACK_DAYS = 760;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function fetchRecurringCharges(
  admin: SupabaseClient,
  householdId: string,
): Promise<MerchantCharge[]> {
  const since = isoDaysAgo(RECURRING_LOOKBACK_DAYS);

  const { data, error } = await admin
    .from("transactions")
    .select("amount, occurred_on, raw_description, normalized_description, category_id")
    .eq("household_id", householdId)
    .is("ledger_archived_at", null)
    .lt("amount", 0) // expenses only (outflows are negative)
    .gte("occurred_on", since)
    .order("occurred_on", { ascending: true });

  if (error || !data) return [];

  const charges: MerchantCharge[] = [];
  for (const row of data as Record<string, unknown>[]) {
    const merchant = String(row.normalized_description ?? "").trim().toLowerCase();
    if (!merchant) continue;
    const rawAmount =
      typeof row.amount === "string" ? parseFloat(row.amount) : Number(row.amount);
    if (!Number.isFinite(rawAmount) || rawAmount >= 0) continue;
    charges.push({
      merchant,
      merchantLabel: String(row.raw_description ?? row.normalized_description ?? "").trim(),
      amount: Math.abs(rawAmount),
      occurredOn: String(row.occurred_on ?? "").slice(0, 10),
      categoryId: row.category_id ? String(row.category_id) : null,
    });
  }
  return charges;
}
