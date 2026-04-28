export type SummaryFrequency = "weekly" | "monthly" | "quarterly";

export type SummarySections = {
  income_spending: boolean;
  category_breakdown: boolean;
  budget_progress: boolean;
  top_transactions: boolean;
  business_expenses: boolean;
  savings_plans: boolean;
};

export const DEFAULT_SECTIONS: SummarySections = {
  income_spending: true,
  category_breakdown: true,
  budget_progress: false,
  top_transactions: false,
  business_expenses: false,
  savings_plans: false,
};

export const SECTION_LABELS: Record<keyof SummarySections, string> = {
  income_spending: "Income & Spending Overview",
  category_breakdown: "Spending by Category",
  budget_progress: "Budget Progress",
  top_transactions: "Top Transactions",
  business_expenses: "Business Expenses",
  savings_plans: "Savings Plan Progress",
};

export type EmailSummarySettings = {
  recipients: string[];
  frequencies: SummaryFrequency[];
  sections: SummarySections;
  last_sent_at: string | null;
};

export type SummaryPeriod = "week" | "month" | "quarter";
