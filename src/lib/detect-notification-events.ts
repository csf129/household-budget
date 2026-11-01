/**
 * Turn recurring merchants into notification events (price change / bill paid).
 *
 * Pure + deterministic: the clock and the set of already-recorded events are
 * injected, so the same inputs always yield the same events. `dedupKey` keys
 * each event to a merchant + charge date so a given event is produced once.
 */
import type { NotificationEvent } from "@/types/notifications";
import type { RecurringMerchant } from "@/lib/recurring-merchants";

export type DetectParams = {
  priceChangeEnabled: boolean;
  billPaidEnabled: boolean;
  /** Dedup keys already persisted for this household. */
  existingDedupKeys: Set<string>;
  /** Reference "now" used for the recency gate. */
  today: Date;
  /** Only act on charges this recent (days). Default 35 (covers a monthly cycle). */
  recentWithinDays?: number;
  /** Minimum absolute $ delta to count as a price change. Default 1. */
  priceChangeAbsMin?: number;
  /** Minimum fractional delta to count as a price change. Default 0.05 (5%). */
  priceChangePctMin?: number;
};

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysSince(iso: string, today: Date): number {
  const then = Date.parse(`${iso}T00:00:00Z`);
  const now = Date.parse(`${toIsoDate(today)}T00:00:00Z`);
  return Math.round((now - then) / 86_400_000);
}

export function detectNotificationEvents(
  merchants: RecurringMerchant[],
  params: DetectParams,
): NotificationEvent[] {
  const {
    priceChangeEnabled,
    billPaidEnabled,
    existingDedupKeys,
    today,
    recentWithinDays = 35,
    priceChangeAbsMin = 1,
    priceChangePctMin = 0.05,
  } = params;

  const events: NotificationEvent[] = [];

  for (const m of merchants) {
    const latest = m.latestCharge;
    const age = daysSince(latest.occurredOn, today);
    // Ignore stale charges (and guard against future-dated rows).
    if (age < 0 || age > recentWithinDays) continue;

    if (billPaidEnabled) {
      const dedupKey = `bill_paid:${m.merchant}:${latest.occurredOn}`;
      if (!existingDedupKeys.has(dedupKey)) {
        events.push({
          type: "bill_paid",
          dedupKey,
          merchant: m.merchant,
          merchantLabel: m.merchantLabel,
          amount: latest.amount,
          previousAmount: null,
          occurredOn: latest.occurredOn,
          categoryId: m.categoryId,
        });
      }
    }

    if (priceChangeEnabled && m.baselineAmount > 0) {
      const delta = Math.abs(latest.amount - m.baselineAmount);
      const pct = delta / m.baselineAmount;
      if (delta >= priceChangeAbsMin && pct >= priceChangePctMin) {
        const dedupKey = `price_change:${m.merchant}:${latest.occurredOn}`;
        if (!existingDedupKeys.has(dedupKey)) {
          events.push({
            type: "subscription_price_change",
            dedupKey,
            merchant: m.merchant,
            merchantLabel: m.merchantLabel,
            amount: latest.amount,
            previousAmount: m.baselineAmount,
            occurredOn: latest.occurredOn,
            categoryId: m.categoryId,
          });
        }
      }
    }
  }

  return events;
}
