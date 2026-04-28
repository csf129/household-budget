import type { CategoryRow } from "@/types/finance";

/**
 * Maps Chase CSV "Category" text to a household category id by case-insensitive name match.
 */
export function matchChaseCategoryToId(
  chaseCategory: string,
  householdCategories: CategoryRow[],
): string | null {
  const t = chaseCategory.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const hit = householdCategories.find((c) => c.name.toLowerCase() === lower);
  return hit?.id ?? null;
}

/** Case-insensitive match on full category name (e.g. seed template "Credit card payment"). */
export function resolveCategoryIdByCanonicalName(
  householdCategories: CategoryRow[],
  nameCaseInsensitive: string,
): string | null {
  const target = nameCaseInsensitive.trim().toLowerCase();
  const hit = householdCategories.find(
    (c) => c.name.trim().toLowerCase() === target,
  );
  return hit?.id ?? null;
}
