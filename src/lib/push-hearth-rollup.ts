import type { SupabaseClient } from "@supabase/supabase-js";
import type { HearthRollup } from "@/lib/hearth-rollup";

/**
 * Write a computed rollup into Hearth's `finance_*` tables for one Hearth
 * household. Mirror, not merge: the per-category and trend rows are replaced
 * wholesale each time, so a category deleted in the budget app disappears from
 * Hearth rather than lingering. The snapshot is a single upserted row.
 *
 * `hearth` must be a Hearth service-role client (see createHearthAdminClient).
 */
export async function pushHearthRollup(
  hearth: SupabaseClient,
  hearthHouseholdId: string,
  rollup: HearthRollup,
): Promise<void> {
  const snapErr = (
    await hearth.from("finance_snapshots").upsert(
      {
        household_id: hearthHouseholdId,
        as_of: rollup.as_of,
        currency: rollup.currency,
        week_start: rollup.week.start,
        week_end: rollup.week.end,
        week_budget: rollup.week.budget,
        week_spent: rollup.week.spent,
        week_income: rollup.week.income,
        month_start: rollup.month.start,
        month_end: rollup.month.end,
        month_budget: rollup.month.budget,
        month_spent: rollup.month.spent,
        month_income: rollup.month.income,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id" },
    )
  ).error;
  if (snapErr) throw new Error(`finance_snapshots: ${snapErr.message}`);

  // Categories — replace this household's set.
  await hearth.from("finance_categories").delete().eq("household_id", hearthHouseholdId);
  if (rollup.categories.length) {
    const rows = rollup.categories.map((c, i) => ({
      household_id: hearthHouseholdId,
      name: c.name,
      color: c.color,
      category_group: c.category_group,
      month_budget: c.month_budget,
      month_spent: c.month_spent,
      week_budget: c.week_budget,
      week_spent: c.week_spent,
      sort_order: i,
    }));
    const { error } = await hearth.from("finance_categories").insert(rows);
    if (error) throw new Error(`finance_categories: ${error.message}`);
  }

  // Trend — replace this household's set.
  await hearth.from("finance_trend").delete().eq("household_id", hearthHouseholdId);
  if (rollup.trend.length) {
    const rows = rollup.trend.map((p) => ({
      household_id: hearthHouseholdId,
      period_month: p.month,
      budget: p.budget,
      spent: p.spent,
      income: p.income,
    }));
    const { error } = await hearth.from("finance_trend").insert(rows);
    if (error) throw new Error(`finance_trend: ${error.message}`);
  }

  // Accounts — replace this household's set, so an account unlinked in the
  // budget app disappears from Hearth rather than lingering.
  await hearth.from("finance_accounts").delete().eq("household_id", hearthHouseholdId);
  if (rollup.accounts.length) {
    const rows = rollup.accounts.map((a, i) => ({
      household_id: hearthHouseholdId,
      name: a.name,
      mask: a.mask,
      account_type: a.account_type,
      account_subtype: a.account_subtype,
      current_balance: a.current_balance,
      available_balance: a.available_balance,
      currency: a.currency,
      sort_order: i,
    }));
    const { error } = await hearth.from("finance_accounts").insert(rows);
    if (error) throw new Error(`finance_accounts: ${error.message}`);
  }
}
