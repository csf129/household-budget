import { describe, it, expect } from "vitest";
import { fmtMoney, fmtPoints, duePhrase, toForm } from "./credit-cards-manager.helpers";
import type { CreditCardView } from "@/types/credit-card";

describe("fmtMoney", () => {
  it("renders null as an em dash", () => {
    expect(fmtMoney(null)).toBe("—");
  });
  it("formats USD by default", () => {
    expect(fmtMoney(1234.5)).toBe("$1,234.50");
  });
});

describe("fmtPoints", () => {
  it("renders null as an em dash and groups thousands", () => {
    expect(fmtPoints(null)).toBe("—");
    expect(fmtPoints(50000)).toBe("50,000");
  });
});

describe("duePhrase", () => {
  it("describes overdue, today, tomorrow, and future", () => {
    expect(duePhrase(-2)).toBe("2 days overdue");
    expect(duePhrase(-1)).toBe("1 day overdue");
    expect(duePhrase(0)).toBe("due today");
    expect(duePhrase(1)).toBe("due tomorrow");
    expect(duePhrase(5)).toBe("in 5 days");
  });
});

describe("toForm", () => {
  it("stringifies numbers and defaults nullish fields to empty strings", () => {
    const card = {
      annualFee: 95,
      annualFeeMonth: null,
      paymentDueDay: 12,
      pointsProgram: null,
      pointsBalance: 40000,
      rewardSummary: null,
      status: "active",
      notes: null,
    } as unknown as CreditCardView;
    const form = toForm(card);
    expect(form.annualFee).toBe("95");
    expect(form.annualFeeMonth).toBe("");
    expect(form.paymentDueDay).toBe("12");
    expect(form.pointsProgram).toBe("");
    expect(form.pointsBalance).toBe("40000");
    expect(form.status).toBe("active");
    expect(form.notes).toBe("");
  });
});
