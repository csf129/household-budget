import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ledgerArchiveColumnExists,
  withActiveLedgerOnly,
} from "@/lib/ledger-archive-schema";
import { transactionImportDedupeKey } from "@/lib/transaction-import-dedupe-key";

const PAGE_SIZE = 1000;

/**
 * Loads dedupe keys for all transactions in [minOccurredOn, maxOccurredOn].
 * PostgREST returns at most PAGE_SIZE rows per request; without paging, skip-duplicates misses matches.
 */
export async function fetchExistingImportDedupeKeys(
  supabase: SupabaseClient,
  householdId: string,
  minOccurredOn: string,
  maxOccurredOn: string,
): Promise<{ keys: Set<string>; error: { message: string } | null }> {
  const hasLedger = await ledgerArchiveColumnExists(supabase);
  const keys = new Set<string>();
  let from = 0;

  for (;;) {
    let q = supabase
      .from("transactions")
      .select("occurred_on, amount, raw_description")
      .eq("household_id", householdId);
    q = withActiveLedgerOnly(q, hasLedger);
    const { data, error } = await q
      .gte("occurred_on", minOccurredOn)
      .lte("occurred_on", maxOccurredOn)
      .order("occurred_on", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return { keys: new Set(), error: { message: error.message } };
    }

    const chunk = data ?? [];
    for (const r of chunk) {
      const amt =
        typeof r.amount === "string"
          ? Number.parseFloat(r.amount)
          : Number(r.amount);
      keys.add(
        transactionImportDedupeKey(
          String(r.occurred_on),
          amt,
          String(r.raw_description ?? ""),
        ),
      );
    }

    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { keys, error: null };
}
