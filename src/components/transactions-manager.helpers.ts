import type { DuplicateTransactionGroup } from "@/lib/find-duplicate-transaction-groups";
import type { TransactionRow } from "@/types/finance";

/**
 * Pure helpers extracted from transactions-manager.tsx. No React, no component
 * state — safe to unit-test in isolation.
 */

export const CREDIT_CARD_PAYMENT_CATEGORY = "credit card payment";

export function parseAmount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value);
  return Number.NaN;
}

/** Every whitespace-separated token must appear (case-insensitive) in the combined text. */
export function transactionMatchesKeywordSearch(
  t: TransactionRow,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  const primaryName = t.categories?.primary_group?.name ?? "";
  const hay = [
    t.raw_description,
    t.normalized_description,
    t.notes ?? "",
    t.categories?.name ?? "",
    primaryName,
    t.occurred_on,
    String(t.amount),
  ]
    .join(" ")
    .toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
}

/**
 * Default "delete these" selection for a set of duplicate groups: keep the first
 * member of each group, suggest removing the rest.
 */
export function suggestedDupDeleteIds(
  groups: DuplicateTransactionGroup[],
): Set<string> {
  const s = new Set<string>();
  for (const g of groups) {
    for (let i = 1; i < g.members.length; i++) {
      s.add(g.members[i].id);
    }
  }
  return s;
}
