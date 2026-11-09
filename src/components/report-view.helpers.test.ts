import { describe, it, expect } from "vitest";
import {
  matchesAny,
  BILL_HINTS,
  CAR_HINTS,
  notesFromFeedback,
  fmtBudgetDate,
  groupRevertTargets,
  categoryWindowAverage,
  sumCategoryBudgets,
  overBudgetCategories,
} from "./report-view.helpers";
import type { BudgetChange, ReportCategorySeries, ReportFeedback } from "@/types/report";

const cat = (
  name: string,
  series: number[],
  monthlyBudget: number | null,
): ReportCategorySeries =>
  ({ name, series, monthlyBudget } as unknown as ReportCategorySeries);

describe("matchesAny", () => {
  it("matches a hint case-insensitively as a substring", () => {
    expect(matchesAny("CITY ELECTRIC CO", BILL_HINTS)).toBe(true);
    expect(matchesAny("Shell Fuel", CAR_HINTS)).toBe(true);
  });
  it("returns false when no hint is present", () => {
    expect(matchesAny("Grocery Mart", CAR_HINTS)).toBe(false);
  });
});

describe("notesFromFeedback", () => {
  it("maps category to trimmed note, skipping blanks", () => {
    const fb = [
      { category: "Food", note: "  watch dining  " },
      { category: "Gas", note: "   " },
    ] as unknown as ReportFeedback[];
    expect(notesFromFeedback(fb)).toEqual({ Food: "watch dining" });
  });
  it("handles undefined", () => {
    expect(notesFromFeedback(undefined)).toEqual({});
  });
});

describe("fmtBudgetDate", () => {
  it("formats a valid ISO date (timezone-agnostic shape)", () => {
    // The display day can shift by one in western timezones (date-only ISO is
    // parsed as UTC then rendered local), so assert the format, not the exact day.
    expect(fmtBudgetDate("2026-03-09")).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2026$/);
  });
  it("falls back to the first 10 chars for an invalid date", () => {
    expect(fmtBudgetDate("not-a-date")).toBe("not-a-date");
  });
});

describe("groupRevertTargets", () => {
  it("keeps the earliest (oldest) change's old amount per category", () => {
    // items are newest-first; older rows overwrite so earliest wins
    const items = [
      { categoryId: "a", oldAmount: 200 },
      { categoryId: "a", oldAmount: 100 },
      { categoryId: "b", oldAmount: 50 },
    ] as unknown as BudgetChange[];
    const out = groupRevertTargets(items);
    expect(out).toEqual([
      { categoryId: "a", monthlyBudget: 100 },
      { categoryId: "b", monthlyBudget: 50 },
    ]);
  });
  it("skips changes with a null categoryId", () => {
    const items = [{ categoryId: null, oldAmount: 10 }] as unknown as BudgetChange[];
    expect(groupRevertTargets(items)).toEqual([]);
  });
});

describe("categoryWindowAverage", () => {
  it("averages the series", () => {
    expect(categoryWindowAverage([100, 200, 300])).toBe(200);
  });
  it("returns 0 for an empty series", () => {
    expect(categoryWindowAverage([])).toBe(0);
  });
});

describe("sumCategoryBudgets", () => {
  it("sums budgets treating null as zero", () => {
    const cats = [cat("A", [1], 100), cat("B", [1], null), cat("C", [1], 50)];
    expect(sumCategoryBudgets(cats)).toBe(150);
  });
});

describe("overBudgetCategories", () => {
  it("lists only over-budget categories, worst first, with overage and pct", () => {
    const cats = [
      cat("Under", [40, 60], 100), // avg 50 < 100
      cat("Over small", [110, 130], 100), // avg 120, over 20
      cat("Over big", [300, 500], 200), // avg 400, over 200
      cat("No budget", [999], null),
    ];
    const out = overBudgetCategories(cats);
    expect(out.map((r) => r.name)).toEqual(["Over big", "Over small"]);
    expect(out[0]).toMatchObject({ avg: 400, budget: 200, over: 200, pct: 1 });
    expect(out[1]).toMatchObject({ over: 20, pct: 0.2 });
  });
  it("ignores zero/negative budgets", () => {
    expect(overBudgetCategories([cat("Z", [100], 0)])).toEqual([]);
  });
});
