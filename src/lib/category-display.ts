import type { BudgetRecurringInterval, CategoryRow } from "@/types/finance";

const RECURRING_INTERVALS = new Set<string>([
  "weekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
]);

/** Normalizes a Supabase `categories` row into `CategoryRow`. */
export function mapCategoryRowFromSupabase(c: {
  id: unknown;
  name: unknown;
  color?: unknown;
  sort_order?: unknown;
  description?: unknown;
  primary_group_id?: unknown;
  monthly_budget?: unknown;
  parent_category_id?: unknown;
  budget_repeats_annually?: unknown;
  budget_active_from_month?: unknown;
  budget_active_from_day?: unknown;
  budget_active_to_month?: unknown;
  budget_active_to_day?: unknown;
  budget_period_start?: unknown;
  budget_period_end?: unknown;
  budget_amount_period?: unknown;
  budget_annual_payment_month?: unknown;
  budget_recurring_payment?: unknown;
  budget_recurring_interval?: unknown;
}): CategoryRow {
  return {
    id: String(c.id),
    name: String(c.name ?? ""),
    color: c.color != null ? String(c.color) : null,
    sort_order: Number(c.sort_order ?? 0),
    description:
      c.description !== undefined && c.description != null
        ? String(c.description)
        : null,
    primary_group_id:
      c.primary_group_id != null ? String(c.primary_group_id) : null,
    monthly_budget:
      c.monthly_budget != null && c.monthly_budget !== ""
        ? Number(c.monthly_budget)
        : null,
    parent_category_id:
      c.parent_category_id != null && String(c.parent_category_id).trim() !== ""
        ? String(c.parent_category_id)
        : null,
    budget_repeats_annually:
      c.budget_repeats_annually === undefined || c.budget_repeats_annually === null
        ? true
        : Boolean(c.budget_repeats_annually),
    budget_active_from_month:
      c.budget_active_from_month != null && c.budget_active_from_month !== ""
        ? Number(c.budget_active_from_month)
        : null,
    budget_active_from_day:
      c.budget_active_from_day != null && c.budget_active_from_day !== ""
        ? Number(c.budget_active_from_day)
        : null,
    budget_active_to_month:
      c.budget_active_to_month != null && c.budget_active_to_month !== ""
        ? Number(c.budget_active_to_month)
        : null,
    budget_active_to_day:
      c.budget_active_to_day != null && c.budget_active_to_day !== ""
        ? Number(c.budget_active_to_day)
        : null,
    budget_period_start:
      c.budget_period_start != null && String(c.budget_period_start).trim() !== ""
        ? String(c.budget_period_start).slice(0, 10)
        : null,
    budget_period_end:
      c.budget_period_end != null && String(c.budget_period_end).trim() !== ""
        ? String(c.budget_period_end).slice(0, 10)
        : null,
    budget_amount_period:
      c.budget_amount_period === "week"
        ? "week"
        : c.budget_amount_period === "year"
          ? "year"
          : "month",
    budget_annual_payment_month:
      c.budget_annual_payment_month != null &&
      c.budget_annual_payment_month !== ""
        ? Number(c.budget_annual_payment_month)
        : null,
    budget_recurring_payment: Boolean(c.budget_recurring_payment),
    budget_recurring_interval: (() => {
      const raw =
        c.budget_recurring_interval != null &&
        c.budget_recurring_interval !== ""
          ? String(c.budget_recurring_interval)
          : "";
      return RECURRING_INTERVALS.has(raw)
        ? (raw as BudgetRecurringInterval)
        : null;
    })(),
  };
}

/** "Parent › Subcategory" for subcategories; plain name for top-level. */
export function formatCategoryLabel(c: CategoryRow, all: CategoryRow[]): string {
  if (!c.parent_category_id) return c.name;
  const p = all.find((x) => x.id === c.parent_category_id);
  return p ? `${p.name} › ${c.name}` : c.name;
}

/**
 * Top-level categories first (by sort_order/name), then each one’s subcategories.
 */
export function sortCategoriesForPicker(cats: CategoryRow[]): CategoryRow[] {
  const parents = cats
    .filter((c) => !c.parent_category_id)
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.name.localeCompare(b.name);
    });
  const out: CategoryRow[] = [];
  for (const p of parents) {
    out.push(p);
    cats
      .filter((c) => c.parent_category_id === p.id)
      .sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name);
      })
      .forEach((s) => out.push(s));
  }
  const seen = new Set(out.map((c) => c.id));
  for (const c of cats) {
    if (!seen.has(c.id)) out.push(c);
  }
  return out;
}
