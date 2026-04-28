import { parseAmountSignFilter } from "@/lib/amount-sign-filter";
import type { IncomeRuleView } from "@/types/finance";

export function mapIncomeRuleRow(raw: unknown): IncomeRuleView {
  const r = raw as Record<string, unknown>;
  const mt = r.match_type;
  const match_type =
    mt === "exact_normalized" || mt === "contains" || mt === "prefix"
      ? mt
      : "contains";
  const tr = r.treatment;
  const treatment =
    tr === "include" || tr === "exclude" ? tr : "exclude";

  return {
    id: String(r.id),
    match_type,
    pattern: String(r.pattern ?? ""),
    priority: Number(r.priority ?? 100),
    treatment,
    amount_sign: parseAmountSignFilter(r.amount_sign),
  };
}
