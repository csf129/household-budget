import {
  resolveIncomeTreatmentFromRules,
  type IncomeRuleRow,
} from "@/lib/apply-income-rules";
import {
  formatCategoryLabel,
  sortCategoriesForPicker,
} from "@/lib/category-display";
import { descriptionExcludedFromOverviewAsCardPayment } from "@/lib/detect-credit-card-payment-description";
import { descriptionLooksLikeInternalBankTransfer } from "@/lib/detect-internal-bank-transfer-description";
import {
  PRIMARY_SLUG_BANK_TRANSFERS,
  PRIMARY_SLUG_CREDIT_CARD_PAYMENTS,
  PRIMARY_SLUG_INCOME,
  PRIMARY_SLUG_PURCHASES_BILLS,
} from "@/lib/primary-category-slugs";
import type {
  CategoryRow,
  PrimaryCategoryGroupRow,
  TransactionRow,
} from "@/types/finance";

export type PeriodGranularity = "month" | "quarter" | "year" | "ytd";

export type PeriodBucket = {
  key: string;
  label: string;
  start: string;
  end: string;
};

export type BucketTotals = {
  income: number;
  /** Absolute sum of expense amounts (always ≥ 0). */
  spending: number;
};

export type DashboardTotalsOptions = {
  incomeRules?: IncomeRuleRow[];
};

const pad2 = (n: number) => String(n).padStart(2, "0");

function monthRange(y: number, m: number): { start: string; end: string } {
  const start = `${y}-${pad2(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${pad2(m)}-${pad2(lastDay)}`;
  return { start, end };
}

function monthShortLabel(y: number, m: number): string {
  return new Date(y, m - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
}

/** Last 12 calendar months through the current month (inclusive). */
export function buildMonthBuckets(now: Date = new Date()): PeriodBucket[] {
  const buckets: PeriodBucket[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const { start, end } = monthRange(y, m);
    buckets.push({
      key: `${y}-${pad2(m)}`,
      label: monthShortLabel(y, m),
      start,
      end,
    });
  }
  return buckets;
}

function quarterOfDate(d: Date): { y: number; q: number } {
  const m = d.getMonth();
  const q = Math.floor(m / 3) + 1;
  return { y: d.getFullYear(), q };
}

function quarterRange(
  y: number,
  q: number,
): { start: string; end: string; label: string } {
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = q * 3;
  const { start } = monthRange(y, startMonth);
  const { end } = monthRange(y, endMonth);
  return { start, end, label: `Q${q} ${y}` };
}

function stepQuarterBack(y: number, q: number, steps: number): { y: number; q: number } {
  let cy = y;
  let cq = q;
  for (let s = 0; s < steps; s++) {
    cq -= 1;
    if (cq < 1) {
      cq = 4;
      cy -= 1;
    }
  }
  return { y: cy, q: cq };
}

function stepQuarterForward(y: number, q: number): { y: number; q: number } {
  let cq = q + 1;
  let cy = y;
  if (cq > 4) {
    cq = 1;
    cy += 1;
  }
  return { y: cy, q: cq };
}

/** Eight calendar quarters ending at the quarter that contains `now`. */
export function buildQuarterBuckets(now: Date = new Date()): PeriodBucket[] {
  const { y, q } = quarterOfDate(now);
  let { y: cy, q: cq } = stepQuarterBack(y, q, 7);
  const buckets: PeriodBucket[] = [];
  for (let i = 0; i < 8; i++) {
    const r = quarterRange(cy, cq);
    buckets.push({
      key: `${cy}-Q${cq}`,
      label: r.label,
      start: r.start,
      end: r.end,
    });
    const next = stepQuarterForward(cy, cq);
    cy = next.y;
    cq = next.q;
  }
  return buckets;
}

/** Last five calendar years through the current year. */
export function buildYearBuckets(now: Date = new Date()): PeriodBucket[] {
  const currentY = now.getFullYear();
  const buckets: PeriodBucket[] = [];
  for (let y = currentY - 4; y <= currentY; y++) {
    buckets.push({
      key: String(y),
      label: String(y),
      start: `${y}-01-01`,
      end: `${y}-12-31`,
    });
  }
  return buckets;
}

/** Each calendar month from Jan 1 of the current year through the current month. */
export function buildYtdMonthBuckets(now: Date = new Date()): PeriodBucket[] {
  const y = now.getFullYear();
  const curM = now.getMonth() + 1;
  const buckets: PeriodBucket[] = [];
  for (let m = 1; m <= curM; m++) {
    const { start, end } = monthRange(y, m);
    buckets.push({
      key: `${y}-${pad2(m)}`,
      label: new Date(y, m - 1, 1).toLocaleString("en-US", {
        month: "short",
      }),
      start,
      end,
    });
  }
  return buckets;
}

export function bucketsForGranularity(
  granularity: PeriodGranularity,
  now: Date = new Date(),
): PeriodBucket[] {
  switch (granularity) {
    case "month":
      return buildMonthBuckets(now);
    case "quarter":
      return buildQuarterBuckets(now);
    case "year":
      return buildYearBuckets(now);
    case "ytd":
      return buildYtdMonthBuckets(now);
    default:
      return buildMonthBuckets(now);
  }
}

export function periodHeading(
  granularity: PeriodGranularity,
  now: Date = new Date(),
): string {
  const y = now.getFullYear();
  switch (granularity) {
    case "month":
      return "Last 12 months";
    case "quarter":
      return "Last 8 quarters";
    case "year":
      return "Last 5 years";
    case "ytd":
      return `${y} year to date`;
    default:
      return "";
  }
}

export function totalsForBucket(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
  options?: DashboardTotalsOptions,
): BucketTotals {
  const incomeRules = options?.incomeRules ?? [];
  let income = 0;
  let spending = 0;
  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    const a = t.amount;
    if (!Number.isFinite(a)) continue;
    income += overviewIncomeContribution(t, incomeRules);
    if (transactionCountsAsOverviewPurchasesBar(t)) spending += -a;
  }
  return { income, spending };
}

/**
 * Which transactions count toward category breakdown totals and drilldowns.
 * - `all`: same as dashboard spending (donut/table historically).
 * - `purchases_bills`: same as the overview "Purchases & bills" bar (stacked categories).
 */
export type SpendingBreakdownMode = "all" | "purchases_bills";

export type CategorySpendRow = {
  name: string;
  amount: number;
  color: string;
  /** Household category id when this row maps to a catalog category */
  categoryId?: string | null;
  /**
   * When set, drilldown includes spending on this category and its direct
   * subcategories (rollup row in the overview table).
   */
  drilldownSubtreeRootId?: string;
  /** Which transaction filter the drilldown panel should use for this row. */
  drilldownSpendingMode?: SpendingBreakdownMode;
};

/** Must match the slice used before merging tail into "Other" in `spendingByCategoryInRange`. */
export const CATEGORY_BREAKDOWN_TOP_N = 7;

function transactionCountsForBreakdown(
  t: TransactionRow,
  mode: SpendingBreakdownMode,
): boolean {
  if (mode === "purchases_bills") {
    return transactionCountsAsOverviewPurchasesBar(t);
  }
  return transactionCountsAsDashboardSpending(t);
}

export function categoryDisplayName(t: TransactionRow): string {
  const cat = t.categories;
  const n = cat?.name?.trim();
  if (!n) return "Uncategorized";
  const pn = cat?.parent?.name?.trim();
  if (pn) return `${pn} › ${n}`;
  return n;
}

/** Category named "Pay" is always treated as income unless the row is excluded. */
function isPayIncomeCategory(t: TransactionRow): boolean {
  return (t.categories?.name?.trim().toLowerCase() ?? "") === "pay";
}

/**
 * Effective primary group for overview charts: uses the category's linked
 * primary, then name/description fallbacks for uncategorized rows.
 */
export function effectivePrimarySlug(t: TransactionRow): string | null {
  const rawLinked = t.categories?.primary_group?.slug;
  if (rawLinked != null && String(rawLinked).trim() !== "") {
    return String(rawLinked).trim().toLowerCase();
  }

  const name = categoryDisplayName(t);

  if (isTransferCategoryName(name)) return PRIMARY_SLUG_BANK_TRANSFERS;
  if (isCreditCardPaymentLikeCategory(name))
    return PRIMARY_SLUG_CREDIT_CARD_PAYMENTS;

  const uncategorized = name === "Uncategorized" || !t.category_id;
  if (uncategorized) {
    if (
      descriptionLooksLikeInternalBankTransfer(
        t.normalized_description,
        t.raw_description,
      )
    )
      return PRIMARY_SLUG_BANK_TRANSFERS;
    if (
      Number.isFinite(t.amount) &&
      t.amount < 0 &&
      descriptionExcludedFromOverviewAsCardPayment(
        t.normalized_description,
        t.raw_description,
      )
    )
      return PRIMARY_SLUG_CREDIT_CARD_PAYMENTS;
    if (Number.isFinite(t.amount) && t.amount < 0)
      return PRIMARY_SLUG_PURCHASES_BILLS;
    return null;
  }

  return PRIMARY_SLUG_PURCHASES_BILLS;
}

/**
 * Dedicated transfer category: keep transactions labeled for the ledger, but
 * do not fold them into overview income or spending (avoids double-counting
 * across accounts). Matches Chase CSV "Transfer" when the household category
 * is named Transfer.
 */
const TRANSFER_CATEGORY_NAMES_LOWER = new Set(["transfer", "transfers"]);

/**
 * Exact category names (lowercase) that are always omitted from spending totals.
 * Also see `isCreditCardPaymentLikeCategory` for common variants.
 */
const PAYMENT_EXCLUDED_FROM_SPENDING_ONLY_LOWER = new Set([
  "credit card payment",
  "credit card payments",
  "payment to credit card",
  "payments to credit card",
  "cc payment",
  "cc payments",
  "pay credit card",
]);

/**
 * True when the category label clearly means "paying the card" (checking →
 * issuer), so we do not stack it on top of card purchase imports.
 */
function isCreditCardPaymentLikeCategory(displayName: string): boolean {
  const n = displayName.trim().toLowerCase().replace(/\s+/g, " ");
  if (PAYMENT_EXCLUDED_FROM_SPENDING_ONLY_LOWER.has(n)) return true;

  const mentionsCreditCard =
    /\bcredit\s*cards?\b/.test(n) ||
    /^cc\b/.test(n) ||
    /\bcc\s/.test(n) ||
    /\bvisa\b.*\bpayment\b/.test(n) ||
    /\bmastercard\b.*\bpayment\b/.test(n) ||
    /\bamex\b.*\bpayment\b/.test(n) ||
    /\bamerican express\b.*\bpayment\b/.test(n) ||
    /\bdiscover\b.*\bpayment\b/.test(n);

  const mentionsPaying =
    /\bpayments?\b/.test(n) ||
    /\bautopay\b/.test(n) ||
    (/\bpay\b/.test(n) && /\bcredit\s*cards?\b/.test(n));

  return mentionsCreditCard && mentionsPaying;
}

function isTransferCategoryName(displayName: string): boolean {
  return TRANSFER_CATEGORY_NAMES_LOWER.has(displayName.trim().toLowerCase());
}

/** Categories omitted from overview income (and usually spending) like transfers and card payments. */
export function categoryExcludedFromDashboardIncome(
  displayName: string,
): boolean {
  if (isTransferCategoryName(displayName)) return true;
  return isCreditCardPaymentLikeCategory(displayName);
}

/**
 * Whether a positive amount counts toward overview income (bar chart, totals).
 * Per-row `income_treatment` overrides; else income rules; else default (count).
 */
export function transactionCountsAsDashboardIncome(
  t: TransactionRow,
  incomeRules: IncomeRuleRow[] = [],
): boolean {
  if (!Number.isFinite(t.amount)) return false;

  if (isPayIncomeCategory(t)) {
    if (t.income_treatment === "exclude") return false;
    return true;
  }

  const rawPrimarySlug = t.categories?.primary_group?.slug;
  if (
    rawPrimarySlug != null &&
    String(rawPrimarySlug).trim().toLowerCase() === PRIMARY_SLUG_INCOME
  ) {
    if (t.income_treatment === "exclude") return false;
    return true;
  }

  if (
    (categoryDisplayName(t) === "Uncategorized" || !t.category_id) &&
    descriptionLooksLikeInternalBankTransfer(
      t.normalized_description,
      t.raw_description,
    )
  )
    return false;
  if (categoryExcludedFromDashboardIncome(categoryDisplayName(t))) return false;
  if (t.income_treatment === "exclude") return false;
  if (t.income_treatment === "include") return true;
  const fromRules = resolveIncomeTreatmentFromRules(
    t.normalized_description,
    t.amount,
    incomeRules,
  );
  if (fromRules === "exclude") return false;
  if (fromRules === "include") return true;
  return true;
}

export function categoryExcludedFromDashboardSpending(
  displayName: string,
): boolean {
  const n = displayName.trim().toLowerCase();
  if (isTransferCategoryName(n)) return true;
  return isCreditCardPaymentLikeCategory(displayName);
}

/**
 * Outflows that represent paying a credit card from checking (or similar),
 * including the "Credit card payment" category and uncategorized rows that
 * match bank EPAY-style descriptions. Excludes plain transfers.
 */
export function transactionIsCreditCardPaymentOutflow(
  t: TransactionRow,
): boolean {
  if (!Number.isFinite(t.amount) || t.amount >= 0) return false;
  const name = categoryDisplayName(t);
  if (isTransferCategoryName(name)) return false;
  if (isCreditCardPaymentLikeCategory(name)) return true;
  if (
    name === "Uncategorized" &&
    descriptionExcludedFromOverviewAsCardPayment(
      t.normalized_description,
      t.raw_description,
    )
  ) {
    return true;
  }
  return false;
}

/** Sum of card payments (absolute dollars) in a calendar bucket. */
export function creditCardPaymentTotalForBucket(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
): number {
  let sum = 0;
  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    if (!transactionCountsAsCreditCardPaymentOverviewBar(t)) continue;
    sum += -t.amount;
  }
  return sum;
}

/** Negative outflows that roll into the credit card payments overview bar. */
export function transactionCountsAsCreditCardPaymentOverviewBar(
  t: TransactionRow,
): boolean {
  if (!Number.isFinite(t.amount) || t.amount >= 0) return false;
  if (effectivePrimarySlug(t) === PRIMARY_SLUG_CREDIT_CARD_PAYMENTS) return true;
  if (transactionIsCreditCardPaymentOutflow(t)) return true;
  return false;
}

/** Any amount whose effective primary is bank transfers (overview bar). */
export function transactionCountsAsBankTransferOverviewBar(
  t: TransactionRow,
): boolean {
  if (!Number.isFinite(t.amount)) return false;
  return effectivePrimarySlug(t) === PRIMARY_SLUG_BANK_TRANSFERS;
}

/** Negative outflows that count toward dashboard spending (bar, donut, drilldown). */
export function transactionCountsAsDashboardSpending(
  t: TransactionRow,
): boolean {
  if (!Number.isFinite(t.amount) || t.amount >= 0) return false;
  if (categoryExcludedFromDashboardSpending(categoryDisplayName(t))) return false;
  if (
    categoryDisplayName(t) === "Uncategorized" &&
    descriptionExcludedFromOverviewAsCardPayment(
      t.normalized_description,
      t.raw_description,
    )
  ) {
    return false;
  }
  return true;
}

/** Total dashboard spending (same rules as category breakdown) in an inclusive date range. */
export function dashboardSpendingTotalInRange(
  transactions: TransactionRow[],
  rangeStart: string,
  rangeEnd: string,
): number {
  let sum = 0;
  for (const t of transactions) {
    if (t.occurred_on < rangeStart || t.occurred_on > rangeEnd) continue;
    if (!transactionCountsAsDashboardSpending(t)) continue;
    sum += -t.amount;
  }
  return sum;
}

/** Positive inflows counted on the main overview “Income” bar. */
export function transactionCountsAsOverviewIncomeBar(
  t: TransactionRow,
  incomeRules: IncomeRuleRow[] = [],
): boolean {
  if (!Number.isFinite(t.amount)) return false;
  if (isPayIncomeCategory(t)) {
    if (t.income_treatment === "exclude") return false;
    return true;
  }
  // Without a linked primary group, `effectivePrimarySlug` assumes "purchases-bills" for
  // categorized rows — which excludes positive deposits from the income bar entirely.
  if (!t.categories?.primary_group?.slug) {
    return transactionCountsAsDashboardIncome(t, incomeRules);
  }
  const slug = effectivePrimarySlug(t);
  if (
    slug === PRIMARY_SLUG_BANK_TRANSFERS ||
    slug === PRIMARY_SLUG_CREDIT_CARD_PAYMENTS ||
    slug === PRIMARY_SLUG_PURCHASES_BILLS
  )
    return false;
  if (slug === PRIMARY_SLUG_INCOME) {
    if (t.income_treatment === "exclude") return false;
    // Rows already under the Income primary group (e.g. category "Pay") should count
    // here unless the user excludes this row. Global income rules use substring
    // matching and patterns like "pay" match "payroll"/"payment", which hid paychecks.
    return true;
  }
  if (slug === null) {
    return transactionCountsAsDashboardIncome(t, incomeRules);
  }
  return false;
}

/** Dollar contribution to overview income bar; normalizes Pay category sign. */
export function overviewIncomeContribution(
  t: TransactionRow,
  incomeRules: IncomeRuleRow[] = [],
): number {
  if (!Number.isFinite(t.amount)) return 0;
  if (!transactionCountsAsOverviewIncomeBar(t, incomeRules)) return 0;
  if (isPayIncomeCategory(t)) return Math.abs(t.amount);
  return t.amount > 0 ? t.amount : 0;
}

/** Negative outflows counted on the main “Purchases & bills” bar. */
export function transactionCountsAsOverviewPurchasesBar(t: TransactionRow): boolean {
  if (!Number.isFinite(t.amount) || t.amount >= 0) return false;
  if (isPayIncomeCategory(t)) return false;
  const slug = effectivePrimarySlug(t);
  if (
    slug === PRIMARY_SLUG_BANK_TRANSFERS ||
    slug === PRIMARY_SLUG_CREDIT_CARD_PAYMENTS ||
    slug === PRIMARY_SLUG_INCOME
  )
    return false;
  if (slug === PRIMARY_SLUG_PURCHASES_BILLS) {
    if (
      categoryDisplayName(t) === "Uncategorized" &&
      descriptionExcludedFromOverviewAsCardPayment(
        t.normalized_description,
        t.raw_description,
      )
    )
      return false;
    return true;
  }
  return false;
}

/** Gross movement (absolute dollars) for bank transfers in a bucket. */
export function bankTransferVolumeForBucket(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
): number {
  let sum = 0;
  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    if (!transactionCountsAsBankTransferOverviewBar(t)) continue;
    sum += Math.abs(t.amount);
  }
  return sum;
}

/**
 * Signed net for bank-transfer-classified rows on one account in a bucket
 * (positive = into the account, negative = out of the account), using raw `amount`.
 */
export function bankTransferSignedNetForAccountBucket(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
  accountId: string,
): number {
  let sum = 0;
  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    if (!transactionCountsAsBankTransferOverviewBar(t)) continue;
    if (t.bank_account_id !== accountId) continue;
    sum += t.amount;
  }
  return sum;
}

/** Signed net for any primary slug (used for custom groups). */
export function primarySignedNetForBucket(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
  slug: string,
): number {
  let sum = 0;
  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    if (!Number.isFinite(t.amount)) continue;
    if (effectivePrimarySlug(t) !== slug) continue;
    sum += t.amount;
  }
  return sum;
}

/**
 * Category names whose spending is rolled into the synthetic "Other" row
 * (same logic as `spendingByCategoryInRange`).
 */
export function otherCategoryMemberNames(
  transactions: TransactionRow[],
  rangeStart: string,
  rangeEnd: string,
  topN: number = CATEGORY_BREAKDOWN_TOP_N,
  mode: SpendingBreakdownMode = "all",
): Set<string> {
  const map = new Map<string, number>();
  for (const t of transactions) {
    if (t.occurred_on < rangeStart || t.occurred_on > rangeEnd) continue;
    if (!transactionCountsForBreakdown(t, mode)) continue;
    const name = categoryDisplayName(t);
    map.set(name, (map.get(name) ?? 0) + -t.amount);
  }
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return new Set(sorted.slice(topN).map(([n]) => n));
}

function spendingInBucketForNames(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
  nameMatches: (displayName: string) => boolean,
  mode: SpendingBreakdownMode = "all",
): number {
  let sum = 0;
  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    if (!transactionCountsForBreakdown(t, mode)) continue;
    if (!nameMatches(categoryDisplayName(t))) continue;
    sum += -t.amount;
  }
  return sum;
}

export type CategoryBucketSpendRow = {
  key: string;
  label: string;
  start: string;
  end: string;
  spending: number;
};

/** Per-period spending for one table category (or "Other") across the same buckets as the overview. */
export function spendingByBucketsForCategory(
  transactions: TransactionRow[],
  buckets: PeriodBucket[],
  categoryName: string,
  rangeStart: string,
  rangeEnd: string,
  topN: number = CATEGORY_BREAKDOWN_TOP_N,
  mode: SpendingBreakdownMode = "all",
): CategoryBucketSpendRow[] {
  const otherMembers =
    categoryName === "Other"
      ? otherCategoryMemberNames(transactions, rangeStart, rangeEnd, topN, mode)
      : null;

  const matches = (name: string) =>
    categoryName === "Other"
      ? (otherMembers?.has(name) ?? false)
      : name === categoryName;

  return buckets.map((b) => ({
    key: b.key,
    label: b.label,
    start: b.start,
    end: b.end,
    spending: spendingInBucketForNames(transactions, b, matches, mode),
  }));
}

/**
 * Spending transactions in `categoryLabel` for an inclusive date range.
 * `categoryLabel` "Other" uses the same tail aggregation as the overview table.
 */
export function filterSpendingTransactionsForCategoryLabel(
  transactions: TransactionRow[],
  categoryLabel: string,
  overviewRangeStart: string,
  overviewRangeEnd: string,
  periodStart: string,
  periodEnd: string,
  topN: number = CATEGORY_BREAKDOWN_TOP_N,
  mode: SpendingBreakdownMode = "all",
): TransactionRow[] {
  const otherMembers =
    categoryLabel === "Other"
      ? otherCategoryMemberNames(
          transactions,
          overviewRangeStart,
          overviewRangeEnd,
          topN,
          mode,
        )
      : null;

  const matchesName = (name: string) =>
    categoryLabel === "Other"
      ? (otherMembers?.has(name) ?? false)
      : name === categoryLabel;

  return transactions
    .filter((t) => {
      if (t.occurred_on < periodStart || t.occurred_on > periodEnd) return false;
      if (!transactionCountsForBreakdown(t, mode)) return false;
      return matchesName(categoryDisplayName(t));
    })
    .sort((a, b) => {
      const d = b.occurred_on.localeCompare(a.occurred_on);
      if (d !== 0) return d;
      return b.id.localeCompare(a.id);
    });
}

/** Direct children + root id for one-level category trees. */
function categorySubtreeIdSet(
  rootCategoryId: string,
  categories: CategoryRow[],
): Set<string> {
  const childIds = categories
    .filter((c) => c.parent_category_id === rootCategoryId)
    .map((c) => c.id);
  return new Set<string>([rootCategoryId, ...childIds]);
}

function spendingInBucketForSubtree(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
  rootCategoryId: string,
  categories: CategoryRow[],
  mode: SpendingBreakdownMode = "all",
): number {
  const matchIds = categorySubtreeIdSet(rootCategoryId, categories);
  let sum = 0;
  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    if (!transactionCountsForBreakdown(t, mode)) continue;
    if (!t.category_id || !matchIds.has(t.category_id)) continue;
    sum += -t.amount;
  }
  return sum;
}

/** Same buckets as `spendingByBucketsForCategory`, but sums a parent + direct subcategories. */
export function spendingByBucketsForCategorySubtree(
  transactions: TransactionRow[],
  buckets: PeriodBucket[],
  rootCategoryId: string,
  categories: CategoryRow[],
  mode: SpendingBreakdownMode = "all",
): CategoryBucketSpendRow[] {
  return buckets.map((b) => ({
    key: b.key,
    label: b.label,
    start: b.start,
    end: b.end,
    spending: spendingInBucketForSubtree(
      transactions,
      b,
      rootCategoryId,
      categories,
      mode,
    ),
  }));
}

export function filterSpendingTransactionsForCategorySubtree(
  transactions: TransactionRow[],
  rootCategoryId: string,
  categories: CategoryRow[],
  periodStart: string,
  periodEnd: string,
  mode: SpendingBreakdownMode = "all",
): TransactionRow[] {
  const matchIds = categorySubtreeIdSet(rootCategoryId, categories);
  return transactions
    .filter((t) => {
      if (t.occurred_on < periodStart || t.occurred_on > periodEnd) return false;
      if (!transactionCountsForBreakdown(t, mode)) return false;
      if (!t.category_id || !matchIds.has(t.category_id)) return false;
      return true;
    })
    .sort((a, b) => {
      const d = b.occurred_on.localeCompare(a.occurred_on);
      if (d !== 0) return d;
      return b.id.localeCompare(a.id);
    });
}

export function sumOptionalBudgets(
  ...vals: (number | null | undefined)[]
): number | null {
  let s = 0;
  let any = false;
  for (const v of vals) {
    if (v != null && Number.isFinite(v)) {
      s += v;
      any = true;
    }
  }
  return any ? s : null;
}

const FALLBACK_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#14b8a6",
  "#f97316",
  "#ec4899",
  "#8b5cf6",
  "#22c55e",
  "#eab308",
];

function makeCategoryColorFallbacks() {
  let fallbackIdx = 0;
  return () => {
    const c = FALLBACK_COLORS[fallbackIdx % FALLBACK_COLORS.length]!;
    fallbackIdx += 1;
    return c;
  };
}

/**
 * Raw spending totals per category display name for the inclusive date range
 * (same inclusion rules as `spendingByCategoryInRange`).
 */
export function aggregateCategorySpendingInRange(
  transactions: TransactionRow[],
  rangeStart: string,
  rangeEnd: string,
  mode: SpendingBreakdownMode = "all",
): Map<string, { amount: number; color: string }> {
  const map = new Map<string, { amount: number; color: string }>();
  const nextFallback = makeCategoryColorFallbacks();

  for (const t of transactions) {
    if (t.occurred_on < rangeStart || t.occurred_on > rangeEnd) continue;
    if (!transactionCountsForBreakdown(t, mode)) continue;
    const spend = -t.amount;
    const name = categoryDisplayName(t);
    const color =
      t.categories?.color?.trim() ||
      (name === "Uncategorized" ? "#9ca3af" : nextFallback());
    const prev = map.get(name);
    if (prev) {
      prev.amount += spend;
    } else {
      map.set(name, { amount: spend, color });
    }
  }

  return map;
}

/**
 * Same shape as rows built for the overview income vs purchases chart (one row per period).
 */
export type OverviewBarChartRow = {
  key: string;
  label: string;
  start: string;
  end: string;
  income: number;
  spending: number;
};

/** Overview bar row with optional `pbCat*` / `pbCat_other` stack fields. */
export type PurchasesBarStackChartRow = OverviewBarChartRow & {
  [dataKey: string]: string | number;
};

/**
 * Purchases &amp; bills bar only: category breakdown using
 * `transactionCountsAsOverviewPurchasesBar` (matches the blue bar total).
 */
function aggregatePurchasesBarCategorySpendingInBucket(
  transactions: TransactionRow[],
  bucket: PeriodBucket,
): Map<string, { amount: number; color: string }> {
  const map = new Map<string, { amount: number; color: string }>();
  const nextFallback = makeCategoryColorFallbacks();

  for (const t of transactions) {
    if (t.occurred_on < bucket.start || t.occurred_on > bucket.end) continue;
    if (!transactionCountsAsOverviewPurchasesBar(t)) continue;
    const spend = -t.amount;
    const name = categoryDisplayName(t);
    const color =
      t.categories?.color?.trim() ||
      (name === "Uncategorized" ? "#9ca3af" : nextFallback());
    const prev = map.get(name);
    if (prev) {
      prev.amount += spend;
    } else {
      map.set(name, { amount: spend, color });
    }
  }

  return map;
}

export type PurchasesBarStackSegment = {
  dataKey: string;
  displayName: string;
  color: string;
};

/**
 * Stacked-bar data for the overview "Purchases &amp; bills" series: global top-N
 * categories by total spend across visible periods, plus "Other" when needed.
 * Stack sums match `row.spending` per period when non-empty.
 */
export function buildPurchasesBarStackChartData(
  transactions: TransactionRow[],
  chartRows: readonly OverviewBarChartRow[],
  topN: number = CATEGORY_BREAKDOWN_TOP_N,
): {
  rows: PurchasesBarStackChartRow[];
  segments: PurchasesBarStackSegment[];
} {
  if (chartRows.length === 0) {
    return { rows: [], segments: [] };
  }

  const perBucketMaps = chartRows.map((row) =>
    aggregatePurchasesBarCategorySpendingInBucket(transactions, {
      key: row.key,
      label: row.label,
      start: row.start,
      end: row.end,
    }),
  );

  const globalTotals = new Map<string, number>();
  const colorByName = new Map<string, string>();
  for (const m of perBucketMaps) {
    for (const [name, { amount, color }] of m) {
      globalTotals.set(name, (globalTotals.get(name) ?? 0) + amount);
      if (!colorByName.has(name)) colorByName.set(name, color);
    }
  }

  if (globalTotals.size === 0) {
    return {
      rows: chartRows.map((r) => ({ ...r })) as PurchasesBarStackChartRow[],
      segments: [],
    };
  }

  const sorted = [...globalTotals.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, topN);
  const topNames = head.map(([n]) => n);
  const topNameSet = new Set(topNames);
  const needOther = sorted.length > topN;

  const segments: PurchasesBarStackSegment[] = topNames.map((name, idx) => ({
    dataKey: `pbCat${idx}`,
    displayName: name,
    color: colorByName.get(name) ?? "#71717a",
  }));
  if (needOther) {
    segments.push({
      dataKey: "pbCat_other",
      displayName: "Other",
      color: "#71717a",
    });
  }

  const rows: PurchasesBarStackChartRow[] = chartRows.map((row, i) => {
    const m = perBucketMaps[i]!;
    const out: PurchasesBarStackChartRow = { ...row };
    topNames.forEach((name, idx) => {
      out[`pbCat${idx}`] = m.get(name)?.amount ?? 0;
    });
    if (needOther) {
      let otherAmt = 0;
      for (const [name, { amount }] of m) {
        if (!topNameSet.has(name)) otherAmt += amount;
      }
      out.pbCat_other = otherAmt;
    }
    return out;
  });

  return { rows, segments };
}

/**
 * One row per household category (plus Uncategorized when not a category), sorted
 * for the table. Amounts default to 0; no top-N merge into "Other".
 * Row `name` matches transaction aggregation keys (`formatCategoryLabel`).
 */
export function categoryBreakdownTableRows(
  categories: CategoryRow[],
  transactions: TransactionRow[],
  rangeStart: string,
  rangeEnd: string,
  mode: SpendingBreakdownMode = "all",
): CategorySpendRow[] {
  const aggregate = aggregateCategorySpendingInRange(
    transactions,
    rangeStart,
    rangeEnd,
    mode,
  );
  const nextFallback = makeCategoryColorFallbacks();

  if (categories.length === 0) {
    const u = aggregate.get("Uncategorized");
    return [
      {
        name: "Uncategorized",
        amount: u?.amount ?? 0,
        color: u?.color ?? "#9ca3af",
        categoryId: null,
        drilldownSpendingMode: mode,
      },
    ];
  }

  const sortedCats = sortCategoriesForPicker(categories);

  const rows: CategorySpendRow[] = sortedCats.map((cat) => {
    const displayName = formatCategoryLabel(cat, categories);
    const agg = aggregate.get(displayName);
    const amount = agg?.amount ?? 0;
    const color =
      cat.color?.trim() ||
      agg?.color ||
      (displayName === "Uncategorized" ? "#9ca3af" : nextFallback());
    return {
      name: displayName,
      amount,
      color,
      categoryId: cat.id,
      drilldownSpendingMode: mode,
    };
  });

  const hasUncategorized = sortedCats.some(
    (c) => c.name.trim() === "Uncategorized",
  );
  if (!hasUncategorized) {
    const u = aggregate.get("Uncategorized");
    rows.push({
      name: "Uncategorized",
      amount: u?.amount ?? 0,
      color: u?.color ?? "#9ca3af",
      categoryId: null,
      drilldownSpendingMode: mode,
    });
  }

  return rows;
}

export function categoryPrimarySlug(
  cat: CategoryRow,
  primaryGroups: PrimaryCategoryGroupRow[],
): string | null {
  if (!cat.primary_group_id) return null;
  const g = primaryGroups.find((x) => x.id === cat.primary_group_id);
  const s = g?.slug?.trim().toLowerCase();
  return s && s.length > 0 ? s : null;
}

/** True when the category is assigned to the built-in Purchases &amp; bills primary group. */
export function categoryIsPurchasesBillsPrimary(
  cat: CategoryRow,
  primaryGroups: PrimaryCategoryGroupRow[],
): boolean {
  return categoryPrimarySlug(cat, primaryGroups) === PRIMARY_SLUG_PURCHASES_BILLS;
}

/**
 * Sentinel id for the synthetic "Uncategorized" row when the catalog has no
 * category named Uncategorized.
 */
export const BREAKDOWN_UNCATEGORIZED_ID = "__breakdown_uncategorized__";

/** Default checked set: all Purchases &amp; bills primaries plus synthetic Uncategorized when applicable. */
export function defaultSpendingBreakdownSelection(
  categories: CategoryRow[],
  primaryGroups: PrimaryCategoryGroupRow[],
): Set<string> {
  if (primaryGroups.length === 0) {
    return new Set(categories.map((c) => c.id));
  }
  const s = new Set<string>();
  for (const c of categories) {
    if (categoryIsPurchasesBillsPrimary(c, primaryGroups)) s.add(c.id);
  }
  const hasUncat = categories.some(
    (c) => c.name.trim().toLowerCase() === "uncategorized",
  );
  if (!hasUncat) s.add(BREAKDOWN_UNCATEGORIZED_ID);
  return s;
}

/**
 * Overview "Spending by category" rows for checked catalog ids. Purchases &amp; bills
 * primaries use purchases-bar totals; other primaries use dashboard spending totals.
 */
export function spendingByCategoryBreakdownRows(
  categories: CategoryRow[],
  primaryGroups: PrimaryCategoryGroupRow[],
  transactions: TransactionRow[],
  rangeStart: string,
  rangeEnd: string,
  selectedCategoryIds: ReadonlySet<string>,
): CategorySpendRow[] {
  if (primaryGroups.length === 0) {
    return categoryBreakdownTableRows(
      categories,
      transactions,
      rangeStart,
      rangeEnd,
      "purchases_bills",
    );
  }

  const aggPurchases = aggregateCategorySpendingInRange(
    transactions,
    rangeStart,
    rangeEnd,
    "purchases_bills",
  );
  const aggAll = aggregateCategorySpendingInRange(
    transactions,
    rangeStart,
    rangeEnd,
    "all",
  );
  const nextFallback = makeCategoryColorFallbacks();

  if (categories.length === 0) {
    if (!selectedCategoryIds.has(BREAKDOWN_UNCATEGORIZED_ID)) return [];
    const u = aggPurchases.get("Uncategorized");
    return [
      {
        name: "Uncategorized",
        amount: u?.amount ?? 0,
        color: u?.color ?? "#9ca3af",
        categoryId: null,
        drilldownSpendingMode: "purchases_bills",
      },
    ];
  }

  const sortedCats = sortCategoriesForPicker(categories);
  const byId = new Map(categories.map((c) => [c.id, c]));

  const expanded = new Set<string>();
  for (const id of selectedCategoryIds) {
    if (id === BREAKDOWN_UNCATEGORIZED_ID) continue;
    expanded.add(id);
    let c = byId.get(id);
    while (c?.parent_category_id) {
      expanded.add(c.parent_category_id);
      c = byId.get(c.parent_category_id);
    }
  }

  const rows: CategorySpendRow[] = [];
  for (const cat of sortedCats) {
    if (!expanded.has(cat.id)) continue;

    const displayName = formatCategoryLabel(cat, categories);
    const purchasesPrimary = categoryIsPurchasesBillsPrimary(
      cat,
      primaryGroups,
    );
    const rowMode: SpendingBreakdownMode = purchasesPrimary
      ? "purchases_bills"
      : "all";
    const agg = rowMode === "purchases_bills" ? aggPurchases : aggAll;
    const amount = agg.get(displayName)?.amount ?? 0;
    const color =
      cat.color?.trim() ||
      agg.get(displayName)?.color ||
      (displayName === "Uncategorized" ? "#9ca3af" : nextFallback());
    rows.push({
      name: displayName,
      amount,
      color,
      categoryId: cat.id,
      drilldownSpendingMode: rowMode,
    });
  }

  const hasUncategorized = sortedCats.some(
    (c) => c.name.trim().toLowerCase() === "uncategorized",
  );
  if (!hasUncategorized && selectedCategoryIds.has(BREAKDOWN_UNCATEGORIZED_ID)) {
    const u = aggPurchases.get("Uncategorized");
    rows.push({
      name: "Uncategorized",
      amount: u?.amount ?? 0,
      color: u?.color ?? "#9ca3af",
      categoryId: null,
      drilldownSpendingMode: "purchases_bills",
    });
  }

  return rows;
}

export type SpendingCategoryTableGroup =
  | { kind: "single"; row: CategorySpendRow }
  | {
      kind: "parent";
      parentId: string;
      rollup: CategorySpendRow;
      subs: CategorySpendRow[];
    };

/**
 * Groups flat breakdown rows for the overview table: parents with subcategories
 * get a rollup row plus child rows; others stay single.
 */
export function buildSpendingCategoryTableGroups(
  categories: CategoryRow[],
  flatRows: CategorySpendRow[],
): SpendingCategoryTableGroup[] {
  const byId = new Map<string, CategorySpendRow>();
  let uncategorizedRow: CategorySpendRow | null = null;
  for (const r of flatRows) {
    if (r.categoryId != null) {
      byId.set(r.categoryId, r);
    } else if (r.name === "Uncategorized") {
      uncategorizedRow = r;
    }
  }

  const ordered = sortCategoriesForPicker(categories);
  const tops = ordered.filter((c) => !c.parent_category_id);
  const groups: SpendingCategoryTableGroup[] = [];

  for (const p of tops) {
    const subs = ordered.filter((c) => c.parent_category_id === p.id);
    const pr = byId.get(p.id);
    if (!pr) continue;

    if (subs.length === 0) {
      groups.push({ kind: "single", row: pr });
      continue;
    }

    const subRows = subs
      .map((s) => byId.get(s.id))
      .filter((x): x is CategorySpendRow => x != null);
    const rollupAmount =
      pr.amount + subRows.reduce((s, x) => s + x.amount, 0);
    const rollup: CategorySpendRow = {
      name: p.name.trim(),
      amount: rollupAmount,
      color: pr.color,
      categoryId: p.id,
      drilldownSubtreeRootId: p.id,
      drilldownSpendingMode: pr.drilldownSpendingMode,
    };
    groups.push({
      kind: "parent",
      parentId: p.id,
      rollup,
      subs: subRows,
    });
  }

  if (uncategorizedRow) {
    groups.push({ kind: "single", row: uncategorizedRow });
  }

  return groups;
}

/**
 * Spending only (negative amounts), grouped by category, for the inclusive date range.
 */
export function spendingByCategoryInRange(
  transactions: TransactionRow[],
  rangeStart: string,
  rangeEnd: string,
  topN: number = CATEGORY_BREAKDOWN_TOP_N,
): CategorySpendRow[] {
  const map = aggregateCategorySpendingInRange(
    transactions,
    rangeStart,
    rangeEnd,
  );

  const rows: CategorySpendRow[] = [...map.entries()].map(([name, v]) => ({
    name,
    amount: v.amount,
    color: v.color,
  }));

  rows.sort((a, b) => b.amount - a.amount);

  if (rows.length <= topN) return rows;

  const head = rows.slice(0, topN);
  const rest = rows.slice(topN);
  const otherAmount = rest.reduce((s, r) => s + r.amount, 0);
  if (otherAmount <= 0) return head;

  return [
    ...head,
    { name: "Other", amount: otherAmount, color: "#71717a" },
  ];
}
