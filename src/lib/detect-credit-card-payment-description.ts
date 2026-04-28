/**
 * Text heuristics for "paying the card from checking" when the row is still
 * Uncategorized — keeps Overview spending from double-counting with card imports.
 */
export function descriptionExcludedFromOverviewAsCardPayment(
  normalizedDescription: string,
  rawDescription: string,
): boolean {
  const d = `${rawDescription} ${normalizedDescription}`.toLowerCase();
  if (!rawDescription.trim() && !normalizedDescription.trim()) {
    return false;
  }
  // Chase checking ACH: "CHASE CREDIT CRD DES:EPAY ..."
  if (/chase\s+credit\s+crd/.test(d) && /\bepay\b/.test(d)) return true;
  if (/credit\s+crd/.test(d) && /\bdes:?\s*epay\b/.test(d)) return true;
  if (/\bcrd\s+des:?\s*epay\b/.test(d)) return true;
  // Common card payment phrasing (many banks)
  if (/payment\s+thank\s+you/.test(d)) return true;
  if (/online\s+payment\s*[-–]?\s*thank/.test(d)) return true;
  if (/automatic\s+payment\s*[-–]?\s*thank/.test(d)) return true;
  if (
    /\bautopay\b/.test(d) &&
    /\b(visa|mastercard|amex|discover|american express|credit)\b/.test(d)
  ) {
    return true;
  }
  return false;
}
