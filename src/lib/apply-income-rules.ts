import type { AmountSignFilter } from "@/lib/amount-sign-filter";
import { amountMatchesSignFilter } from "@/lib/amount-sign-filter";
import { normalizeDescription } from "@/lib/normalize-description";

export type IncomeRuleTreatment = "include" | "exclude";

export type IncomeRuleRow = {
  match_type: "exact_normalized" | "contains" | "prefix";
  pattern: string;
  priority: number;
  treatment: IncomeRuleTreatment;
  amount_sign: AmountSignFilter;
};

/**
 * Highest-priority rule wins. Returns null if no rule matches.
 */
export function resolveIncomeTreatmentFromRules(
  normalizedDescription: string,
  amount: number,
  rules: IncomeRuleRow[],
): IncomeRuleTreatment | null {
  const n = normalizedDescription;
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    if (!amountMatchesSignFilter(amount, r.amount_sign)) continue;
    const p = normalizeDescription(r.pattern);
    if (r.match_type === "exact_normalized" && n === p) {
      return r.treatment;
    }
    if (r.match_type === "contains" && p.length > 0) {
      const shortSingleToken = !/\s/.test(p) && p.length <= 5;
      const matches = shortSingleToken
        ? (() => {
            try {
              const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              return new RegExp(`\\b${escaped}\\b`, "i").test(n);
            } catch {
              return n.includes(p);
            }
          })()
        : n.includes(p);
      if (matches) return r.treatment;
    }
    if (r.match_type === "prefix" && p.length > 0 && n.startsWith(p)) {
      return r.treatment;
    }
  }
  return null;
}
