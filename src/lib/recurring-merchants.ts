/**
 * Auto-detect recurring merchants from a household's expense transactions.
 *
 * Pure + deterministic (no DB, no clock) so it is unit-testable. The caller
 * fetches expenses, converts each outflow to a positive magnitude, and passes
 * them in. A merchant is "recurring" when it has at least MIN_CHARGES charges
 * landing on a regular weekly / monthly / annual cadence.
 */

export type MerchantCharge = {
  /** Normalized merchant description — the grouping key. */
  merchant: string;
  /** Human-facing label (raw description). */
  merchantLabel: string;
  /** Positive magnitude of the charge. */
  amount: number;
  /** ISO date (YYYY-MM-DD). */
  occurredOn: string;
  categoryId: string | null;
};

export type RecurringCadence = "weekly" | "monthly" | "annual";

export type RecurringMerchant = {
  merchant: string;
  merchantLabel: string;
  cadence: RecurringCadence;
  /** All charges, sorted oldest → newest. */
  charges: MerchantCharge[];
  /** Established price: median of all charges except the most recent. */
  baselineAmount: number;
  /** The most recent charge. */
  latestCharge: MerchantCharge;
  categoryId: string | null;
};

/** A merchant needs at least this many charges to be considered recurring. */
export const MIN_CHARGES = 3;

/** Inclusive day-interval bands for each cadence (median interval must land here). */
const CADENCE_BANDS: { cadence: RecurringCadence; min: number; max: number }[] = [
  { cadence: "weekly", min: 5, max: 10 },
  { cadence: "monthly", min: 24, max: 38 },
  { cadence: "annual", min: 330, max: 400 },
];

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function classifyCadence(medianInterval: number): RecurringCadence | null {
  for (const band of CADENCE_BANDS) {
    if (medianInterval >= band.min && medianInterval <= band.max) return band.cadence;
  }
  return null;
}

/**
 * Group charges by merchant and keep only those on a regular cadence.
 * Returns one `RecurringMerchant` per qualifying merchant.
 */
export function detectRecurringMerchants(charges: MerchantCharge[]): RecurringMerchant[] {
  const groups = new Map<string, MerchantCharge[]>();
  for (const c of charges) {
    if (!c.merchant || !Number.isFinite(c.amount) || c.amount <= 0) continue;
    const list = groups.get(c.merchant);
    if (list) list.push(c);
    else groups.set(c.merchant, [c]);
  }

  const result: RecurringMerchant[] = [];

  for (const [merchant, list] of groups) {
    if (list.length < MIN_CHARGES) continue;

    const sorted = [...list].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));

    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(daysBetween(sorted[i - 1]!.occurredOn, sorted[i]!.occurredOn));
    }
    // Drop zero-day intervals (duplicate same-day charges) from cadence math.
    const nonZero = intervals.filter((d) => d > 0);
    if (nonZero.length === 0) continue;

    const cadence = classifyCadence(median(nonZero));
    if (!cadence) continue;

    const latestCharge = sorted[sorted.length - 1]!;
    const priorAmounts = sorted.slice(0, -1).map((c) => c.amount);
    const baselineAmount = median(priorAmounts);

    result.push({
      merchant,
      merchantLabel: latestCharge.merchantLabel,
      cadence,
      charges: sorted,
      baselineAmount,
      latestCharge,
      categoryId: latestCharge.categoryId,
    });
  }

  return result;
}
