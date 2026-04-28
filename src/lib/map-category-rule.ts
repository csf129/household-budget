import { parseAmountSignFilter } from "@/lib/amount-sign-filter";
import type { CategoryRuleView } from "@/types/finance";

/**
 * PostgREST fragment for `category_rules` selects so embedded categories include
 * parent name for `Parent › Child` display names.
 */
export const CATEGORY_RULE_CATEGORIES_EMBED = `categories (
  name,
  color,
  parent_category_id,
  parent:parent_category_id ( name )
)`;

function readParentNameFromEmbed(
  parentField: unknown,
): string | null {
  if (!parentField || typeof parentField !== "object") return null;
  if (Array.isArray(parentField)) {
    const first = parentField[0];
    if (first && typeof first === "object") {
      const n = String((first as Record<string, unknown>).name ?? "").trim();
      return n || null;
    }
    return null;
  }
  const n = String((parentField as Record<string, unknown>).name ?? "").trim();
  return n || null;
}

function categoryDisplayFromEmbed(embed: unknown): {
  displayName: string;
  color: string | null;
} {
  let c: Record<string, unknown> | null = null;
  if (Array.isArray(embed) && embed[0] && typeof embed[0] === "object") {
    c = embed[0] as Record<string, unknown>;
  } else if (embed && typeof embed === "object" && !Array.isArray(embed)) {
    c = embed as Record<string, unknown>;
  }
  if (!c) return { displayName: "", color: null };
  const childName = String(c.name ?? "");
  const color = c.color != null ? String(c.color) : null;
  const parentName = readParentNameFromEmbed(c.parent);
  const displayName =
    parentName && childName.trim()
      ? `${parentName} › ${childName.trim()}`
      : childName;
  return { displayName, color };
}

/**
 * Normalizes PostgREST rows with embedded `categories`.
 */
export function mapCategoryRuleRow(raw: unknown): CategoryRuleView {
  const r = raw as Record<string, unknown>;
  const embed = r.categories;
  const { displayName: categoryName, color: categoryColor } =
    categoryDisplayFromEmbed(embed);

  const mt = r.match_type;
  const match_type =
    mt === "exact_normalized" || mt === "contains" || mt === "prefix"
      ? mt
      : "contains";

  return {
    id: String(r.id),
    category_id: String(r.category_id ?? ""),
    category_name: categoryName,
    category_color: categoryColor,
    match_type,
    pattern: String(r.pattern ?? ""),
    priority: Number(r.priority ?? 100),
    amount_sign: parseAmountSignFilter(r.amount_sign),
  };
}
