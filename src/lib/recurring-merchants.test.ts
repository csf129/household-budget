import { describe, it, expect } from "vitest";
import {
  detectRecurringMerchants,
  median,
  type MerchantCharge,
} from "@/lib/recurring-merchants";

function charge(
  merchant: string,
  amount: number,
  occurredOn: string,
  categoryId: string | null = null,
): MerchantCharge {
  return { merchant, merchantLabel: merchant, amount, occurredOn, categoryId };
}

/** Build `count` monthly charges ending at `lastIso`, newest-first dates. */
function monthlyCharges(merchant: string, amount: number, months: string[]): MerchantCharge[] {
  return months.map((m) => charge(merchant, amount, m));
}

describe("median", () => {
  it("handles odd and even counts", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("returns 0 for empty", () => {
    expect(median([])).toBe(0);
  });
});

describe("detectRecurringMerchants", () => {
  it("detects a monthly subscription with >= 3 regular charges", () => {
    const result = detectRecurringMerchants(
      monthlyCharges("netflix", 15.49, ["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.cadence).toBe("monthly");
    expect(result[0]!.latestCharge.occurredOn).toBe("2026-11-05");
    expect(result[0]!.baselineAmount).toBe(15.49);
  });

  it("ignores merchants with fewer than MIN_CHARGES", () => {
    const result = detectRecurringMerchants([
      charge("spotify", 11.99, "2026-10-01"),
      charge("spotify", 11.99, "2026-11-01"),
    ]);
    expect(result).toHaveLength(0);
  });

  it("rejects irregular (non-cadence) spacing", () => {
    // 3 charges but intervals of 2 and 120 days — no coherent cadence.
    const result = detectRecurringMerchants([
      charge("random store", 20, "2026-06-01"),
      charge("random store", 20, "2026-06-03"),
      charge("random store", 20, "2026-10-01"),
    ]);
    expect(result).toHaveLength(0);
  });

  it("detects weekly and annual cadences", () => {
    const weekly = detectRecurringMerchants([
      charge("gym", 10, "2026-10-01"),
      charge("gym", 10, "2026-10-08"),
      charge("gym", 10, "2026-10-15"),
    ]);
    expect(weekly[0]!.cadence).toBe("weekly");

    const annual = detectRecurringMerchants([
      charge("domain", 12, "2024-03-01"),
      charge("domain", 12, "2025-03-01"),
      charge("domain", 12, "2026-03-01"),
    ]);
    expect(annual[0]!.cadence).toBe("annual");
  });

  it("baseline excludes the latest charge so a price change is detectable", () => {
    const result = detectRecurringMerchants(
      monthlyCharges("news", 9.99, ["2026-08-10", "2026-09-10", "2026-10-10", "2026-11-10"]).map(
        (c, i, arr) => (i === arr.length - 1 ? { ...c, amount: 12.99 } : c),
      ),
    );
    expect(result[0]!.baselineAmount).toBe(9.99);
    expect(result[0]!.latestCharge.amount).toBe(12.99);
  });

  it("skips non-positive and non-finite amounts", () => {
    const result = detectRecurringMerchants([
      charge("x", 0, "2026-09-01"),
      charge("x", -5, "2026-10-01"),
      charge("x", Number.NaN, "2026-11-01"),
    ]);
    expect(result).toHaveLength(0);
  });
});
