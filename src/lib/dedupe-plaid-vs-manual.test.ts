import { describe, it, expect } from "vitest";
import {
  ledgerAmountsEqual,
  clampMaxCalendarDayGap,
  calendarDaysApart,
  descriptionsSimilarForPlaidManualDedupe,
  transactionIsPlaidBacked,
  planLedgerDuplicateDeletions,
  type DedupeLedgerRow,
} from "./dedupe-plaid-vs-manual";

function ledgerRow(
  partial: Partial<DedupeLedgerRow> & { id: string },
): DedupeLedgerRow {
  return {
    occurred_on: "2026-01-15",
    amount: -12.5,
    raw_description: "Market Basket",
    normalized_description: "market basket",
    plaid_transaction_id: null,
    ...partial,
  };
}

describe("ledgerAmountsEqual", () => {
  it("treats sub-cent differences as equal", () => {
    expect(ledgerAmountsEqual(12.5, 12.505)).toBe(true);
    expect(ledgerAmountsEqual(12.5, 12.5)).toBe(true);
  });

  it("treats a cent or more apart as different", () => {
    expect(ledgerAmountsEqual(12.5, 12.51)).toBe(false);
  });

  it("does not equate opposite signs", () => {
    expect(ledgerAmountsEqual(12.5, -12.5)).toBe(false);
  });
});

describe("clampMaxCalendarDayGap", () => {
  it("defaults to 3 for non-numbers", () => {
    expect(clampMaxCalendarDayGap(undefined)).toBe(3);
    expect(clampMaxCalendarDayGap("5")).toBe(3);
    expect(clampMaxCalendarDayGap(NaN)).toBe(3);
  });

  it("clamps to the 0–7 window and floors", () => {
    expect(clampMaxCalendarDayGap(-2)).toBe(0);
    expect(clampMaxCalendarDayGap(99)).toBe(7);
    expect(clampMaxCalendarDayGap(2.9)).toBe(2);
  });
});

describe("calendarDaysApart", () => {
  it("counts whole calendar days regardless of order", () => {
    expect(calendarDaysApart("2026-01-01", "2026-01-04")).toBe(3);
    expect(calendarDaysApart("2026-01-04", "2026-01-01")).toBe(3);
    expect(calendarDaysApart("2026-01-01", "2026-01-01")).toBe(0);
  });

  it("ignores any time suffix", () => {
    expect(
      calendarDaysApart("2026-01-01T23:00:00Z", "2026-01-02T01:00:00Z"),
    ).toBe(1);
  });

  it("spans month and year boundaries", () => {
    expect(calendarDaysApart("2026-01-31", "2026-02-01")).toBe(1);
    expect(calendarDaysApart("2025-12-31", "2026-01-01")).toBe(1);
  });

  it("returns a large sentinel for unparseable input", () => {
    expect(calendarDaysApart("not-a-date", "2026-01-01")).toBe(9999);
  });
});

describe("descriptionsSimilarForPlaidManualDedupe", () => {
  it("matches identical normalized text", () => {
    expect(
      descriptionsSimilarForPlaidManualDedupe("Market Basket", "market  basket"),
    ).toBe(true);
  });

  it("matches when the longer letters-core contains the shorter", () => {
    expect(
      descriptionsSimilarForPlaidManualDedupe(
        "Market Basket",
        "MARKET BASKET700000760",
      ),
    ).toBe(true);
  });

  it("does not match a short (<6 letter) core that merely overlaps", () => {
    expect(descriptionsSimilarForPlaidManualDedupe("Cafe", "Cafeteria")).toBe(
      false,
    );
  });

  it("does not match empty/letterless descriptions", () => {
    expect(descriptionsSimilarForPlaidManualDedupe("12345", "67890")).toBe(
      false,
    );
  });
});

describe("transactionIsPlaidBacked", () => {
  it("is true only for a non-empty plaid id", () => {
    expect(transactionIsPlaidBacked({ plaid_transaction_id: "abc" })).toBe(true);
    expect(transactionIsPlaidBacked({ plaid_transaction_id: "  " })).toBe(false);
    expect(transactionIsPlaidBacked({ plaid_transaction_id: null })).toBe(false);
    expect(transactionIsPlaidBacked({})).toBe(false);
  });
});

describe("planLedgerDuplicateDeletions", () => {
  it("returns nothing for fewer than two rows", () => {
    expect(planLedgerDuplicateDeletions([])).toEqual([]);
    expect(planLedgerDuplicateDeletions([ledgerRow({ id: "a" })])).toEqual([]);
  });

  it("deletes the manual copy and keeps the Plaid row in a mixed cluster", () => {
    const plan = planLedgerDuplicateDeletions([
      ledgerRow({ id: "m1", plaid_transaction_id: null }),
      ledgerRow({
        id: "p1",
        plaid_transaction_id: "plaid_xyz",
        raw_description: "MARKET BASKET700000760",
        normalized_description: "market basket700000760",
      }),
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0].deleteId).toBe("m1");
    expect(plan[0].keeper_ledger_id).toBe("p1");
    expect(plan[0].keeper_is_plaid).toBe(true);
  });

  it("keeps a stable Plaid row (lowest id) when all are Plaid-backed", () => {
    const plan = planLedgerDuplicateDeletions([
      ledgerRow({ id: "b", plaid_transaction_id: "p_b" }),
      ledgerRow({ id: "a", plaid_transaction_id: "p_a" }),
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0].deleteId).toBe("b");
    expect(plan[0].keeper_ledger_id).toBe("a");
  });

  it("keeps the richer raw string among manual-only duplicates", () => {
    const plan = planLedgerDuplicateDeletions([
      ledgerRow({ id: "x2", raw_description: "Costco" }),
      ledgerRow({ id: "x1", raw_description: "COSTCO WHSE #0612" }),
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0].deleteId).toBe("x2");
    expect(plan[0].keeper_ledger_id).toBe("x1");
    expect(plan[0].keeper_is_plaid).toBe(false);
  });

  it("does not pair rows with different amounts", () => {
    const plan = planLedgerDuplicateDeletions([
      ledgerRow({ id: "a", amount: -10 }),
      ledgerRow({ id: "b", amount: -11 }),
    ]);
    expect(plan).toEqual([]);
  });

  it("does not pair rows outside the calendar-day gap", () => {
    const plan = planLedgerDuplicateDeletions([
      ledgerRow({ id: "a", occurred_on: "2026-01-01" }),
      ledgerRow({ id: "b", occurred_on: "2026-01-09" }),
    ]);
    expect(plan).toEqual([]);
  });

  it("does not pair rows with unrelated descriptions", () => {
    const plan = planLedgerDuplicateDeletions([
      ledgerRow({ id: "a", raw_description: "Market Basket", normalized_description: "market basket" }),
      ledgerRow({ id: "b", raw_description: "Shell Gas", normalized_description: "shell gas" }),
    ]);
    expect(plan).toEqual([]);
  });
});
