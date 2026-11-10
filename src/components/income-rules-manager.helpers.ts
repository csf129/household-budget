import type { IncomeRuleRow as EngineIncomeRuleRow } from "@/lib/apply-income-rules";
import type { AmountSignFilter, IncomeRuleView } from "@/types/finance";

/**
 * Pure helpers and option lists extracted from income-rules-manager.tsx.
 * No React, no state.
 */

export const MATCH_TYPES: {
  value: IncomeRuleView["match_type"];
  label: string;
  hint: string;
}[] = [
  {
    value: "exact_normalized",
    label: "Exact match",
    hint: "Entire normalized description must equal this text.",
  },
  {
    value: "contains",
    label: "Contains",
    hint: "Normalized description includes this substring.",
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

export function rulesForEngine(list: IncomeRuleView[]): EngineIncomeRuleRow[] {
  return list.map((r) => ({
    match_type: r.match_type,
    pattern: r.pattern,
    priority: r.priority,
    treatment: r.treatment,
    amount_sign: r.amount_sign,
  }));
}
