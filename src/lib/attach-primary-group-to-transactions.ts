import type {
  CategoryRow,
  PrimaryCategoryGroupRow,
  TransactionRow,
} from "@/types/finance";

/**
 * Fills `categories.primary_group` from the household category catalog.
 * PostgREST sometimes omits nested `primary_category_groups` on transaction embeds;
 * Settings still shows the correct primary because `categories.primary_group_id` is set.
 */
export function attachPrimaryGroupsFromCategoryCatalog(
  transactions: TransactionRow[],
  categories: CategoryRow[],
  primaryGroups: PrimaryCategoryGroupRow[],
): TransactionRow[] {
  const catById = new Map<string, CategoryRow>(
    categories.map((c) => [String(c.id), c]),
  );
  const primaryById = new Map<string, PrimaryCategoryGroupRow>(
    primaryGroups.map((g) => [String(g.id), g]),
  );

  return transactions.map((t) => {
    if (!t.category_id) return t;
    const cat = catById.get(String(t.category_id));
    if (!cat) return t;

    // For subcategories, resolve parent name and inherit primary_group_id if not set directly.
    const parentCat =
      cat.parent_category_id != null
        ? catById.get(String(cat.parent_category_id))
        : undefined;
    const parent =
      parentCat?.name?.trim()
        ? { name: parentCat.name.trim() }
        : undefined;

    const pgId = cat.primary_group_id ?? parentCat?.primary_group_id ?? null;
    const pg = pgId ? primaryById.get(String(pgId)) : undefined;

    // Only update the transaction if we have something new to add.
    if (!pg?.slug && !parent) return t;

    const primary_group = pg?.slug ? { slug: pg.slug, name: pg.name } : t.categories?.primary_group ?? null;

    if (t.categories) {
      return {
        ...t,
        categories: {
          ...t.categories,
          primary_group,
          ...(parent ? { parent } : {}),
        },
      };
    }
    return {
      ...t,
      categories: {
        name: cat.name,
        color: cat.color,
        primary_group,
        ...(parent ? { parent } : {}),
      },
    };
  });
}
