import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transaction } from "plaid";
import {
  resolveCategoryFromRules,
  type CategoryRuleRow,
} from "@/lib/apply-category-rules";
import { normalizeDescription } from "@/lib/normalize-description";
import { parsePlaidDate } from "@/lib/plaid-parse-date";
import { plaidTransactionDisplayDescription } from "@/lib/plaid-transaction-description";
import {
  ledgerArchiveColumnExists,
  withActiveLedgerOnly,
} from "@/lib/ledger-archive-schema";
import { LEDGER_ARCHIVED_AT } from "@/lib/ledger-archived";
import {
  transactionImportDedupeKey,
  transactionNormalizedDedupeKey,
} from "@/lib/transaction-import-dedupe-key";
import { mergeNearDuplicatePlaidLedgerRowsForTransaction } from "@/lib/plaid-ledger-near-duplicate-merge";

/**
 * Ledger convention (README): negative = outflow, positive = inflow.
 * Plaid: positive amounts are typically outflows (money leaving the account).
 */
export function plaidAmountToLedgerAmount(plaidAmount: number): number {
  const n = Number(plaidAmount);
  return Number.isFinite(n) ? -n : 0;
}

/**
 * After a Plaid row is synced into `plaid_transactions`, remove any CSV/manual
 * `transactions` rows that match the same purchase (same dedupe keys as import),
 * then ensure a single ledger row exists with `plaid_transaction_id` set.
 *
 * Pending transactions are included: Plaid often returns new activity as pending
 * first; the main Transactions tab reads `transactions`, so skipping pending
 * meant nothing appeared until post. Modified sync updates amount/date/description
 * when the transaction posts (or changes).
 */
export async function supersedeImportedTransactionsForPlaidTransaction(
  admin: SupabaseClient,
  householdId: string,
  t: Transaction,
  categoryRules: CategoryRuleRow[] = [],
  bankAccountId: string,
): Promise<{ deleted: number }> {
  const safeMergeNearDuplicates = async () => {
    try {
      await mergeNearDuplicatePlaidLedgerRowsForTransaction(
        admin,
        householdId,
        bankAccountId,
        t,
      );
    } catch (e) {
      console.warn("[plaid] mergeNearDuplicatePlaidLedgerRowsForTransaction", e);
    }
  };

  const posted = parsePlaidDate(t.date);
  const authorized = parsePlaidDate(t.authorized_date);
  const fromPostedDt = parsePlaidDate(t.datetime);
  const fromAuthDt = parsePlaidDate(t.authorized_datetime);
  const dates = Array.from(
    new Set(
      [posted, authorized, fromPostedDt, fromAuthDt].filter(
        (x): x is string => Boolean(x),
      ),
    ),
  );
  if (dates.length === 0) {
    return { deleted: 0 };
  }

  const hasLedgerArchive = await ledgerArchiveColumnExists(admin);

  const displayRaw = plaidTransactionDisplayDescription(t);
  const ledgerAmount = plaidAmountToLedgerAmount(t.amount);

  const plaidRawKeys = new Set<string>();
  const plaidNormKeys = new Set<string>();
  for (const d of dates) {
    plaidRawKeys.add(transactionImportDedupeKey(d, ledgerAmount, displayRaw));
    plaidNormKeys.add(
      transactionNormalizedDedupeKey(
        d,
        ledgerAmount,
        normalizeDescription(displayRaw),
      ),
    );
  }

  let candQ = admin
    .from("transactions")
    .select("id, occurred_on, amount, raw_description, normalized_description")
    .eq("household_id", householdId)
    .is("plaid_transaction_id", null);
  candQ = withActiveLedgerOnly(candQ, hasLedgerArchive);
  const { data: candidates, error: qErr } = await candQ.in(
    "occurred_on",
    dates,
  );

  if (qErr) throw new Error(qErr.message);

  const toDelete: string[] = [];
  for (const row of candidates ?? []) {
    const amt =
      typeof row.amount === "string"
        ? Number.parseFloat(row.amount)
        : Number(row.amount);
    if (!Number.isFinite(amt) || Math.abs(amt - ledgerAmount) > 0.009) {
      continue;
    }

    const kRaw = transactionImportDedupeKey(
      String(row.occurred_on),
      amt,
      String(row.raw_description ?? ""),
    );
    const kNorm = transactionNormalizedDedupeKey(
      String(row.occurred_on),
      amt,
      String(row.normalized_description ?? ""),
    );
    if (plaidRawKeys.has(kRaw) || plaidNormKeys.has(kNorm)) {
      toDelete.push(String(row.id));
    }
  }

  let deleted = 0;
  if (toDelete.length > 0) {
    const { error: delErr } = await admin
      .from("transactions")
      .delete()
      .in("id", toDelete);
    if (delErr) throw new Error(delErr.message);
    deleted = toDelete.length;
  }

  // Prefer authorized date so the ledger matches bank UIs (e.g. Chase) more often than raw posted/settled date.
  const occurredOn = authorized ?? posted ?? dates[0] ?? null;
  if (!occurredOn) {
    await safeMergeNearDuplicates();
    return { deleted };
  }
  const norm = normalizeDescription(displayRaw);

  const ruleCategoryId =
    categoryRules.length > 0
      ? resolveCategoryFromRules(norm, ledgerAmount, categoryRules)
      : null;

  /**
   * When a pending charge posts, Plaid may assign a new `transaction_id` and set
   * `pending_transaction_id` to the old id. Merge into the existing ledger row
   * so we do not create a second row (often with a different date).
   */
  const pendingLink = t.pending_transaction_id?.trim();
  if (pendingLink && pendingLink !== t.transaction_id) {
    const { data: fromPending, error: pendErr } = await admin
      .from("transactions")
      .select("id, category_id")
      .eq("household_id", householdId)
      .eq("plaid_transaction_id", pendingLink)
      .maybeSingle();
    if (pendErr) throw new Error(pendErr.message);
    if (fromPending) {
      // If we already inserted a second row for the posted id, drop it before upgrading the pending row.
      const { error: dupErr } = await admin
        .from("transactions")
        .delete()
        .eq("household_id", householdId)
        .eq("plaid_transaction_id", t.transaction_id)
        .neq("id", fromPending.id);
      if (dupErr) throw new Error(dupErr.message);

      const patch: Record<string, unknown> = {
        plaid_transaction_id: t.transaction_id,
        amount: ledgerAmount,
        occurred_on: occurredOn,
        raw_description: displayRaw,
        normalized_description: norm,
        bank_account_id: bankAccountId,
      };
      if (hasLedgerArchive) {
        patch[LEDGER_ARCHIVED_AT] = null;
      }
      if (
        ruleCategoryId &&
        (fromPending.category_id == null || fromPending.category_id === "")
      ) {
        patch.category_id = ruleCategoryId;
      }
      const { error: upPendErr } = await admin
        .from("transactions")
        .update(patch)
        .eq("id", fromPending.id);
      if (upPendErr) throw new Error(upPendErr.message);
      await safeMergeNearDuplicates();
      return { deleted };
    }
  }

  const { data: existing, error: exErr } = await admin
    .from("transactions")
    .select("id, category_id")
    .eq("household_id", householdId)
    .eq("plaid_transaction_id", t.transaction_id)
    .maybeSingle();

  if (exErr) throw new Error(exErr.message);

  if (existing) {
    const patch: Record<string, unknown> = {
      amount: ledgerAmount,
      occurred_on: occurredOn,
      raw_description: displayRaw,
      normalized_description: norm,
    };
    if (hasLedgerArchive) {
      patch[LEDGER_ARCHIVED_AT] = null;
    }
    if (
      ruleCategoryId &&
      (existing.category_id == null || existing.category_id === "")
    ) {
      patch.category_id = ruleCategoryId;
    }
    patch.bank_account_id = bankAccountId;
    const { error: upErr } = await admin
      .from("transactions")
      .update(patch)
      .eq("id", existing.id);
    if (upErr) throw new Error(upErr.message);
    await safeMergeNearDuplicates();
    return { deleted };
  }

  const { error: insErr } = await admin.from("transactions").insert({
    household_id: householdId,
    plaid_transaction_id: t.transaction_id,
    bank_account_id: bankAccountId,
    amount: ledgerAmount,
    occurred_on: occurredOn,
    raw_description: displayRaw,
    normalized_description: norm,
    category_id: ruleCategoryId,
  });

  if (insErr) throw new Error(insErr.message);

  await safeMergeNearDuplicates();
  return { deleted };
}
