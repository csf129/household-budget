import { describe, it, expect } from "vitest";
import {
  parseAmountSignFilter,
  amountMatchesSignFilter,
  amountSignForRememberRule,
} from "./amount-sign-filter";

describe("parseAmountSignFilter", () => {
  it("accepts the three valid values", () => {
    expect(parseAmountSignFilter("positive")).toBe("positive");
    expect(parseAmountSignFilter("negative")).toBe("negative");
    expect(parseAmountSignFilter("any")).toBe("any");
  });

  it("falls back to 'any' for anything else", () => {
    expect(parseAmountSignFilter("")).toBe("any");
    expect(parseAmountSignFilter(undefined)).toBe("any");
    expect(parseAmountSignFilter(null)).toBe("any");
    expect(parseAmountSignFilter(1)).toBe("any");
    expect(parseAmountSignFilter("POSITIVE")).toBe("any");
  });
});

describe("amountMatchesSignFilter", () => {
  it("'any' matches any non-zero amount", () => {
    expect(amountMatchesSignFilter(5, "any")).toBe(true);
    expect(amountMatchesSignFilter(-5, "any")).toBe(true);
  });

  it("zero never matches, even for 'any'", () => {
    expect(amountMatchesSignFilter(0, "any")).toBe(false);
    expect(amountMatchesSignFilter(0, "positive")).toBe(false);
    expect(amountMatchesSignFilter(0, "negative")).toBe(false);
  });

  it("non-finite amounts never match", () => {
    expect(amountMatchesSignFilter(NaN, "any")).toBe(false);
    expect(amountMatchesSignFilter(Infinity, "positive")).toBe(false);
  });

  it("'positive' matches only amounts > 0", () => {
    expect(amountMatchesSignFilter(0.01, "positive")).toBe(true);
    expect(amountMatchesSignFilter(-0.01, "positive")).toBe(false);
  });

  it("'negative' matches only amounts < 0", () => {
    expect(amountMatchesSignFilter(-0.01, "negative")).toBe(true);
    expect(amountMatchesSignFilter(0.01, "negative")).toBe(false);
  });
});

describe("amountSignForRememberRule", () => {
  it("maps positive amounts to 'positive'", () => {
    expect(amountSignForRememberRule(10)).toBe("positive");
  });

  it("maps negative amounts to 'negative'", () => {
    expect(amountSignForRememberRule(-10)).toBe("negative");
  });

  it("treats zero as 'negative' (not > 0)", () => {
    expect(amountSignForRememberRule(0)).toBe("negative");
  });
});
