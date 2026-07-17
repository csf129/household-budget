import type { CardReminder, ReminderUrgency } from "@/types/credit-card";

/** Minimal card shape needed to compute reminders (works for CreditCardView). */
export type ReminderCardInput = {
  id: string;
  name: string;
  paymentDueDay: number | null;
  annualFee: number | null;
  annualFeeMonth: number | null;
  status: "active" | "review" | "cancelled";
};

/** Show a payment-due reminder when the due date is within this many days. */
export const PAYMENT_DUE_WINDOW_DAYS = 14;
/** Show an annual-fee renewal warning this far ahead (time to cancel). */
export const FEE_RENEWAL_WINDOW_DAYS = 60;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function daysBetween(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** Next calendar occurrence of `dueDay` (day-of-month), clamped to month length. */
export function nextDueDate(dueDay: number, today: Date): Date {
  const base = startOfDay(today);
  const thisMonthDay = Math.min(dueDay, lastDayOfMonth(base.getFullYear(), base.getMonth()));
  const candidate = new Date(base.getFullYear(), base.getMonth(), thisMonthDay);
  if (candidate.getTime() >= base.getTime()) return candidate;
  const nextMonth = base.getMonth() + 1;
  const y = base.getFullYear() + Math.floor(nextMonth / 12);
  const m = nextMonth % 12;
  return new Date(y, m, Math.min(dueDay, lastDayOfMonth(y, m)));
}

/** Next renewal anniversary: day 1 of `feeMonth` (1-12) in the soonest year >= today. */
export function nextRenewalDate(feeMonth: number, today: Date): Date {
  const base = startOfDay(today);
  const monthIndex = feeMonth - 1;
  const thisYear = new Date(base.getFullYear(), monthIndex, 1);
  if (thisYear.getTime() >= base.getTime()) return thisYear;
  return new Date(base.getFullYear() + 1, monthIndex, 1);
}

function paymentUrgency(daysUntil: number): ReminderUrgency {
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 7) return "soon";
  return "upcoming";
}

function renewalUrgency(daysUntil: number): ReminderUrgency {
  if (daysUntil <= 30) return "soon";
  return "upcoming";
}

/**
 * Build the list of active reminders (payment due + annual-fee renewal) across
 * all cards, sorted soonest first. Cancelled cards are skipped.
 */
export function buildCardReminders(
  cards: ReminderCardInput[],
  today: Date = new Date(),
): CardReminder[] {
  const reminders: CardReminder[] = [];

  for (const card of cards) {
    if (card.status === "cancelled") continue;

    if (card.paymentDueDay != null) {
      const date = nextDueDate(card.paymentDueDay, today);
      const daysUntil = daysBetween(today, date);
      if (daysUntil <= PAYMENT_DUE_WINDOW_DAYS) {
        reminders.push({
          cardId: card.id,
          cardName: card.name,
          kind: "payment_due",
          date: toIsoDate(date),
          daysUntil,
          urgency: paymentUrgency(daysUntil),
        });
      }
    }

    const hasFee = card.annualFee != null && card.annualFee > 0 && card.annualFeeMonth != null;
    if (hasFee) {
      const date = nextRenewalDate(card.annualFeeMonth as number, today);
      const daysUntil = daysBetween(today, date);
      if (daysUntil >= 0 && daysUntil <= FEE_RENEWAL_WINDOW_DAYS) {
        reminders.push({
          cardId: card.id,
          cardName: card.name,
          kind: "fee_renewal",
          date: toIsoDate(date),
          daysUntil,
          urgency: renewalUrgency(daysUntil),
        });
      }
    }
  }

  return reminders.sort((a, b) => a.daysUntil - b.daysUntil);
}
