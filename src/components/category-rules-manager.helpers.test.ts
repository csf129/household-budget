import { describe, it, expect } from "vitest";
import {
  MATCH_TYPES,
  AMOUNT_SIGN_OPTIONS,
  amountSignShortLabel,
  rulesForEngine,
} from "./category-rules-manager.helpers";
import type { CategoryRuleView } from "@/types/finance";

describe("option lists", () => {
  it("offers the three match types and three sign options", () => {
    expect(MATCH_TYPES.map((m) => m.value)).toEqual([
      "exact_normalized",
      "contains",
      "prefix",
    ]);
    expect(AMOUNT_SIGN_OPTIONS.map((o) => o.value)).toEqual([
      "any",
      "positive",
      "negative",
    ]);
  });
});

describe("amountSignShortLabel", () => {
  it("maps each sign filter to a short label", () => {
    expect(amountSignShortLabel("positive")).toBe("Positive");
    expect(amountSignShortLabel("negative")).toBe("Negative");
    expect(amountSignShortLabel("any")).toBe("Any");
  });
});

describe("rulesForEngine", () => {
  it("projects the view rows to the engine row shape", () => {
    const views = [
      {
        id: "r1",
        category_id: "c1",
        match_type: "contains",
        pattern: "costco",
        priority: 100,
        amount_sign: "any",
        amount_exact: null,
        extra: "ignored",
      },
    ] as unknown as CategoryRuleView[];
    expect(rulesForEngine(views)).toEqual([
      {
        category_id: "c1",
        match_type: "contains",
        pattern: "costco",
        priority: 100,
        amount_sign: "any",
        amount_exact: null,
      },
    ]);
  });
});
