import { describe, it, expect } from "vitest";
import {
  transactionImportDedupeKey,
  transactionNormalizedDedupeKey,
} from "./transaction-import-dedupe-key";

describe("transactionImportDedupeKey", () => {
  it("joins date, 2-decimal amount, and trimmed description", () => {
    expect(transactionImportDedupeKey("2026-01-15", -12.5, "  Coffee  ")).toBe(
      "2026-01-15|-12.50|Coffee",
    );
  });

  it("formats amounts to exactly two decimals", () => {
    expect(transactionImportDedupeKey("2026-01-15", 12, "X")).toBe(
      "2026-01-15|12.00|X",
    );
    expect(transactionImportDedupeKey("2026-01-15", 12.009, "X")).toBe(
      "2026-01-15|12.01|X",
    );
  });

  it("makes two rows that differ only by sub-cent amount collide", () => {
    const a = transactionImportDedupeKey("2026-01-15", 12.001, "Shop");
    const b = transactionImportDedupeKey("2026-01-15", 12.004, "Shop");
    expect(a).toBe(b);
  });

  it("keeps opposite signs distinct", () => {
    const debit = transactionImportDedupeKey("2026-01-15", -12.5, "Venmo");
    const credit = transactionImportDedupeKey("2026-01-15", 12.5, "Venmo");
    expect(debit).not.toBe(credit);
  });

  it("is case- and whitespace-sensitive in the description (raw key)", () => {
    expect(transactionImportDedupeKey("2026-01-15", 1, "ACME")).not.toBe(
      transactionImportDedupeKey("2026-01-15", 1, "acme"),
    );
  });
});

describe("transactionNormalizedDedupeKey", () => {
  it("uses the normalized description component", () => {
    expect(
      transactionNormalizedDedupeKey("2026-01-15", -12.5, " market basket "),
    ).toBe("2026-01-15|-12.50|market basket");
  });
});
