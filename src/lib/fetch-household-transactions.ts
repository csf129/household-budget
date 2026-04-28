import type { SupabaseClient } from "@supabase/supabase-js";
import { LEDGER_ARCHIVED_AT } from "@/lib/ledger-archived";
import {
  ledgerArchiveColumnExists,
  withActiveLedgerOnly,
  withArchivedLedgerOnly,
} from "@/lib/ledger-archive-schema";

export type FetchHouseholdTransactionsOptions = {
  /**
   * When set, skips an extra schema probe (use when you already called
   * `ledgerArchiveColumnExists` on the same request).
   */
  ledgerArchiveColumn?: boolean;
};

const TX_CATEGORIES = `
      categories (
        name,
        color,
        parent_category_id,
        parent:parent_category_id ( name ),
        primary_category_groups ( name, slug )
      )
    `;

const TX_CORE = `
      id,
      amount,
      occurred_on,
      raw_description,
      normalized_description,
      notes,
      account_id,
      bank_account_id,
      category_id,
      income_treatment,
      is_business_expense,
      plaid_transaction_id`;

/**
 * Embedded select for transaction rows used on dashboard, transactions, and income pages.
 * Keep in sync when adding columns to mapTransactionRow.
 */
const TX_RECEIPTS = `
      transaction_receipts ( id, file_name, file_size, mime_type, created_at )
    `;

export function householdTransactionsSelect(
  includeLedgerArchivedColumn: boolean,
): string {
  const arch = includeLedgerArchivedColumn
    ? `,\n      ${LEDGER_ARCHIVED_AT}`
    : "";
  return `${TX_CORE}${arch},
      ${TX_CATEGORIES},
      ${TX_RECEIPTS}
    `;
}

/** Full select including `ledger_archived_at` (requires migration). */
export const HOUSEHOLD_TRANSACTIONS_SELECT = householdTransactionsSelect(true);

/** PostgREST (Supabase REST) returns at most this many rows per request by default. */
const PAGE_SIZE = 1000;

/**
 * Loads every transaction for a household by paging. Without this, only the first
 * PAGE_SIZE rows (newest by sort order) appear in the app — older rows look "deleted".
 */
export async function fetchAllHouseholdTransactions(
  supabase: SupabaseClient,
  householdId: string,
  options?: FetchHouseholdTransactionsOptions,
): Promise<{ data: unknown[]; error: { message: string } | null }> {
  const hasLedger =
    options?.ledgerArchiveColumn ??
    (await ledgerArchiveColumnExists(supabase));
  const select = householdTransactionsSelect(hasLedger);
  const rows: unknown[] = [];
  let from = 0;

  for (;;) {
    let q = supabase
      .from("transactions")
      .select(select)
      .eq("household_id", householdId);
    q = withActiveLedgerOnly(q, hasLedger);
    const { data, error } = await q
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return { data: [], error: { message: error.message } };
    }

    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) {
      break;
    }
    from += PAGE_SIZE;
  }

  return { data: rows, error: null };
}

/**
 * Archived ledger rows (non-Plaid soft-archive). Same shape as active fetch.
 */
export async function fetchArchivedHouseholdTransactions(
  supabase: SupabaseClient,
  householdId: string,
  options?: FetchHouseholdTransactionsOptions,
): Promise<{ data: unknown[]; error: { message: string } | null }> {
  const hasLedger =
    options?.ledgerArchiveColumn ??
    (await ledgerArchiveColumnExists(supabase));
  if (!hasLedger) {
    return { data: [], error: null };
  }

  const select = householdTransactionsSelect(true);
  const rows: unknown[] = [];
  let from = 0;

  for (;;) {
    let q = supabase
      .from("transactions")
      .select(select)
      .eq("household_id", householdId);
    q = withArchivedLedgerOnly(q, hasLedger);
    const { data, error } = await q
      .is("plaid_transaction_id", null)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return { data: [], error: { message: error.message } };
    }

    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) {
      break;
    }
    from += PAGE_SIZE;
  }

  return { data: rows, error: null };
}
