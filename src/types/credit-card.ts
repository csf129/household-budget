export type CreditCardStatus = "active" | "review" | "cancelled";

/** A Plaid-linked credit account joined with user-entered card metadata. */
export type CreditCardView = {
  /** bank_accounts.id — the stable identifier used everywhere. */
  id: string;
  /** Display name: user nickname (display_name) falling back to Plaid name. */
  name: string;
  /** Raw Plaid account name (for reference when a nickname is set). */
  plaidName: string;
  mask: string | null;
  /** Balance owed (Plaid current_balance for credit). */
  currentBalance: number | null;
  /** Remaining available credit (Plaid available_balance). */
  availableBalance: number | null;
  isoCurrencyCode: string | null;
  // ── User-entered metadata (null when not yet filled in) ──────────
  annualFee: number | null;
  annualFeeMonth: number | null;
  paymentDueDay: number | null;
  pointsProgram: string | null;
  pointsBalance: number | null;
  pointsUpdatedOn: string | null;
  rewardSummary: string | null;
  status: CreditCardStatus;
  notes: string | null;
};

/** Editable fields written back via PUT /api/household/credit-cards. */
export type CreditCardMetadataInput = {
  bankAccountId: string;
  annualFee: number | null;
  annualFeeMonth: number | null;
  paymentDueDay: number | null;
  pointsProgram: string | null;
  pointsBalance: number | null;
  pointsUpdatedOn: string | null;
  rewardSummary: string | null;
  status: CreditCardStatus;
  notes: string | null;
};

export type ReminderUrgency = "overdue" | "soon" | "upcoming";

export type CardReminder = {
  cardId: string;
  cardName: string;
  kind: "payment_due" | "fee_renewal";
  /** ISO date (YYYY-MM-DD) the event falls on. */
  date: string;
  daysUntil: number;
  urgency: ReminderUrgency;
};

export type CardInsights = {
  perCategory: { category: string; recommendedCard: string; why: string }[];
  underusedCards: { card: string; reason: string }[];
  verdicts: { card: string; verdict: string; reasoning: string }[];
  tips: string[];
};
