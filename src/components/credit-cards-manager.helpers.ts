import type { CreditCardStatus, CreditCardView } from "@/types/credit-card";

/**
 * Pure helpers, constants, and the form shape extracted from
 * credit-cards-manager.tsx. No React, no state.
 */

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function fmtMoney(n: number | null, currency = "USD"): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export function fmtPoints(n: number | null): string {
  return n === null ? "—" : new Intl.NumberFormat("en-US").format(n);
}

export const STATUS_BADGE: Record<CreditCardStatus, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  review: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  cancelled: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export const STATUS_LABEL: Record<CreditCardStatus, string> = {
  active: "Active",
  review: "Reviewing",
  cancelled: "Cancelled",
};

export const URGENCY_STYLES: Record<string, string> = {
  overdue: "border-red-300 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200",
  soon: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
  upcoming: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
};

export function duePhrase(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `in ${days} days`;
}

export type FormState = {
  annualFee: string;
  annualFeeMonth: string;
  paymentDueDay: string;
  pointsProgram: string;
  pointsBalance: string;
  rewardSummary: string;
  status: CreditCardStatus;
  notes: string;
};

export function toForm(card: CreditCardView): FormState {
  return {
    annualFee: card.annualFee != null ? String(card.annualFee) : "",
    annualFeeMonth: card.annualFeeMonth != null ? String(card.annualFeeMonth) : "",
    paymentDueDay: card.paymentDueDay != null ? String(card.paymentDueDay) : "",
    pointsProgram: card.pointsProgram ?? "",
    pointsBalance: card.pointsBalance != null ? String(card.pointsBalance) : "",
    rewardSummary: card.rewardSummary ?? "",
    status: card.status,
    notes: card.notes ?? "",
  };
}
