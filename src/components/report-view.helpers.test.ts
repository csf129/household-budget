import { describe, it, expect } from "vitest";
import {
  matchesAny,
  BILL_HINTS,
  CAR_HINTS,
  notesFromFeedback,
  fmtBudgetDate,
  groupRevertTargets,
} from "./report-view.helpers";
import type { BudgetChange, ReportFeedback } from "@/types/report";

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
  it("formats a date-only ISO string as the same calendar day in any timezone", () => {
    expect(fmtBudgetDate("2026-03-09")).toBe("Mar 9, 2026");
  });
  it("uses the date portion of a timestamp, not the local-shifted instant", () => {
    // A UTC timestamp early in the day must still show its own calendar date,
    // matching how the caller groups rows (createdAt.slice(0, 10)).
    expect(fmtBudgetDate("2026-03-09T02:00:00Z")).toBe("Mar 9, 2026");
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
