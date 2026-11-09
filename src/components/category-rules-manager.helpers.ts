import type { CategoryRuleRow as EngineRuleRow } from "@/lib/apply-category-rules";
import type { AmountSignFilter, CategoryRuleView } from "@/types/finance";

/**
 * Pure helpers and option lists extracted from category-rules-manager.tsx.
 * No React, no state.
 */

export const MATCH_TYPES: {
  value: CategoryRuleView["match_type"];
  label: string;
  hint: string;
}[] = [
  {
    value: "exact_normalized",
    label: "Exact match",
    hint: "Entire normalized description must equal this text (after trim, lowercase, single spaces).",
  },
  {
    value: "contains",
    label: "Contains",
    hint: "Normalized description includes this substring anywhere.",
  },
  {
    value: "prefix",
    label: "Starts with",
    hint: "Normalized description begins with this text.",
  },
];

export const AMOUNT_SIGN_OPTIONS: { value: AmountSignFilter; label: string }[] = [
  { value: "any", label: "Any (credits or debits)" },
  { value: "positive", label: "Positive amounts only" },
  { value: "negative", label: "Negative amounts only" },
];

export function amountSignShortLabel(v: AmountSignFilter): string {
  if (v === "positive") return "Positive";
  if (v === "negative") return "Negative";
  return "Any";
}

export function rulesForEngine(list: CategoryRuleView[]): EngineRuleRow[] {
  return list.map((r) => ({
    category_id: r.category_id,
    match_type: r.match_type,
    pattern: r.pattern,
    priority: r.priority,
    amount_sign: r.amount_sign,
    amount_exact: r.amount_exact,
  }));
}
