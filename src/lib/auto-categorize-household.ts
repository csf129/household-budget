import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAssignmentsFromOpenAI,
  validateAndDedupeAssignments,
  type TransactionContext,
} from "@/lib/auto-categorize-openai";
import {
  ledgerArchiveColumnExists,
  withActiveLedgerOnly,
} from "@/lib/ledger-archive-schema";

const MAX_TRANSACTIONS = 100;

/**
 * Assign categories via the household's configured AI model to ACTIVE ledger
 * rows that are still uncategorized (`category_id IS NULL`).
 *
 * Deterministic category rules already run first during Plaid import
 * (see plaid-supersede-imported.ts), so this only fills the gaps the rules
 * didn't catch — it never overrides an existing category.
 *
 * Best-effort by design: callers run this right after a Plaid sync and MUST
 * treat a throw as non-fatal (the most common cause is no AI key configured).
 * The imported transactions are already saved; they just stay uncategorized
 * until the next sync/cron run picks them up.
 */
export async function autoCategorizeUncategorizedForHousehold(
  admin: SupabaseClient,
  householdId: string,
  modelId: string,
  opts: { limit?: number } = {},
): Promise<{ updated: number; considered: number }> {
  const limit = Math.min(opts.limit ?? MAX_TRANSACTIONS, MAX_TRANSACTIONS);

  const { data: categories, error: catErr } = await admin
    .from("categories")
    .select("id, name, description")
    .eq("household_id", householdId)
    .order("sort_order", { ascending: true });
  if (catErr) throw new Error(catErr.message);

  const categoryList = categories ?? [];
  if (categoryList.length === 0) return { updated: 0, considered: 0 };
  const allowedCategoryIds = new Set(categoryList.map((c) => String(c.id)));

  const hasLedgerArchive = await ledgerArchiveColumnExists(admin);
  const { data: txRows, error: txErr } = await withActiveLedgerOnly(
    admin
      .from("transactions")
      .select("id, raw_description, normalized_description, amount, category_id")
      .eq("household_id", householdId)
      .is("category_id", null)
      .limit(limit),
    hasLedgerArchive,
  );
  if (txErr) throw new Error(txErr.message);

  const rows = txRows ?? [];
  if (rows.length === 0) return { updated: 0, considered: 0 };

  const txContexts: TransactionContext[] = rows.map((r) => ({
    id: String(r.id),
    raw_description: String(r.raw_description ?? ""),
    normalized_description: String(r.normalized_description ?? ""),
    amount:
      typeof r.amount === "string"
        ? Number.parseFloat(r.amount)
        : Number(r.amount),
  }));
  const allowedTxIds = new Set(txContexts.map((t) => t.id));

  const assignments = await fetchAssignmentsFromOpenAI(
    "",
    categoryList.map((c) => ({
      id: String(c.id),
      name: String(c.name ?? ""),
      description:
        c.description != null && String(c.description).trim() !== ""
          ? String(c.description)
          : null,
    })),
    txContexts,
    modelId,
  );

  const toApply = validateAndDedupeAssignments(
    assignments,
    allowedTxIds,
    allowedCategoryIds,
  );

  let updated = 0;
  for (const [transactionId, categoryId] of toApply) {
    // Re-assert `category_id IS NULL` so a category set between our read and
    // write (rule run, manual edit, concurrent sync) is never overwritten.
    const { data: updatedRows, error: upErr } = await admin
      .from("transactions")
      .update({ category_id: categoryId })
      .eq("id", transactionId)
      .eq("household_id", householdId)
      .is("category_id", null)
      .select("id");
    if (upErr) throw new Error(upErr.message);
    if (updatedRows && updatedRows.length > 0) updated += 1;
  }

  return { updated, considered: rows.length };
}
