/**
 * Shape of the household budget report returned by `GET /api/report` and
 * assembled by `assembleReportData`. Consumed by the `/budget-report` skill to
 * build the report artifact. All money values are USD; spending is a positive
 * number (money out), income is a positive number (money in).
 */

/** Spend direction of a category versus its trailing average. */
export type SpendDirection = "up" | "down" | "flat";

/** Per-series stats shared between category rows and the pure math helper. */
export type SeriesStats = {
  /** Value in the latest complete month. */
  current: number;
  /** Value in the month before the latest. */
  previous: number;
  /** Mean of every month before the latest (trailing average). */
  trailingAvg: number;
  /** current - previous. */
  momDelta: number;
  /** (current - previous) / previous; null when previous is 0. */
  momPct: number | null;
  /** current - trailingAvg. */
  trendDelta: number;
  /** Direction vs trailing average, with a small flat band. */
  direction: SpendDirection;
};

/** One spending category with its monthly series and up/down signal. */
export type ReportCategorySeries = SeriesStats & {
  name: string;
  color: string;
  /** Spend per month, aligned with `ReportData.months` (oldest → newest). */
  series: number[];
  /**
   * The household's currently-set monthly budget for this category (effective
   * for the latest complete month), or null when no budget is set. Drawn as a
   * reference line on the report's per-category plots.
   */
  monthlyBudget?: number | null;
  /** The category id this series maps to, when it maps to exactly one. */
  categoryId?: string | null;
  /**
   * True when the budget is a plain flat monthly amount (or unset) and so can
   * be safely edited inline from the plot. False for seasonal / annual / weekly
   * / recurring budgets, which must be edited on the Settings screen so their
   * extra configuration isn't clobbered.
   */
  budgetEditableInline?: boolean;
};

/** One recorded change to a category's monthly budget, for the audit view. */
export type BudgetChange = {
  id: string;
  /** Category display name as it was when the change was made. */
  categoryName: string;
  /** Previous monthly_budget value (null = none set). */
  oldAmount: number | null;
  /** New monthly_budget value (null = cleared). */
  newAmount: number | null;
  source: "report" | "settings";
  createdAt: string;
  /** True when the signed-in user made this change. */
  changedByMe: boolean;
};

/** One calendar month of household totals. */
export type ReportMonth = {
  key: string;
  label: string;
  start: string;
  end: string;
  income: number;
  spending: number;
  /** income - spending. */
  net: number;
};

/** A credit card's current standing (as of report generation). */
export type ReportCreditCard = {
  name: string;
  mask: string | null;
  /** Amount owed (positive = balance carried). */
  balance: number | null;
  /** Remaining available credit. */
  available: number | null;
  /** balance / (balance + available); null when either is unknown. */
  utilization: number | null;
  paymentDueDay: number | null;
  annualFee: number | null;
  annualFeeMonth: number | null;
  pointsProgram: string | null;
  pointsBalance: number | null;
  rewardSummary: string | null;
  status: string;
};

/** A savings plan with progress and pace versus plan. */
export type ReportSavingsPlan = {
  title: string;
  kind: string;
  target: number;
  saved: number;
  expectedByToday: number;
  targetDate: string;
  /** saved / target (0..1+, not capped). */
  progress: number;
  /** saved - expectedByToday; negative = behind pace. */
  pace: number;
};

/** How hard a saving is to act on, used to rank and color opportunities. */
export type SavingsEffort = "easy" | "medium" | "hard";

/** One ranked place the household can cut spending, grounded in report data. */
export type SavingsOpportunity = {
  /** Category or area the saving comes from, e.g. "Food & drink". */
  category: string;
  /** Current monthly spend for this area. */
  current: number;
  /** Trailing-average monthly spend this is compared against. */
  avg: number;
  /** Estimated dollars saved per month if acted on. */
  estMonthlySaving: number;
  effort: SavingsEffort;
  /** One concrete, plain-English next step. */
  action: string;
};

/**
 * One household note about the report that persists across regenerations and is
 * fed back into future AI savings analysis (both the in-app deep-dive and the
 * `/budget-report` skill artifact). Notes are shared household context.
 */
export type ReportFeedback = {
  /**
   * The savings area / category the note is about (e.g. "Karate",
   * "Food & drink"), matching a `SavingsOpportunity.category` where possible.
   * An empty string is a general, report-wide note.
   */
  category: string;
  /** The household's free-text note / constraint / correction. */
  note: string;
  /** ISO timestamp the note was last saved. */
  updatedAt: string;
};

/**
 * Structured "where to save the most, easiest first" analysis the AI returns,
 * rendered as a graphical breakdown rather than prose. Every figure is grounded
 * in `ReportData`.
 */
export type SavingsAnalysis = {
  /** One-line headline summarizing the opportunity. */
  headline: string;
  /** Rough total monthly saving across the shortlist. */
  totalMonthlySaving: number;
  /** Opportunities ranked biggest + easiest first. */
  opportunities: SavingsOpportunity[];
  /** Category names worth doing first. */
  shortlist: string[];
};

/**
 * One spending transaction behind a category/month bar on the report's
 * "Individual" tab. Positive `amount` = money out, matching how the category
 * bars are summed (so a month's transactions add up to its bar).
 */
export type ReportTransaction = {
  /** Category display name; matches `ReportCategorySeries.name`. */
  category: string;
  /** Month bucket key; aligns with `ReportMonth.key`. */
  monthKey: string;
  /** Transaction date, YYYY-MM-DD. */
  occurredOn: string;
  description: string;
  /** Spend in USD (positive = money out). */
  amount: number;
};

/** Drill-down payload for the report's per-category plots. */
export type ReportTransactionsPayload = {
  /** Months in the window, oldest → newest, aligned with the report series. */
  months: { key: string; label: string }[];
  items: ReportTransaction[];
};

export type ReportData = {
  householdName: string;
  /** ISO timestamp the report was generated. */
  generatedAt: string;
  /**
   * Complete calendar months, oldest → newest. Excludes the in-progress month
   * so month-over-month comparisons are honest. The last entry is "current".
   */
  months: ReportMonth[];
  /** Index into `months` treated as the current period (always the last one). */
  currentIndex: number;
  totals: {
    /** Latest complete month. */
    income: number;
    spending: number;
    net: number;
    /** Trailing average across the prior complete months. */
    avgIncome: number;
    avgSpending: number;
  };
  /** Spending categories with monthly series + deltas, sorted by current spend desc. */
  categories: ReportCategorySeries[];
  creditCards: ReportCreditCard[];
  savingsPlans: ReportSavingsPlan[];
  /**
   * Household notes on the report, carried from prior sessions so the AI
   * analysis can honor the household's own constraints and corrections.
   */
  feedback: ReportFeedback[];
};
