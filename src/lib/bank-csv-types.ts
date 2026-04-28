/**
 * Normalized row from Chase activity CSV or Bank of America statement CSV
 * before household category resolution (rules + optional bank name hints).
 */
export type BankCsvImportRow = {
  occurred_on: string;
  raw_description: string;
  normalized_description: string;
  amount: number;
  /** Chase "Category" column when present; empty for Bank of America. */
  bankCategoryHint: string;
};
