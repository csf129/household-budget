import Papa from "papaparse";
import type { BankCsvImportRow } from "@/lib/bank-csv-types";
import { normalizeDescription } from "@/lib/normalize-description";

export type { BankCsvImportRow } from "@/lib/bank-csv-types";

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/gi, " ");
}

/** Chase / Bank of America exports often use MM/DD/YYYY */
export function parseChaseTransactionDate(value: string): string | null {
  const s = value.trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = m[1]!.padStart(2, "0");
  const dd = m[2]!.padStart(2, "0");
  const yyyy = m[3]!;
  return `${yyyy}-${mm}-${dd}`;
}

function rowField(row: Record<string, string>, ...candidates: string[]): string {
  const keys = Object.keys(row);
  for (const name of candidates) {
    const target = name.toLowerCase();
    const hit = keys.find((k) => k.trim().toLowerCase() === target);
    if (hit !== undefined) {
      const v = row[hit];
      return v == null ? "" : String(v);
    }
  }
  return "";
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

export type ParseChaseCsvResult = {
  rows: BankCsvImportRow[];
  errors: string[];
  rowCount: number;
};

/**
 * Parses Chase credit card / account "Activity" CSV
 * (headers like Transaction Date, Post Date, Description, Category, Type, Amount, Memo).
 */
export function parseChaseActivityCsv(csvText: string): ParseChaseCsvResult {
  const errors: string[] = [];
  const bomStripped = csvText.replace(/^\uFEFF/, "");

  const parsed = Papa.parse<Record<string, string>>(bomStripped, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0) {
    for (const e of parsed.errors.slice(0, 5)) {
      errors.push(
        e.row != null
          ? `CSV row ${e.row + 1}: ${e.message}`
          : e.message,
      );
    }
  }

  const data = parsed.data.filter((r) =>
    Object.values(r).some((v) => String(v ?? "").trim() !== ""),
  );

  if (data.length === 0) {
    errors.push("No data rows found after the header.");
    return { rows: [], errors, rowCount: 0 };
  }

  const first = data[0]!;
  const hasDate =
    rowField(first, "Transaction Date", "Posting Date") !== "";
  const hasDesc = rowField(first, "Description") !== "";
  const hasAmt = rowField(first, "Amount") !== "";
  if (!hasDate || !hasDesc || !hasAmt) {
    errors.push(
      "This file does not look like a Chase activity export (need Transaction Date, Description, and Amount columns).",
    );
  }

  const rows: BankCsvImportRow[] = [];
  data.forEach((row, index) => {
    const dateRaw = rowField(row, "Transaction Date", "Trans Date");
    const iso = parseChaseTransactionDate(dateRaw);
    if (!iso) {
      errors.push(`Row ${index + 2}: bad transaction date "${dateRaw}".`);
      return;
    }
    const descRaw = rowField(row, "Description");
    const description = decodeHtmlEntities(descRaw.trim());
    if (!description) {
      errors.push(`Row ${index + 2}: missing description.`);
      return;
    }
    const amountRaw = rowField(row, "Amount");
    const amount = parseAmount(amountRaw);
    if (amount === null) {
      const z = amountRaw.trim().replace(/[$,\s]/g, "");
      const parsedZ = Number.parseFloat(z);
      if (z !== "" && Number.isFinite(parsedZ) && parsedZ === 0) {
        return;
      }
      errors.push(`Row ${index + 2}: bad amount "${amountRaw}".`);
      return;
    }

    const memo = rowField(row, "Memo").trim();
    const raw_description =
      memo.length > 0 ? `${description} (${memo})` : description;

    rows.push({
      occurred_on: iso,
      raw_description,
      normalized_description: normalizeDescription(raw_description),
      amount,
      bankCategoryHint: rowField(row, "Category").trim(),
    });
  });

  return { rows, errors, rowCount: data.length };
}
