/**
 * Same key as CSV import skip-duplicates: date + amount (2 decimals) + trimmed raw description.
 */
export function transactionImportDedupeKey(
  occurredOn: string,
  amount: number,
  rawDescription: string,
): string {
  return `${String(occurredOn)}|${amount.toFixed(2)}|${rawDescription.trim()}`;
}

/**
 * For matching CSV rows to Plaid when raw descriptions differ (same normalized text).
 */
export function transactionNormalizedDedupeKey(
  occurredOn: string,
  amount: number,
  normalizedDescription: string,
): string {
  return `${String(occurredOn)}|${amount.toFixed(2)}|${normalizedDescription.trim()}`;
}
