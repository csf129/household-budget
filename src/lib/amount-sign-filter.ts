export type AmountSignFilter = "any" | "positive" | "negative";

export function parseAmountSignFilter(raw: unknown): AmountSignFilter {
  if (raw === "positive" || raw === "negative" || raw === "any") return raw;
  return "any";
}

/** Whether a transaction amount satisfies the rule’s sign filter. */
export function amountMatchesSignFilter(
  amount: number,
  filter: AmountSignFilter,
): boolean {
  if (!Number.isFinite(amount) || amount === 0) return false;
  if (filter === "any") return true;
  if (filter === "positive") return amount > 0;
  return amount < 0;
}

/** Sign used when saving “remember category” from a single transaction. */
export function amountSignForRememberRule(amount: number): "positive" | "negative" {
  return amount > 0 ? "positive" : "negative";
}
