import Papa from "papaparse";
import { normalizeDescription } from "@/lib/normalize-description";
import type { BankCsvImportRow } from "@/lib/bank-csv-types";
import { parseChaseTransactionDate } from "@/lib/parse-chase-csv";

function parseMoney(raw: string): number | null {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

function rowField(row: Record<string, string>, ...candidates: string[]): string {
  const keys = Object.keys(row);
  for (const name of candidates) {
    const target = name.toLowerCase().replace(/\.$/, "");
    const hit = keys.find((k) => {
      const kk = k.trim().toLowerCase().replace(/\.$/, "");
      return kk === target;
    });
    if (hit !== undefined) {
      const v = row[hit];
      return v == null ? "" : String(v);
    }
  }
  return "";
}

const SKIP_DESCRIPTION = new RegExp(
  [
    "^\\s*beginning balance",
    "^\\s*ending balance",
    "^\\s*total credits",
    "^\\s*total debits",
  ].join("|"),
  "i",
);

function shouldSkipDescription(desc: string): boolean {
  return SKIP_DESCRIPTION.test(desc.trim()) || desc.trim() === "";
}

export type ParseBoaStmtResult = {
  rows: BankCsvImportRow[];
  errors: string[];
  rowCount: number;
};

/**
 * Bank of America checking/savings statement CSV with a section:
 * Date, Description, Amount, Running Bal.
 * (Preceded by summary rows — we locate the ledger header and parse below.)
 */
export function parseBoaStatementCsv(csvText: string): ParseBoaStmtResult {
  const errors: string[] = [];
  const bomStripped = csvText.replace(/^\uFEFF/, "");
  const lines = bomStripped.split(/\r?\n/);

  const headerIdx = lines.findIndex((line) => {
    const l = line.trim().toLowerCase();
    if (!l.startsWith("date,")) return false;
    return (
      l.includes("description") &&
      l.includes("amount") &&
      (l.includes("running bal") || l.includes("running balance"))
    );
  });

  if (headerIdx < 0) {
    errors.push(
      "Could not find a Bank of America transaction table (look for a header row: Date, Description, Amount, Running Bal.).",
    );
    return { rows: [], errors, rowCount: 0 };
  }

  const section = lines.slice(headerIdx).join("\n");
  const parsed = Papa.parse<Record<string, string>>(section, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0) {
    for (const e of parsed.errors.slice(0, 5)) {
      errors.push(
        e.row != null
          ? `CSV row ${headerIdx + e.row + 2}: ${e.message}`
          : e.message,
      );
    }
  }

  const data = parsed.data.filter((r) =>
    Object.values(r).some((v) => String(v ?? "").trim() !== ""),
  );

  const rows: BankCsvImportRow[] = [];
  let skipped = 0;

  data.forEach((row, index) => {
    const dateRaw = rowField(row, "Date");
    const iso = parseChaseTransactionDate(dateRaw);
    if (!iso) {
      skipped += 1;
      return;
    }

    const descRaw = rowField(row, "Description").trim();
    if (shouldSkipDescription(descRaw)) {
      skipped += 1;
      return;
    }

    const amountRaw = rowField(row, "Amount");
    const amount = parseMoney(amountRaw);
    if (amount === null) {
      skipped += 1;
      return;
    }

    rows.push({
      occurred_on: iso,
      raw_description: descRaw,
      normalized_description: normalizeDescription(descRaw),
      amount,
      bankCategoryHint: "",
    });
  });

  if (rows.length === 0 && data.length > 0) {
    errors.push(
      "No transaction rows were imported. Check that Date, Description, and Amount columns contain normal activity lines (balance summary lines are skipped).",
    );
  }

  return {
    rows,
    errors,
    rowCount: data.length,
  };
}
