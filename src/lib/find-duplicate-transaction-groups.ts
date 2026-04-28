import type { TransactionRow } from "@/types/finance";
import { transactionImportDedupeKey } from "@/lib/transaction-import-dedupe-key";

export type DuplicateTransactionGroup = {
  key: string;
  members: TransactionRow[];
};

/** First occurrence wins. Prevents duplicate array entries with the same id (breaks React keys and checkbox state). */
export function dedupeTransactionsById(rows: TransactionRow[]): TransactionRow[] {
  const seen = new Set<string>();
  const out: TransactionRow[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * Groups transactions that would be treated as the same row by CSV "skip duplicates"
 * (same date, amount, and raw description).
 */
export function findDuplicateTransactionGroups(
  rows: TransactionRow[],
): DuplicateTransactionGroup[] {
  const map = new Map<string, TransactionRow[]>();
  for (const t of dedupeTransactionsById(rows)) {
    if (!Number.isFinite(t.amount)) continue;
    const key = transactionImportDedupeKey(
      t.occurred_on,
      t.amount,
      t.raw_description,
    );
    const list = map.get(key);
    if (list) list.push(t);
    else map.set(key, [t]);
  }

  const out: DuplicateTransactionGroup[] = [];
  for (const [key, members] of map) {
    if (members.length < 2) continue;
    out.push({
      key,
      members: [...members].sort((a, b) => a.id.localeCompare(b.id)),
    });
  }

  out.sort((a, b) => {
    const da = b.members[0].occurred_on.localeCompare(a.members[0].occurred_on);
    if (da !== 0) return da;
    return a.key.localeCompare(b.key);
  });

  return out;
}

/** Credits only (positive amounts) — duplicate groups that inflate Overview income. */
export function filterIncomeDuplicateGroups(
  groups: DuplicateTransactionGroup[],
): DuplicateTransactionGroup[] {
  return groups.filter(
    (g) =>
      g.members.length > 0 &&
      Number.isFinite(g.members[0].amount) &&
      g.members[0].amount > 0,
  );
}
