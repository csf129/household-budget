import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaidTransactionFeedDbRow } from "@/lib/map-plaid-transaction-feed";

const PAGE_SIZE = 1000;

/**
 * Loads all Plaid transaction rows for a household (paged).
 */
export async function fetchAllHouseholdPlaidFeedRows(
  supabase: SupabaseClient,
  householdId: string,
): Promise<{
  data: PlaidTransactionFeedDbRow[];
  error: { message: string } | null;
}> {
  const rows: PlaidTransactionFeedDbRow[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("plaid_transactions")
      .select(
        "plaid_transaction_id, bank_account_id, amount, name, merchant_name, posted_date, authorized_date, pending, bank_accounts(name, display_name, mask)",
      )
      .eq("household_id", householdId)
      .order("posted_date", { ascending: false, nullsFirst: false })
      .order("authorized_date", { ascending: false, nullsFirst: false })
      .order("plaid_transaction_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return { data: [], error: { message: error.message } };
    }

    const chunk = (data ?? []) as PlaidTransactionFeedDbRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { data: rows, error: null };
}
