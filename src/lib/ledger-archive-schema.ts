import type { SupabaseClient } from "@supabase/supabase-js";
import { LEDGER_ARCHIVED_AT } from "@/lib/ledger-archived";

/** PostgREST / Postgres when `ledger_archived_at` has not been migrated. */
export function isMissingLedgerArchiveColumnMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("ledger_archived_at") &&
    (m.includes("does not exist") ||
      m.includes("unknown column") ||
      (m.includes("column") && m.includes("not found")))
  );
}

/**
 * Whether `public.transactions.ledger_archived_at` exists. When false, callers
 * should omit the column from select/update and skip archive filters.
 */
export async function ledgerArchiveColumnExists(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { error } = await supabase
    .from("transactions")
    .select("ledger_archived_at")
    .limit(1);
  if (!error) return true;
  if (isMissingLedgerArchiveColumnMessage(error.message)) return false;
  return true;
}

type IsFilterable = { is: (column: string, value: null) => IsFilterable };
type NotFilterable = {
  not: (column: string, op: "is", value: null) => NotFilterable;
};

export function withActiveLedgerOnly<Q extends IsFilterable>(
  query: Q,
  ledgerArchiveColumn: boolean,
): Q {
  if (!ledgerArchiveColumn) return query;
  return query.is(LEDGER_ARCHIVED_AT, null) as Q;
}

export function withArchivedLedgerOnly<Q extends NotFilterable>(
  query: Q,
  ledgerArchiveColumn: boolean,
): Q {
  if (!ledgerArchiveColumn) return query;
  return query.not(LEDGER_ARCHIVED_AT, "is", null) as Q;
}
