import type { SupabaseClient } from "@supabase/supabase-js";
import {
  categoryRulesFromDb,
  resolveCategoryFromRules,
  type CategoryRuleRow,
} from "@/lib/apply-category-rules";
import { normalizeDescription } from "@/lib/normalize-description";
import { plaidAmountToLedgerAmount } from "@/lib/plaid-supersede-imported";
import { plaidTransactionDisplayDescription } from "@/lib/plaid-transaction-description";

/**
 * Self-healing reconciliation for the Plaid feed → ledger pipeline.
 *
 * Normally `supersedeImportedTransactionsForPlaidTransaction` writes a ledger
 * row for each synced Plaid transaction. But that runs per-transaction inside
 * the sync batch, so a transient failure (or an aborted/partial sync) can leave
 * a `plaid_transactions` feed row with no `transactions` ledger row. Once the
 * sync cursor advances, Plaid never re-sends that transaction, so the gap is
 * permanent — this is what hid a week of July activity (incl. two paychecks).
 *
 * This runs at the end of every sync and inserts a ledger row for any *posted*
 * feed row that has no ledger mirror, so a gap can heal on the next sync instead
 * of persisting forever. It is deliberately conservative:
 *   - only posted rows (pending activity is transient; let normal sync handle it),
 *   - skips $0 rows (the ledger forbids them via a CHECK constraint),
 *   - skips a feed row already mirrored by plaid_transaction_id,
 *   - skips one already present by (occurred_on, |amount|) — covers Plaid
 *     re-issuing a transaction_id, so we never double-insert,
 *   - collapses same-account / same-|amount| twins within 2 days in one pass.
 * The near-duplicate repair that runs afterwards collapses anything left over.
 */

export interface UnmirroredFeedRow {
  plaid_transaction_id: string;
  bank_account_id: string | null;
  amount: number; // Plaid sign (positive = outflow)
  name: string | null;
  merchant_name: string | null;
  posted_date: string | null;
  authorized_date: string | null;
  pending: boolean | null;
}

export interface LedgerMirrorRow {
  plaid_transaction_id: string | null;
  occurred_on: string;
  amount: number | string;
}

export interface PlannedLedgerInsert {
  household_id: string;
  plaid_transaction_id: string;
  bank_account_id: string | null;
  amount: number;
  occurred_on: string;
  raw_description: string;
  normalized_description: string;
  category_id: string | null;
}

function daysApart(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.abs(Math.round((ta - tb) / 86400000));
}

/**
 * Pure planner: given the household's feed rows and ledger rows, return the
 * ledger inserts needed to mirror any posted feed row that is currently absent.
 * No I/O — unit-testable and used by the DB wrapper below.
 */
export function planUnmirroredFeedPromotions(
  feed: UnmirroredFeedRow[],
  ledger: LedgerMirrorRow[],
  householdId: string,
  categoryRules: CategoryRuleRow[] = [],
): PlannedLedgerInsert[] {
  const mirroredPids = new Set(
    ledger
      .map((r) => r.plaid_transaction_id)
      .filter((x): x is string => Boolean(x)),
  );
  const ledgerDateAmount = new Set(
    ledger.map((r) => `${r.occurred_on}|${Math.abs(Number(r.amount)).toFixed(2)}`),
  );

  const candidates = feed
    .filter((f) => {
      if (Number(f.amount) === 0) return false;
      if (f.pending === true) return false;
      if (mirroredPids.has(f.plaid_transaction_id)) return false;
      const occ = f.authorized_date ?? f.posted_date;
      if (!occ) return false;
      const key = `${occ}|${Math.abs(Number(f.amount)).toFixed(2)}`;
      return !ledgerDateAmount.has(key);
    })
    // newest first so the twin-collapse keeps the later-dated row
    .sort((a, b) =>
      String(b.posted_date ?? "").localeCompare(String(a.posted_date ?? "")),
    );

  const kept: UnmirroredFeedRow[] = [];
  for (const c of candidates) {
    const occ = (c.authorized_date ?? c.posted_date)!;
    const twin = kept.find(
      (k) =>
        k.bank_account_id === c.bank_account_id &&
        Math.abs(Number(k.amount) - Number(c.amount)) < 0.009 &&
        daysApart((k.authorized_date ?? k.posted_date)!, occ) <= 2,
    );
    if (!twin) kept.push(c);
  }

  return kept.map((c) => {
    const occurredOn = (c.authorized_date ?? c.posted_date)!;
    const raw = plaidTransactionDisplayDescription(c);
    const norm = normalizeDescription(raw);
    const ledgerAmount = plaidAmountToLedgerAmount(c.amount);
    const categoryId =
      categoryRules.length > 0
        ? resolveCategoryFromRules(norm, ledgerAmount, categoryRules)
        : null;
    return {
      household_id: householdId,
      plaid_transaction_id: c.plaid_transaction_id,
      bank_account_id: c.bank_account_id ?? null,
      amount: ledgerAmount,
      occurred_on: occurredOn,
      raw_description: raw,
      normalized_description: norm,
      category_id: categoryId ?? null,
    };
  });
}

const PAGE_SIZE = 1000;

async function fetchAllPaged<T>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  householdId: string,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .eq("household_id", householdId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

/**
 * DB wrapper: reconcile the feed against the ledger for a household and insert
 * any missing ledger rows. Safe to run repeatedly (idempotent by design).
 */
export async function promoteUnmirroredPlaidFeedRowsToLedger(
  admin: SupabaseClient,
  householdId: string,
): Promise<{ inserted: number }> {
  const feed = await fetchAllPaged<UnmirroredFeedRow>(
    admin,
    "plaid_transactions",
    "plaid_transaction_id, bank_account_id, amount, name, merchant_name, posted_date, authorized_date, pending",
    householdId,
  );
  const ledger = await fetchAllPaged<LedgerMirrorRow>(
    admin,
    "transactions",
    "plaid_transaction_id, occurred_on, amount",
    householdId,
  );

  const { data: rulesRaw } = await admin
    .from("category_rules")
    .select("category_id, match_type, pattern, priority, amount_sign")
    .eq("household_id", householdId);
  const categoryRules = categoryRulesFromDb(rulesRaw ?? []);

  const inserts = planUnmirroredFeedPromotions(
    feed,
    ledger,
    householdId,
    categoryRules,
  );
  if (inserts.length === 0) return { inserted: 0 };

  const { error } = await admin.from("transactions").insert(inserts);
  if (error) throw new Error(error.message);
  return { inserted: inserts.length };
}
