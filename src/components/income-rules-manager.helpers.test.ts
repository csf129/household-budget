import { describe, it, expect } from "vitest";
import {
  MATCH_TYPES,
  AMOUNT_SIGN_OPTIONS,
  amountSignShortLabel,
  rulesForEngine,
} from "./income-rules-manager.helpers";
import type { IncomeRuleView } from "@/types/finance";

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
  it("projects income view rows to the engine row shape (treatment, not category)", () => {
    const views = [
      {
        id: "r1",
        match_type: "contains",
        pattern: "payroll",
        priority: 50,
        treatment: "income",
        amount_sign: "positive",
        category_id: "ignored",
      },
    ] as unknown as IncomeRuleView[];
    expect(rulesForEngine(views)).toEqual([
      {
        match_type: "contains",
        pattern: "payroll",
        priority: 50,
        treatment: "income",
        amount_sign: "positive",
      },
    ]);
  });
});
