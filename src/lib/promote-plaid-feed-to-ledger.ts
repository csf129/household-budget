import {
  categoryRulesFromDb,
  resolveCategoryFromRules,
} from "@/lib/apply-category-rules";
import { createClient } from "@/lib/supabase/client";
import { householdTransactionsSelect } from "@/lib/fetch-household-transactions";
import { ledgerArchiveColumnExists } from "@/lib/ledger-archive-schema";
import { mapTransactionRow } from "@/lib/map-transaction";
import type { TransactionRow } from "@/types/finance";

/**
 * Copies a Plaid feed-only row into `transactions` so it can be edited and categorized.
 * Idempotent: if a row with the same `plaid_transaction_id` already exists, returns it.
 */
export async function promotePlaidFeedRowToLedger(
  r: TransactionRow,
  householdId: string,
  userId: string,
): Promise<{ row: TransactionRow | null; error: string | null }> {
  if (!r.plaid_feed_only) {
    return { row: r, error: null };
  }
  if (!r.plaid_transaction_id?.trim()) {
    return {
      row: null,
      error:
        "This bank feed row is missing a Plaid id. Try syncing again from Settings → Bank.",
    };
  }

  const supabase = createClient();
  const pid = r.plaid_transaction_id.trim();
  const hasLedgerArchive = await ledgerArchiveColumnExists(supabase);
  const txSelect = householdTransactionsSelect(hasLedgerArchive);

  const { data: existing, error: exErr } = await supabase
    .from("transactions")
    .select(txSelect)
    .eq("household_id", householdId)
    .eq("plaid_transaction_id", pid)
    .maybeSingle();

  if (exErr) {
    return { row: null, error: exErr.message };
  }
  if (existing) {
    return { row: mapTransactionRow(existing), error: null };
  }

  const { data: rulesRaw } = await supabase
    .from("category_rules")
    .select("category_id, match_type, pattern, priority, amount_sign")
    .eq("household_id", householdId);
  const rules = categoryRulesFromDb(rulesRaw ?? []);
  const trimmedCat = r.category_id?.trim();
  const category_id =
    trimmedCat && trimmedCat.length > 0
      ? trimmedCat
      : resolveCategoryFromRules(r.normalized_description, r.amount, rules);

  const { data: ins, error } = await supabase
    .from("transactions")
    .insert({
      household_id: householdId,
      plaid_transaction_id: pid,
      bank_account_id: r.bank_account_id?.trim() || null,
      amount: r.amount,
      occurred_on: r.occurred_on,
      raw_description: r.raw_description,
      normalized_description: r.normalized_description,
      category_id,
      created_by: userId,
    })
    .select(txSelect)
    .single();

  if (error) {
    const { data: ex2, error: e2 } = await supabase
      .from("transactions")
      .select(txSelect)
      .eq("household_id", householdId)
      .eq("plaid_transaction_id", pid)
      .maybeSingle();
    if (!e2 && ex2) {
      return { row: mapTransactionRow(ex2), error: null };
    }
    return { row: null, error: error.message };
  }

  return {
    row: ins ? mapTransactionRow(ins) : null,
    error: null,
  };
}
