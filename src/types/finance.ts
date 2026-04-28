import type { AmountSignFilter } from "@/lib/amount-sign-filter";

export type { AmountSignFilter };

export type PrimaryCategoryGroupRow = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  sort_order: number;
};

export type AccountRow = {
  id: string;
  name: string;
};

/** Recurrence cadence for `budget_recurring_interval`. */
export type BudgetRecurringInterval =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual";

export type CategoryRow = {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  description: string | null;
  primary_group_id: string | null;
  /** Budget amount in USD; meaning depends on `budget_amount_period`. */
  monthly_budget: number | null;
  /** `month` / `week` / `year` (annual lump in `monthly_budget`). */
  budget_amount_period: "month" | "week" | "year";
  /** When `budget_amount_period` is `year`, month (1–12) when the annual amount is paid. */
  budget_annual_payment_month: number | null;
  /** When set, this row is a subcategory of a top-level category (one level only). */
  parent_category_id: string | null;
  /**
   * When false, `budget_period_*` limits the budget to a one-time date range.
   * When true (default), `budget_active_*` month/day repeat every calendar year.
   */
  budget_repeats_annually: boolean;
  /** 1–12; used with `budget_active_from_day` and `*_to_*` for annual seasons. */
  budget_active_from_month: number | null;
  budget_active_from_day: number | null;
  budget_active_to_month: number | null;
  budget_active_to_day: number | null;
  /** Inclusive YYYY-MM-DD when `budget_repeats_annually` is false. */
  budget_period_start: string | null;
  budget_period_end: string | null;
  /** Optional: this line is a repeating charge (informational / planning). */
  budget_recurring_payment: boolean;
  /** How often the charge repeats when `budget_recurring_payment` is true. */
  budget_recurring_interval: BudgetRecurringInterval | null;
};

export type CategoryRuleView = {
  id: string;
  category_id: string;
  category_name: string;
  category_color: string | null;
  match_type: "exact_normalized" | "contains" | "prefix";
  pattern: string;
  priority: number;
  amount_sign: AmountSignFilter;
};

/** Overview income: null = rules + defaults; include/exclude = per-row override. */
export type IncomeOverviewTreatment = "include" | "exclude";

export type TransactionRow = {
  id: string;
  amount: number;
  occurred_on: string;
  raw_description: string;
  normalized_description: string;
  notes: string | null;
  account_id: string | null;
  /** Plaid `bank_accounts.id` when the row is tied to a linked bank account. */
  bank_account_id: string | null;
  category_id: string | null;
  categories: {
    name: string;
    color: string | null;
    /** Present when the category is linked to a primary overview group. */
    primary_group: { slug: string; name: string } | null;
    /** Top-level parent name when this row is a subcategory (for display). */
    parent?: { name: string } | null;
  } | null;
  income_treatment: IncomeOverviewTreatment | null;
  /** When true, transaction is flagged as a business expense for tax reporting. */
  is_business_expense?: boolean;
  /** When this row exists in `transactions` and came from Plaid sync. */
  plaid_transaction_id?: string | null;
  /** When set, row is soft-archived (out of active ledger until restored). */
  ledger_archived_at?: string | null;
  /** True when the row is only from `plaid_transactions` (not the main ledger yet). */
  plaid_feed_only?: boolean;
  /** Display label for source bank account (if known). */
  account_name?: string | null;
  /** Receipts attached to this transaction (populated on demand). */
  receipts?: ReceiptRow[];
};

export type ReceiptRow = {
  id: string;
  transaction_id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  created_at: string;
};

export type IncomeRuleView = {
  id: string;
  match_type: "exact_normalized" | "contains" | "prefix";
  pattern: string;
  priority: number;
  treatment: IncomeOverviewTreatment;
  amount_sign: AmountSignFilter;
};

export type SavingsPlanKind = "project" | "vacation";

export type SavingsIncrementPeriod =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "annually";

export type SavingsPlanRow = {
  id: string;
  household_id: string;
  title: string;
  plan_kind: SavingsPlanKind;
  target_amount: number;
  start_date: string;
  target_date: string;
  increment_amount: number | null;
  increment_period: SavingsIncrementPeriod | null;
  is_archived: boolean;
  /** When true, plan is included in projected contribution totals. */
  include_in_projection: boolean;
  notes: string | null;
};

export type SavingsPlanContributionRow = {
  id: string;
  savings_plan_id: string;
  amount: number;
  contributed_on: string;
  note: string | null;
};

/** For dashboard / summary: saved totals and planned pace as of “today”. */
export type SavingsPlanWithProgress = SavingsPlanRow & {
  total_saved: number;
  expected_by_today: number;
};
