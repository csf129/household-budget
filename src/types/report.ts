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
};
