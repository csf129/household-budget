import { describe, it, expect } from "vitest";
import {
  categoryRuleAmountMatches,
  categoryRulesFromDb,
  parseAmountExact,
  resolveCategoryFromRules,
  type CategoryRuleRow,
} from "@/lib/apply-category-rules";

function rule(overrides: Partial<CategoryRuleRow> = {}): CategoryRuleRow {
  return {
    category_id: "cat-cleaners",
    match_type: "contains",
    pattern: "venmo",
    priority: 100,
    amount_sign: "any",
    amount_exact: null,
    ...overrides,
  };
}

describe("parseAmountExact", () => {
  it("returns null for blank/missing/invalid", () => {
    expect(parseAmountExact(null)).toBeNull();
    expect(parseAmountExact(undefined)).toBeNull();
    expect(parseAmountExact("")).toBeNull();
    expect(parseAmountExact("abc")).toBeNull();
    expect(parseAmountExact(-5)).toBeNull();
  });

  it("parses numeric strings and numbers", () => {
    expect(parseAmountExact("160")).toBe(160);
    expect(parseAmountExact("29.99")).toBe(29.99);
    expect(parseAmountExact(160)).toBe(160);
  });
});

describe("categoryRuleAmountMatches", () => {
  it("matches any amount when exact is null", () => {
    expect(categoryRuleAmountMatches(-160, null)).toBe(true);
    expect(categoryRuleAmountMatches(5, null)).toBe(true);
  });

  it("matches on magnitude regardless of sign", () => {
    expect(categoryRuleAmountMatches(-160, 160)).toBe(true);
    expect(categoryRuleAmountMatches(160, 160)).toBe(true);
  });

  it("rejects amounts outside half a cent", () => {
    expect(categoryRuleAmountMatches(-159.5, 160)).toBe(false);
    expect(categoryRuleAmountMatches(-161, 160)).toBe(false);
  });

  it("tolerates sub-cent float rounding", () => {
    expect(categoryRuleAmountMatches(-29.99, 29.99)).toBe(true);
  });
});

describe("resolveCategoryFromRules with amount_exact", () => {
  const cleaners = rule({
    category_id: "cat-cleaners",
    amount_sign: "negative",
    amount_exact: 160,
  });

  it("assigns the $160 venmo to cleaners", () => {
    expect(resolveCategoryFromRules("venmo", -160, [cleaners])).toBe(
      "cat-cleaners",
    );
  });

  it("leaves other venmo amounts alone", () => {
    expect(resolveCategoryFromRules("venmo", -50, [cleaners])).toBeNull();
    expect(resolveCategoryFromRules("venmo", -200, [cleaners])).toBeNull();
  });

  it("ignores incoming venmo via the sign filter", () => {
    expect(resolveCategoryFromRules("venmo", 160, [cleaners])).toBeNull();
  });

  it("a higher-priority exact rule wins over a generic catch-all", () => {
    const generic = rule({ category_id: "cat-misc", priority: 50 });
    const rules = [generic, cleaners];
    expect(resolveCategoryFromRules("venmo", -160, rules)).toBe("cat-cleaners");
    expect(resolveCategoryFromRules("venmo", -75, rules)).toBe("cat-misc");
  });
});

describe("categoryRulesFromDb", () => {
  it("reads amount_exact from rows", () => {
    const [mapped] = categoryRulesFromDb([
      {
        category_id: "c1",
        match_type: "contains",
        pattern: "venmo",
        priority: 100,
        amount_sign: "negative",
        amount_exact: "160",
      },
    ]);
    expect(mapped?.amount_exact).toBe(160);
  });

  it("defaults amount_exact to null when absent", () => {
    const [mapped] = categoryRulesFromDb([
      {
        category_id: "c1",
        match_type: "contains",
        pattern: "venmo",
        priority: 100,
        amount_sign: "any",
      },
    ]);
    expect(mapped?.amount_exact).toBeNull();
  });
});
