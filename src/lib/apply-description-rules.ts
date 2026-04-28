import { normalizeDescription } from "@/lib/normalize-description";

export type DescriptionRuleRow = {
  match_normalized: string;
  replacement_raw: string;
};

export function buildDescriptionRuleMap(
  rows: DescriptionRuleRow[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const key = r.match_normalized.trim();
    if (key) m.set(key, r.replacement_raw.trim());
  }
  return m;
}

/**
 * If normalized raw text matches a household rule, use the replacement display string.
 */
export function applyDescriptionRules(
  rawFromSource: string,
  ruleMap: Map<string, string>,
): { raw_description: string; normalized_description: string } {
  const trimmed = rawFromSource.trim();
  const norm = normalizeDescription(trimmed);
  const repl = ruleMap.get(norm);
  if (repl != null && repl.length > 0) {
    return {
      raw_description: repl,
      normalized_description: normalizeDescription(repl),
    };
  }
  return {
    raw_description: trimmed,
    normalized_description: norm,
  };
}
