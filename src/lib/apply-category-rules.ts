import type { AmountSignFilter } from "@/lib/amount-sign-filter";
import {
  amountMatchesSignFilter,
  parseAmountSignFilter,
} from "@/lib/amount-sign-filter";
import { normalizeDescription } from "@/lib/normalize-description";

export type CategoryRuleRow = {
  category_id: string;
  match_type: "exact_normalized" | "contains" | "prefix";
  pattern: string;
  priority: number;
  amount_sign: AmountSignFilter;
  /** When set, the transaction's magnitude must equal this. null = any amount. */
  amount_exact: number | null;
};

/** Parse a stored/raw amount_exact into a non-negative number, or null. */
export function parseAmountExact(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "string" ? Number.parseFloat(raw) : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Map PostgREST rows to engine rules (shared by CSV import, Plaid sync, etc.). */
export function categoryRulesFromDb(
  rows: readonly Record<string, unknown>[],
): CategoryRuleRow[] {
  return rows.map((row) => ({
    category_id: String(row.category_id ?? ""),
    match_type: row.match_type as CategoryRuleRow["match_type"],
    pattern: String(row.pattern ?? ""),
    priority: Number(row.priority ?? 0),
    amount_sign: parseAmountSignFilter(row.amount_sign),
    amount_exact: parseAmountExact(row.amount_exact),
  }));
}

/**
 * True if a transaction magnitude satisfies the rule's exact-amount filter.
 * Compares the absolute value within half a cent to tolerate float rounding.
 */
export function categoryRuleAmountMatches(
  amount: number,
  amountExact: number | null,
): boolean {
  if (amountExact == null) return true;
  if (!Number.isFinite(amount)) return false;
  return Math.abs(Math.abs(amount) - amountExact) < 0.005;
}

/** True if a single rule’s pattern matches the normalized description. */
export function categoryRuleMatchesNormalized(
  normalizedDescription: string,
  rule: Pick<CategoryRuleRow, "match_type" | "pattern">,
): boolean {
  const n = normalizedDescription;
  const p = normalizeDescription(rule.pattern);
  if (rule.match_type === "exact_normalized") return n === p;
  if (rule.match_type === "contains") return p.length > 0 && n.includes(p);
  if (rule.match_type === "prefix") return p.length > 0 && n.startsWith(p);
  return false;
}

/**
 * Picks the highest-priority rule that matches the normalized description.
 */
export function resolveCategoryFromRules(
  normalizedDescription: string,
  amount: number,
  rules: CategoryRuleRow[],
): string | null {
  const n = normalizedDescription;
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    if (!amountMatchesSignFilter(amount, r.amount_sign)) continue;
    if (!categoryRuleAmountMatches(amount, r.amount_exact)) continue;
    if (categoryRuleMatchesNormalized(n, r)) {
      return r.category_id;
    }
  }
  return null;
}
