import { describe, it, expect } from "vitest";
import {
  parseUsdInput,
  formatInput,
  budgetsFromStrings,
  seasonDraftFromCategory,
} from "./budget-settings-panel.helpers";
import type { CategoryRow } from "@/types/finance";

function cat(partial: Partial<CategoryRow> & { id: string }): CategoryRow {
  return { name: partial.id, sort_order: 0, ...partial } as CategoryRow;
}

describe("parseUsdInput", () => {
  it("strips $ and commas and rounds to cents", () => {
    expect(parseUsdInput("$1,234.567")).toBe(1234.57);
    expect(parseUsdInput("50")).toBe(50);
  });
  it("returns null for empty input", () => {
    expect(parseUsdInput("")).toBeNull();
    expect(parseUsdInput("   ")).toBeNull();
  });
  it("rejects negative and non-numeric values", () => {
    expect(parseUsdInput("-5")).toBeNull();
    expect(parseUsdInput("abc")).toBeNull();
  });
});

describe("formatInput", () => {
  it("renders null as empty and 0 as '0'", () => {
    expect(formatInput(null)).toBe("");
    expect(formatInput(0)).toBe("0");
    expect(formatInput(42.5)).toBe("42.5");
  });
});

describe("budgetsFromStrings", () => {
  it("maps each category id to a parsed amount or null", () => {
    const cats = [cat({ id: "a" }), cat({ id: "b" }), cat({ id: "c" })];
    const out = budgetsFromStrings(cats, { a: "$100", b: "", c: "bad" });
    expect(out).toEqual({ a: 100, b: null, c: null });
  });
  it("treats a missing input as null", () => {
    const out = budgetsFromStrings([cat({ id: "a" })], {});
    expect(out).toEqual({ a: null });
  });
});

describe("seasonDraftFromCategory", () => {
  it("defaults to no limit and annual repeat", () => {
    const d = seasonDraftFromCategory(cat({ id: "a" }));
    expect(d.limit).toBe(false);
    expect(d.repeatsAnnually).toBe(true);
  });
  it("flags a month/day window as limited", () => {
    const d = seasonDraftFromCategory(
      cat({
        id: "a",
        budget_active_from_month: 6,
        budget_active_from_day: 1,
        budget_active_to_month: 8,
        budget_active_to_day: 31,
      }),
    );
    expect(d.limit).toBe(true);
    expect(d.fm).toBe(6);
    expect(d.td).toBe(31);
  });
});
