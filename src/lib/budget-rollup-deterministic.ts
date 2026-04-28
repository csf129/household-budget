/**
 * Map spreadsheet lines to household categories by label/description matching.
 * Totals always equal the sum of line monthlyEquivalent values.
 */

import type { ExtractedBudgetLineJson } from "@/lib/parse-budget-spreadsheet";

export type CategoryIdName = { id: string; name: string };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((t) => t.length > 1);
}

/** Extra signal for common budget spreadsheet vocabulary. */
function bridgeScore(
  description: string,
  sheetCategory: string,
  categoryName: string,
): number {
  const d = description.toLowerCase();
  const sc = sheetCategory.toLowerCase();
  const cn = categoryName.toLowerCase();

  if (cn.includes("auto") && /car|vehicle|auto|santafe|forester|loan.*car/i.test(d)) {
    return 40;
  }
  if (
    cn.includes("bills") &&
    (/mortgage|utilities|verizon|electric|water|internet|phone|student loan/i.test(
      d,
    ) ||
      /\bbills\b/i.test(sc))
  ) {
    return 40;
  }
  if (
    cn.includes("entertainment") &&
    /netflix|spotify|hulu|streaming|audible|peloton|peleton|britbox|crunchyroll|chatgpt|cursor/i.test(
      d,
    )
  ) {
    return 35;
  }
  if (
    cn.includes("health") &&
    /medical|health|allergy|massage|prose|doctor|wellness|facs/i.test(d)
  ) {
    return 35;
  }
  if (cn.includes("education") && /school|education|ollie|tuition/i.test(d)) {
    return 35;
  }
  if (cn.includes("home") && /home|lowes|fridge|appliance|furniture/i.test(d)) {
    return 30;
  }
  if (cn.includes("groceries") && /grocery|groceries|food.*store|market/i.test(d)) {
    return 30;
  }
  if (
    cn.includes("food") &&
    /restaurant|dining|coffee|takeout|food\s*&\s*drink/i.test(d)
  ) {
    return 28;
  }
  if (cn.includes("gas") && /\bgas\b|fuel|gasoline/i.test(d)) {
    return 35;
  }
  if (cn.includes("travel") && /travel|flight|hotel|airbnb/i.test(d)) {
    return 30;
  }
  if (cn.includes("shopping") && /shopping|amazon|retail/i.test(d)) {
    return 25;
  }
  if (cn.includes("personal") && /\bpersonal\b/i.test(sc)) {
    return 25;
  }
  if (
    (cn.includes("misc") || cn.includes("other")) &&
    (/^other$/i.test(sc) || /\bother\b/i.test(sc))
  ) {
    return 20;
  }
  return 0;
}

function baseScore(
  line: ExtractedBudgetLineJson,
  categoryName: string,
): number {
  const cn = norm(categoryName);
  const sc = norm(line.sheetCategory);
  const de = norm(line.description);
  let score = bridgeScore(line.description, line.sheetCategory, categoryName);

  if (sc && cn.includes(sc)) score += 24;
  else if (sc && sc.includes(cn)) score += 18;

  for (const t of tokens(line.sheetCategory)) {
    if (t.length < 3) continue;
    if (cn.includes(t)) score += 6;
  }
  for (const t of tokens(line.description)) {
    if (t.length < 4) continue;
    if (cn.includes(t)) score += 2;
  }
  if (de && cn.includes(de) && de.length > 3) score += 8;

  return score;
}

function pickMiscCategory(categories: CategoryIdName[]): string | null {
  const misc =
    categories.find((c) => /misc|other|general/i.test(c.name)) ?? null;
  return misc?.id ?? categories[0]?.id ?? null;
}

export function rollupSpreadsheetLinesToCategoryBudgets(
  lines: ExtractedBudgetLineJson[],
  categories: CategoryIdName[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const c of categories) {
    totals.set(c.id, 0);
  }

  if (categories.length === 0) return totals;

  const miscId = pickMiscCategory(categories);

  for (const line of lines) {
    let best: { id: string; score: number } | null = null;
    for (const c of categories) {
      const s = baseScore(line, c.name);
      if (!best || s > best.score) {
        best = { id: c.id, score: s };
      }
    }
    const target =
      best && best.score >= 4 ? best.id : (miscId ?? categories[0]!.id);
    const amt = line.monthlyEquivalent;
    if (!Number.isFinite(amt)) continue;
    totals.set(target, (totals.get(target) ?? 0) + amt);
  }

  return totals;
}

export function proposalsFromRollupMap(
  categories: CategoryIdName[],
  byId: Map<string, number>,
): { categoryId: string; monthlyBudget: number }[] {
  return categories.map((c) => ({
    categoryId: c.id,
    monthlyBudget: Math.round((byId.get(c.id) ?? 0) * 100) / 100,
  }));
}
