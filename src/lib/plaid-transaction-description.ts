/**
 * Combine Plaid `merchant_name` and `name` so rule matching (e.g. "venmo") sees
 * text that may appear in only one of the fields.
 */
export function plaidTransactionDisplayDescription(t: {
  name?: string | null;
  merchant_name?: string | null;
}): string {
  const namePart = (t.name ?? "").trim();
  const merchPart = (t.merchant_name ?? "").trim();
  if (!merchPart && !namePart) return "Transaction";
  if (!merchPart) return namePart;
  if (!namePart) return merchPart;
  if (merchPart.toLowerCase() === namePart.toLowerCase()) return merchPart;
  return `${merchPart} ${namePart}`;
}
