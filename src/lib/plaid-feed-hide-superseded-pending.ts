import type { TransactionRow } from "@/types/finance";

const PENDING_PLAID_NOTE = "Pending (Plaid)";

function calendarDaysApart(a: string, b: string): number | null {
  const ma = /^(\d{4})-(\d{2})-(\d{2})/.exec(a);
  const mb = /^(\d{4})-(\d{2})-(\d{2})/.exec(b);
  if (!ma || !mb) return null;
  const da = Date.UTC(+ma[1], +ma[2] - 1, +ma[3]);
  const db = Date.UTC(+mb[1], +mb[2] - 1, +mb[3]);
  return Math.abs(Math.round((da - db) / 86400000));
}

/**
 * After a pending charge posts, Plaid uses a new `transaction_id` and the ledger
 * row is updated to that id. The old pending id can still exist in `plaid_transactions`,
 * so feed-only rows would duplicate the posted ledger row. Drop those stale pending
 * feed rows when a ledger mirror matches (same account, amount, normalized description,
 * dates within two calendar days).
 */
export function hideSupersededPendingPlaidFeedRows(
  feedRows: TransactionRow[],
  ledgerRows: TransactionRow[],
): TransactionRow[] {
  const mirrors = ledgerRows.filter((r) => !r.plaid_feed_only);
  return feedRows.filter((f) => !shouldHidePendingFeedDuplicate(f, mirrors));
}

function shouldHidePendingFeedDuplicate(
  feed: TransactionRow,
  ledgerMirrors: TransactionRow[],
): boolean {
  if (!feed.plaid_feed_only) return false;
  if (feed.notes !== PENDING_PLAID_NOTE) return false;
  const fb = feed.bank_account_id?.trim() ?? null;
  for (const L of ledgerMirrors) {
    if (L.plaid_feed_only) continue;
    const lb = L.bank_account_id?.trim() ?? null;
    if (fb && lb && fb !== lb) continue;
    if (Math.abs(feed.amount - L.amount) >= 0.009) continue;
    if (feed.normalized_description !== L.normalized_description) continue;
    const days = calendarDaysApart(feed.occurred_on, L.occurred_on);
    if (days != null && days <= 2) return true;
  }
  return false;
}
