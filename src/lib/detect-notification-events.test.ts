import { describe, it, expect } from "vitest";
import { detectNotificationEvents, type DetectParams } from "@/lib/detect-notification-events";
import type { RecurringMerchant } from "@/lib/recurring-merchants";

function merchant(overrides: Partial<RecurringMerchant> & { merchant: string }): RecurringMerchant {
  const latestOn = overrides.latestCharge?.occurredOn ?? "2026-11-05";
  const amount = overrides.latestCharge?.amount ?? 15.49;
  return {
    merchant: overrides.merchant,
    merchantLabel: overrides.merchantLabel ?? overrides.merchant,
    cadence: overrides.cadence ?? "monthly",
    charges: overrides.charges ?? [],
    baselineAmount: overrides.baselineAmount ?? amount,
    latestCharge: overrides.latestCharge ?? {
      merchant: overrides.merchant,
      merchantLabel: overrides.merchant,
      amount,
      occurredOn: latestOn,
      categoryId: null,
    },
    categoryId: overrides.categoryId ?? null,
  };
}

const TODAY = new Date("2026-11-10T00:00:00Z");

function params(overrides: Partial<DetectParams> = {}): DetectParams {
  return {
    priceChangeEnabled: true,
    billPaidEnabled: true,
    existingDedupKeys: new Set(),
    today: TODAY,
    ...overrides,
  };
}

describe("detectNotificationEvents", () => {
  it("emits a bill_paid for a recent recurring charge", () => {
    const events = detectNotificationEvents([merchant({ merchant: "netflix" })], params());
    const bill = events.find((e) => e.type === "bill_paid");
    expect(bill).toBeDefined();
    expect(bill!.amount).toBe(15.49);
    expect(bill!.dedupKey).toBe("bill_paid:netflix:2026-11-05");
  });

  it("emits a price_change when latest exceeds baseline past the threshold", () => {
    const m = merchant({
      merchant: "news",
      baselineAmount: 9.99,
      latestCharge: { merchant: "news", merchantLabel: "news", amount: 12.99, occurredOn: "2026-11-05", categoryId: null },
    });
    const events = detectNotificationEvents([m], params());
    const pc = events.find((e) => e.type === "subscription_price_change");
    expect(pc).toBeDefined();
    expect(pc!.previousAmount).toBe(9.99);
    expect(pc!.amount).toBe(12.99);
  });

  it("does not emit a price_change for a sub-threshold change", () => {
    const m = merchant({
      merchant: "tiny",
      baselineAmount: 10.0,
      latestCharge: { merchant: "tiny", merchantLabel: "tiny", amount: 10.3, occurredOn: "2026-11-05", categoryId: null },
    });
    const events = detectNotificationEvents([m], params());
    expect(events.some((e) => e.type === "subscription_price_change")).toBe(false);
  });

  it("respects the recency gate (ignores stale charges)", () => {
    const m = merchant({
      merchant: "old",
      latestCharge: { merchant: "old", merchantLabel: "old", amount: 15.49, occurredOn: "2026-01-01", categoryId: null },
    });
    expect(detectNotificationEvents([m], params())).toHaveLength(0);
  });

  it("suppresses events whose dedup key already exists", () => {
    const events = detectNotificationEvents(
      [merchant({ merchant: "netflix" })],
      params({ existingDedupKeys: new Set(["bill_paid:netflix:2026-11-05"]) }),
    );
    expect(events.some((e) => e.type === "bill_paid")).toBe(false);
  });

  it("honors the per-type enable flags", () => {
    const m = merchant({
      merchant: "news",
      baselineAmount: 9.99,
      latestCharge: { merchant: "news", merchantLabel: "news", amount: 12.99, occurredOn: "2026-11-05", categoryId: null },
    });
    const onlyPrice = detectNotificationEvents([m], params({ billPaidEnabled: false }));
    expect(onlyPrice.every((e) => e.type === "subscription_price_change")).toBe(true);

    const onlyBill = detectNotificationEvents([m], params({ priceChangeEnabled: false }));
    expect(onlyBill.every((e) => e.type === "bill_paid")).toBe(true);
  });
});
