import { formatUsd } from "@/lib/money";
import type { SavingsIncrementPeriod } from "@/types/finance";

export const SAVINGS_INCREMENT_OPTIONS: {
  value: SavingsIncrementPeriod;
  label: string;
}[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "annually", label: "Annually" },
];

export function incrementPeriodLabel(p: SavingsIncrementPeriod): string {
  const o = SAVINGS_INCREMENT_OPTIONS.find((x) => x.value === p);
  return o?.label ?? p;
}

/** Human-readable installment cadence for tables and summaries. */
export function formatSavingsCadence(
  incrementAmount: number | null,
  incrementPeriod: SavingsIncrementPeriod | null,
): string {
  if (incrementAmount == null || incrementPeriod == null) {
    return "Linear (smooth over timeline)";
  }
  const amt = formatUsd(incrementAmount);
  switch (incrementPeriod) {
    case "daily":
      return `${amt} / day`;
    case "weekly":
      return `${amt} / week`;
    case "biweekly":
      return `${amt} / 2 weeks`;
    case "monthly":
      return `${amt} / month`;
    case "annually":
      return `${amt} / year`;
    default:
      return `${amt} / period`;
  }
}
