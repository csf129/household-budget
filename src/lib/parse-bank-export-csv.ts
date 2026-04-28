import type { BankCsvImportRow } from "@/lib/bank-csv-types";
import { parseBoaStatementCsv } from "@/lib/parse-boa-stmt-csv";
import { parseChaseActivityCsv } from "@/lib/parse-chase-csv";

export type BankExportFormat = "chase" | "boa" | null;

export type ParseBankExportResult = {
  format: BankExportFormat;
  rows: BankCsvImportRow[];
  errors: string[];
  rowCount: number;
};

/**
 * Detects Chase activity vs Bank of America statement CSV and parses.
 */
export function parseBankExportCsv(csvText: string): ParseBankExportResult {
  const t = csvText.replace(/^\uFEFF/, "");
  const likelyChase =
    /\bTransaction Date\b/i.test(t) && /\bPost Date\b/i.test(t);

  if (likelyChase) {
    const r = parseChaseActivityCsv(t);
    return { format: "chase", ...r };
  }

  const boa = parseBoaStatementCsv(t);
  if (boa.rows.length > 0) {
    return { format: "boa", ...boa };
  }

  const chase = parseChaseActivityCsv(t);
  if (chase.rows.length > 0) {
    return { format: "chase", ...chase };
  }

  return {
    format: null,
    rows: [],
    errors: [
      ...boa.errors,
      ...chase.errors,
      "Could not parse as Chase activity or Bank of America statement CSV.",
    ],
    rowCount: Math.max(boa.rowCount, chase.rowCount),
  };
}
