import type { CategoryRow, PrimaryCategoryGroupRow } from "@/types/finance";

/**
 * Pure helpers extracted from categories-manager.tsx — no React, no state.
 */

export const PRESET_COLORS = [
  "#0ea5e9",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#6366f1",
  "#64748b",
];

/** Order by sort_order, then by name (locale-aware) as a stable tiebreak. */
export function sortCategories(list: CategoryRow[]): CategoryRow[] {
  return [...list].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name);
  });
}

export function sortPrimaryGroups(
  list: PrimaryCategoryGroupRow[],
): PrimaryCategoryGroupRow[] {
  return [...list].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name);
  });
}
