import type { IncomeRuleRow } from "@/lib/apply-income-rules";
import {
  effectivePrimarySlug,
  overviewIncomeContribution,
  transactionCountsAsBankTransferOverviewBar,
  transactionCountsAsCreditCardPaymentOverviewBar,
  transactionCountsAsOverviewPurchasesBar,
  type PeriodBucket,
} from "@/lib/dashboard-analytics";
import type { TransactionRow } from "@/types/finance";

function sortTransactionsForDashboardDesc(
  transactions: TransactionRow[],
): TransactionRow[] {
  return [...transactions].sort((a, b) => {
    const d = b.occurred_on.localeCompare(a.occurred_on);
    if (d !== 0) return d;
    return b.id.localeCompare(a.id);
  });
}

/** All credits that count toward Overview income (same logic as the income bar, any date). */
export function listOverviewIncomeTransactions(
  transactions: TransactionRow[],
  incomeRules?: IncomeRuleRow[],
): TransactionRow[] {
  const rules = incomeRules ?? [];
  const out: TransactionRow[] = [];
  for (const t of transactions) {
    if (overviewIncomeContribution(t, rules) > 0) out.push(t);
  }
  return sortTransactionsForDashboardDesc(out);
}

/** Same rows that contribute to `totalsForBucket(...).income`. */
export function listTransactionsForBucketIncome(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
  incomeRules?: IncomeRuleRow[],
): TransactionRow[] {
  const rules = incomeRules ?? [];
  const out: TransactionRow[] = [];
  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    if (overviewIncomeContribution(t, rules) > 0) out.push(t);
  }
  return sortTransactionsForDashboardDesc(out);
}

/** Same rows that contribute to `totalsForBucket(...).spending`. */
export function listTransactionsForBucketSpending(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
): TransactionRow[] {
  const out: TransactionRow[] = [];
  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    const a = t.amount;
    if (!Number.isFinite(a)) continue;
    if (a < 0 && transactionCountsAsOverviewPurchasesBar(t)) out.push(t);
  }
  return sortTransactionsForDashboardDesc(out);
}

/**
 * Same rows that contribute to the bank transfers overview bar.
 * When `accountId` is set, only rows on that account are included.
 */
export function listTransactionsForBucketBankTransfers(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
  accountId?: string | null,
): TransactionRow[] {
  const out: TransactionRow[] = [];
  const filterAccount = accountId ?? null;
  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    if (!transactionCountsAsBankTransferOverviewBar(t)) continue;
    if (filterAccount != null && t.bank_account_id !== filterAccount) continue;
    out.push(t);
  }
  return sortTransactionsForDashboardDesc(out);
}

/** Same rows that contribute to `creditCardPaymentTotalForBucket`. */
export function listTransactionsForBucketCreditCardPayments(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
): TransactionRow[] {
  const out: TransactionRow[] = [];
  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    if (transactionCountsAsCreditCardPaymentOverviewBar(t)) out.push(t);
  }
  return sortTransactionsForDashboardDesc(out);
}

/** Same rows that contribute to `primarySignedNetForBucket` for `slug`. */
export function listTransactionsForBucketPrimarySlug(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
  slug: string,
): TransactionRow[] {
  const out: TransactionRow[] = [];
  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    if (!Number.isFinite(t.amount)) continue;
    if (effectivePrimarySlug(t) === slug) out.push(t);
  }
  return sortTransactionsForDashboardDesc(out);
}
