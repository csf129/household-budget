/**
 * Extract budget line items from a household spreadsheet (e.g. Excel export).
 * Tolerant of common layouts: primary block columns A–D, optional right-side amounts.
 */

import * as XLSX from "xlsx";

export type ExtractedBudgetLineJson = {
  description: string;
  sheetCategory: string;
  /** Raw amount as printed in the sheet for that line's period. */
  rawAmount: number;
  /** Normalized monthly USD equivalent for budgeting. */
  monthlyEquivalent: number;
  period: "monthly" | "annual";
};

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(/[$,]/g, "");
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const SKIP_DESC = new Set(
  [
    "",
    "expenses",
    "category",
    "total",
    "set amounts",
    "estimated amounts",
    "annual payments",
    "monthly payments",
  ].map((s) => s.toLowerCase()),
);

function shouldSkipDescription(desc: string): boolean {
  const d = desc.trim().toLowerCase();
  if (!d) return true;
  if (SKIP_DESC.has(d)) return true;
  if (/^total\b/i.test(d)) return true;
  if (/^monthly\s*payments$/i.test(d)) return true;
  if (/^annual\s*payments$/i.test(d)) return true;
  return false;
}

function periodFromHints(...hints: string[]): "monthly" | "annual" {
  const h = hints.join(" ").toLowerCase();
  if (/\byr\b|\/yr|annual|year/i.test(h)) return "annual";
  return "monthly";
}

/**
 * Parse first worksheet from an .xlsx buffer.
 */
export function parseBudgetSpreadsheetBuffer(
  buffer: ArrayBuffer,
): ExtractedBudgetLineJson[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });
  const name = wb.SheetNames[0];
  if (!name) return [];
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];

  const out: ExtractedBudgetLineJson[] = [];
  let block: "none" | "monthly" | "annual" = "none";

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const a = cellStr(row[0]);
    const b = cellStr(row[1]);
    const c = row[2];
    const d = cellStr(row[3]);

    if (/monthly\s*payments/i.test(a)) {
      block = "monthly";
      continue;
    }
    if (/annual\s*payments/i.test(a)) {
      block = "annual";
      continue;
    }

    if (block !== "none") {
      const raw = parseAmount(c);
      if (raw !== null && !shouldSkipDescription(a)) {
        const period = block === "annual" ? "annual" : periodFromHints(d);
        const monthlyEquivalent = period === "annual" ? raw / 12 : raw;
        out.push({
          description: a,
          sheetCategory: b || "General",
          rawAmount: raw,
          monthlyEquivalent,
          period,
        });
      }

      // Right-side block: only inside expense sections (same rows as the sheet’s
      // second table). Omitting this on header/income rows avoids bogus $1–$10 lines.
      const g = cellStr(row[6]);
      const amtRight = parseAmount(row[8]);
      const tailHint = cellStr(row[7]) + " " + cellStr(row[9]);
      if (g && amtRight !== null && amtRight > 0 && !shouldSkipDescription(g)) {
        const period = periodFromHints(tailHint);
        const monthlyEquivalent = period === "annual" ? amtRight / 12 : amtRight;
        out.push({
          description: g,
          sheetCategory: "Other",
          rawAmount: amtRight,
          monthlyEquivalent,
          period,
        });
      }
    }
  }

  // De-dupe identical description + amount (left + right blocks)
  const seen = new Set<string>();
  return out.filter((line) => {
    const key = `${line.description}\0${line.monthlyEquivalent.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
